// BattleScene.js
// ターン制戦闘の本実装(Stage5:戦闘。Stage6でUIManager/DialogueBox/Menuへ統合し演出強化)。
//
// BattleSystem(ロジック)と協調して動く「駒を進める」コントローラー。
// 状態(this.state)は以下を遷移する:
//   'message'       - メッセージログを1件ずつ表示中(Z/Enterで次へ。DialogueBoxで1文字ずつ演出)
//   'command'       - プレイヤー操作キャラのコマンド選択(たたかう/まほう/せっとく/ぼうぎょ/にげる)
//   'skill_select'  - まほう選択時のスキル一覧
//   'target_select' - 対象選択(単体攻撃/説得/単体スキル時のみ)
//   'gameover'      - 全滅時の専用画面(Z/Enterでマップに復帰)
//
// UNDERTALE的な「対話で切り抜ける」要素は「せっとく」コマンドとして実装し、
// 説得成功で敵を無力化(経験値対象外)できるようにしてある。

import { loadJSON } from '../utils/helpers.js';
import { Menu } from '../ui/Menu.js';
import { DialogueBox } from '../ui/DialogueBox.js';
import { UIManager, PALETTE } from '../ui/UIManager.js';
import { Enemy } from '../entities/Enemy.js';
import { BattleSystem } from '../battle/BattleSystem.js';
import { EndingScene } from './EndingScene.js';

const FLASH_DURATION = 0.25; // 被弾時の点滅演出の長さ(秒)

export class BattleScene {
  constructor(game, encounterData) {
    this.game = game;
    this.enemyIds = encounterData.enemyIds ?? [];
    this.returnTo = encounterData.returnTo ?? null;
    // クエスト掲示板から直接挑戦した'battle'型クエストのid(Stage8:クエスト)。
    // 勝利した瞬間に自動でQuestManager#completeQuestを呼ぶための紐付け。
    this.pendingQuestId = encounterData.questId ?? null;

    this.loaded = false;
    this.enemies = [];
    this.battleSystem = null;

    this.state = 'message';
    this.messages = [];
    this.messageIndex = 0;
    this.pendingAfter = null;
    this.dialogueBox = new DialogueBox({ charsPerSecond: 70 });

    this.currentActor = null;
    this.commandMenu = null;
    this.skillMenu = null;
    this.skillMenuSkills = [];
    this.targetMenu = null;
    this.targetCandidates = [];

    this.pendingActionType = null; // 'attack' | 'skill' | 'persuade'
    this.pendingSkill = null;

    this.flashTargets = new Map(); // 被弾演出: entity -> 残り時間(秒)
    this.gameOverBlink = 0;
  }

  async onEnter() {
    const [enemyData, skillData] = await Promise.all([
      loadJSON('./src/data/enemies.json'),
      loadJSON('./src/data/skills.json'),
    ]);

    this.enemies = this.enemyIds.map((id) => new Enemy(id, enemyData[id] ?? {}));
    this.party = this.game.party;
    this.battleSystem = new BattleSystem(this.party, this.enemies, this.game.eventManager, skillData);

    const openingMessages = this.battleSystem.startBattle();
    this.loaded = true;
    this._pushMessages(openingMessages, () => this._beginNextTurn());
  }

  // --- ターン進行 -----------------------------------------------------

  _beginNextTurn() {
    const actor = this.battleSystem.getNextActor();
    if (!actor) {
      // 対象不在(通常は起こらない想定の保険)。安全にマップへ復帰する。
      this._returnToMap();
      return;
    }

    this.currentActor = actor;
    const begin = this.battleSystem.beginTurn(actor);

    if (begin.stunned) {
      this._pushMessages(begin.messages, () => this._endCurrentTurn());
      return;
    }

    if (this.battleSystem.isPlayerActor(actor)) {
      this.commandMenu = new Menu(['たたかう', 'まほう', 'せっとく', 'ぼうぎょ', 'にげる']);
      this.state = 'command';
    } else {
      const action = this.battleSystem.decideEnemyAction(actor);
      if (!action) {
        this._endCurrentTurn();
        return;
      }
      this._markFlash(action);
      const msgs = this.battleSystem.executeAction(actor, action);
      this._pushMessages(msgs, () => this._afterAction());
    }
  }

  _afterAction() {
    const ended = this.battleSystem.checkBattleEnd();
    if (ended) {
      this._handleBattleEnd(ended);
      return;
    }
    this._endCurrentTurn();
  }

  _endCurrentTurn() {
    this.battleSystem.finishTurn();
    this._beginNextTurn();
  }

  _performAction(action) {
    this._markFlash(action);
    const msgs = this.battleSystem.executeAction(this.currentActor, action);
    this._pushMessages(msgs, () => this._afterAction());
  }

  // 攻撃/スキルの対象に被弾点滅演出をつける(ぼうぎょ・にげる・せっとくは対象外)
  _markFlash(action) {
    if (!action || (action.type !== 'attack' && action.type !== 'skill')) return;
    for (const target of action.targets ?? []) {
      this.flashTargets.set(target, FLASH_DURATION);
    }
  }

  _tickFlash(deltaTime) {
    for (const [target, remaining] of this.flashTargets) {
      const next = remaining - deltaTime;
      if (next <= 0) this.flashTargets.delete(target);
      else this.flashTargets.set(target, next);
    }
  }

  // --- 対象選択の解決 -----------------------------------------------------

  _resolveTargetsOrPrompt(targetMode) {
    if (targetMode === 'all_enemies') {
      this._finalizeAction(this.battleSystem.getAliveEnemies());
      return;
    }
    if (targetMode === 'all_allies') {
      this._finalizeAction(this.battleSystem.getAliveAllies());
      return;
    }
    if (targetMode === 'self') {
      this._finalizeAction([this.currentActor]);
      return;
    }

    const candidates =
      targetMode === 'single_ally'
        ? this.battleSystem.getAliveAllies()
        : this.battleSystem.getAliveEnemies();

    if (candidates.length === 1) {
      this._finalizeAction([candidates[0]]);
      return;
    }

    this.targetCandidates = candidates;
    this.targetMenu = new Menu(candidates.map((c) => c.name).concat(['もどる']));
    this.state = 'target_select';
  }

  _finalizeAction(targets) {
    let action = null;
    if (this.pendingActionType === 'attack') action = { type: 'attack', targets };
    else if (this.pendingActionType === 'persuade') action = { type: 'persuade', targets };
    else if (this.pendingActionType === 'skill') {
      action = { type: 'skill', skillId: this.pendingSkill.id, targets };
    }
    if (action) this._performAction(action);
  }

  // --- 戦闘終了 -----------------------------------------------------

  _handleBattleEnd(result) {
    if (result === 'victory') {
      const rewards = this.battleSystem.grantRewards();
      const msgs = [{ text: '戦闘に勝利した！' }];

      if (rewards.totalExp > 0) {
        msgs.push({ text: `経験値${rewards.totalExp}を獲得！` });
      }
      for (const entry of rewards.levelResults) {
        if (!entry.result.leveledUp) continue;
        const member = this.party.getMember(entry.id);
        msgs.push({ text: `${member.name}はレベル${entry.result.newLevel}に上がった！` });
        for (const skill of entry.result.unlockedSkills) {
          msgs.push({ text: `${member.name}は「${skill.name}」を習得した！` });
        }
      }

      // クエスト掲示板から直接挑戦した'battle'型クエストの自動達成処理(Stage8:クエスト)。
      // 経験値報酬はQuestManagerがPartyを知らない設計のため、ここでgainExpAllを呼ぶ。
      let isEnding = false;
      if (this.pendingQuestId) {
        const questResult = this.game.questManager.completeQuest(this.pendingQuestId);
        if (questResult) {
          if (questResult.rewards.exp) {
            const bonusResults = this.game.party.gainExpAll(questResult.rewards.exp);
            for (const entry of bonusResults) {
              if (!entry.result.leveledUp) continue;
              const member = this.party.getMember(entry.id);
              msgs.push({ text: `${member.name}はレベル${entry.result.newLevel}に上がった！` });
              for (const skill of entry.result.unlockedSkills) {
                msgs.push({ text: `${member.name}は「${skill.name}」を習得した！` });
              }
            }
          }
          msgs.push({
            text: `依頼「${questResult.quest.name}」達成！ 報酬 ${questResult.rewards.gold ?? 0}Gを受け取った。`,
          });
          // 最終ボス(finalBoss:trueのクエスト)を討伐した場合はエンディングへ(Stage10)
          if (questResult.quest.finalBoss) isEnding = true;
        }
      }

      msgs.push({ text: isEnding ? '（Z・Enterでエンディングへ）' : '（Z・Enterでマップに戻る）' });
      this._pushMessages(msgs, () => {
        if (isEnding) {
          this.game.eventManager.setFlag('story_complete', true);
          this.game.sceneManager.changeScene(new EndingScene(this.game));
        } else {
          this._returnToMap();
        }
      });
    } else if (result === 'fled') {
      this._pushMessages([{ text: '（Z・Enterでマップに戻る）' }], () => this._returnToMap());
    } else if (result === 'defeat') {
      // パーティを最低限復活させてマップへ戻す前に、専用のゲームオーバー画面を挟む。
      this._reviveParty();
      this.gameOverBlink = 0;
      this.state = 'gameover';
    }
  }

  _reviveParty() {
    for (const member of this.party.active) {
      if (!member.isAlive) member.hp = 1;
      member.statusEffects = [];
      member.guarding = false;
    }
  }

  _returnToMap() {
    if (this.returnTo) {
      this.game.sceneManager.changeScene(this.returnTo);
    }
  }

  // --- メッセージキュー -----------------------------------------------------

  _pushMessages(msgs, after) {
    if (!msgs || msgs.length === 0) {
      after();
      return;
    }
    this.messages = msgs;
    this.messageIndex = 0;
    this.state = 'message';
    this.pendingAfter = after;
    this.dialogueBox.setText(this.messages[0].text ?? '');
  }

  // --- 更新 -----------------------------------------------------

  update(deltaTime) {
    if (!this.loaded) return;

    this._tickFlash(deltaTime);
    const input = this.game.input;

    if (this.state === 'message') {
      this._updateMessage(deltaTime, input);
    } else if (this.state === 'command') {
      this._updateCommandMenu(input);
    } else if (this.state === 'skill_select') {
      this._updateSkillMenu(input);
    } else if (this.state === 'target_select') {
      this._updateTargetMenu(input);
    } else if (this.state === 'gameover') {
      this.gameOverBlink += deltaTime;
      if (input.wasPressed('z') || input.wasPressed('Enter')) {
        this._returnToMap();
      }
    }

    input.clearFrame();
  }

  _updateMessage(deltaTime, input) {
    this.dialogueBox.update(deltaTime);
    if (!(input.wasPressed('z') || input.wasPressed('Enter'))) return;

    if (!this.dialogueBox.isFullyRevealed()) {
      this.dialogueBox.skipReveal();
      return;
    }

    this.messageIndex += 1;
    if (this.messageIndex >= this.messages.length) {
      const after = this.pendingAfter;
      this.pendingAfter = null;
      if (after) after();
    } else {
      this.dialogueBox.setText(this.messages[this.messageIndex].text ?? '');
    }
  }

  _updateCommandMenu(input) {
    if (input.wasPressed('ArrowUp') || input.wasPressed('w')) this.commandMenu.moveUp();
    if (input.wasPressed('ArrowDown') || input.wasPressed('s')) this.commandMenu.moveDown();
    if (!(input.wasPressed('z') || input.wasPressed('Enter'))) return;

    const selected = this.commandMenu.getSelected();
    if (selected === 'たたかう') {
      this.pendingActionType = 'attack';
      this._resolveTargetsOrPrompt('single_enemy');
    } else if (selected === 'まほう') {
      this._openSkillMenu();
    } else if (selected === 'せっとく') {
      this.pendingActionType = 'persuade';
      this._resolveTargetsOrPrompt('single_enemy');
    } else if (selected === 'ぼうぎょ') {
      this._performAction({ type: 'guard' });
    } else if (selected === 'にげる') {
      this._performAction({ type: 'flee' });
    }
  }

  _openSkillMenu() {
    this.skillMenuSkills = this.battleSystem.getLearnedSkills(this.currentActor);
    if (this.skillMenuSkills.length === 0) {
      this._pushMessages([{ text: `${this.currentActor.name}は使える魔法・スキルがない！` }], () => {
        this.state = 'command';
      });
      return;
    }
    const labels = this.skillMenuSkills.map((s) => `${s.name}(MP${s.mpCost})`).concat(['もどる']);
    this.skillMenu = new Menu(labels);
    this.state = 'skill_select';
  }

  _updateSkillMenu(input) {
    if (input.wasPressed('ArrowUp') || input.wasPressed('w')) this.skillMenu.moveUp();
    if (input.wasPressed('ArrowDown') || input.wasPressed('s')) this.skillMenu.moveDown();
    if (!(input.wasPressed('z') || input.wasPressed('Enter'))) return;

    const idx = this.skillMenu.selectedIndex;
    if (idx === this.skillMenuSkills.length) {
      this.state = 'command';
      return;
    }

    const skill = this.skillMenuSkills[idx];
    if (this.currentActor.mp < skill.mpCost) {
      this._pushMessages([{ text: `${this.currentActor.name}はMPが足りない！` }], () => {
        this.state = 'skill_select';
      });
      return;
    }

    this.pendingActionType = 'skill';
    this.pendingSkill = skill;
    this._resolveTargetsOrPrompt(skill.target);
  }

  _updateTargetMenu(input) {
    if (input.wasPressed('ArrowUp') || input.wasPressed('w')) this.targetMenu.moveUp();
    if (input.wasPressed('ArrowDown') || input.wasPressed('s')) this.targetMenu.moveDown();
    if (!(input.wasPressed('z') || input.wasPressed('Enter'))) return;

    const idx = this.targetMenu.selectedIndex;
    if (idx === this.targetCandidates.length) {
      // 「もどる」
      this.state = this.pendingActionType === 'skill' ? 'skill_select' : 'command';
      return;
    }

    this._finalizeAction([this.targetCandidates[idx]]);
  }

  // --- 描画 -----------------------------------------------------

  render(ctx) {
    const { width, height } = ctx.canvas;

    if (this.state === 'gameover') {
      this._renderGameOver(ctx, width, height);
      return;
    }

    ctx.fillStyle = '#1a0808';
    ctx.fillRect(0, 0, width, height);

    if (!this.loaded) {
      ctx.fillStyle = PALETTE.textMain;
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('読み込み中...', 20, 30);
      return;
    }

    this._renderEnemies(ctx, width);
    this._renderPartyStatus(ctx, width, height);
    this._renderBottomPanel(ctx, width, height);
  }

  _renderEnemies(ctx, width) {
    const top = 40;
    const boxW = 140;
    const boxH = 110;
    const gap = 30;
    const totalW = this.enemies.length * boxW + (this.enemies.length - 1) * gap;
    let x = (width - totalW) / 2;

    for (const enemy of this.enemies) {
      const defeated = !enemy.isAlive || enemy.persuaded;

      ctx.globalAlpha = defeated ? 0.3 : 1;

      ctx.fillStyle = enemy === this.currentActor ? '#7a2020' : '#4a1010';
      ctx.fillRect(x, top, boxW, boxH);
      ctx.strokeStyle = '#ff6b6b';
      ctx.strokeRect(x, top, boxW, boxH);

      ctx.fillStyle = PALETTE.textMain;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(enemy.name, x + boxW / 2, top + boxH + 18);

      if (!defeated) {
        UIManager.drawBar(ctx, x + 10, top + boxH - 16, boxW - 20, 8, enemy.hp / enemy.maxHp, {
          color: PALETTE.enemyHp,
        });
      } else if (enemy.persuaded) {
        ctx.fillStyle = '#8ad0ff';
        ctx.font = '12px sans-serif';
        ctx.fillText('(説得済み)', x + boxW / 2, top + boxH / 2);
      }

      // 被弾点滅演出: 残り時間に応じたアルファで白いフラッシュを重ねる
      const flash = this.flashTargets.get(enemy);
      if (flash && !defeated) {
        ctx.globalAlpha = Math.min(0.7, flash / FLASH_DURATION);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, top, boxW, boxH);
      }

      ctx.globalAlpha = 1;
      x += boxW + gap;
    }
  }

  _renderPartyStatus(ctx, width, height) {
    const panelTop = height - 210;
    const panelH = 70;
    const memberW = width / Math.max(1, this.party.active.length);

    ctx.fillStyle = 'rgba(20,20,30,0.85)';
    ctx.fillRect(0, panelTop, width, panelH);

    this.party.active.forEach((member, i) => {
      const x = i * memberW;
      const isTurn = member === this.currentActor;

      UIManager.drawStatBlock(ctx, x + 16, panelTop + 20, memberW - 32, member, { highlighted: isTurn });

      // 被弾点滅演出
      const flash = this.flashTargets.get(member);
      if (flash) {
        ctx.globalAlpha = Math.min(0.5, flash / FLASH_DURATION);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, panelTop, memberW, panelH);
        ctx.globalAlpha = 1;
      }
    });
  }

  _renderBottomPanel(ctx, width, height) {
    const boxHeight = 130;
    const boxY = height - boxHeight;

    if (this.state === 'message') {
      const hint = this.messageIndex < this.messages.length - 1 ? 'Z・Enterで次へ' : 'Z・Enter';
      this.dialogueBox.render(ctx, 0, boxY, width, boxHeight, { hint, showSpeaker: false });
      return;
    }

    UIManager.drawPanel(ctx, 0, boxY, width, boxHeight);

    if (this.state === 'command') {
      this._renderListMenu(ctx, boxY, boxHeight, width, {
        title: `${this.currentActor?.name ?? ''}, どうする？`,
        menu: this.commandMenu,
        hint: '↑↓で選択 / Z・Enterで決定',
      });
    } else if (this.state === 'skill_select') {
      this._renderListMenu(ctx, boxY, boxHeight, width, {
        title: 'つかう魔法・スキルを選べ',
        menu: this.skillMenu,
        hint: '↑↓で選択 / Z・Enterで決定',
      });
    } else if (this.state === 'target_select') {
      this._renderListMenu(ctx, boxY, boxHeight, width, {
        title: '対象を選べ',
        menu: this.targetMenu,
        hint: '↑↓で選択 / Z・Enterで決定',
      });
    }
  }

  _renderListMenu(ctx, boxY, boxHeight, width, { title, menu, hint }) {
    ctx.fillStyle = PALETTE.textHighlight;
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, 30, boxY + 24);

    menu.render(ctx, 40, boxY + 52, { colWidth: 260, rowHeight: 24, rowsPerCol: 4 });

    UIManager.drawHint(ctx, hint, width - 30, boxY + boxHeight - 12);
  }

  _renderGameOver(ctx, width, height) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#c0392b';
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText('GAME OVER', width / 2, height / 2 - 20);

    ctx.fillStyle = PALETTE.textMain;
    ctx.font = '18px sans-serif';
    ctx.fillText('パーティは倒れてしまった…', width / 2, height / 2 + 20);

    if (Math.floor(this.gameOverBlink * 2) % 2 === 0) {
      ctx.fillStyle = PALETTE.textHighlight;
      ctx.font = '16px sans-serif';
      ctx.fillText('（Z・Enterでルミナスに戻る）', width / 2, height / 2 + 60);
    }
  }

  onExit() {}
}
