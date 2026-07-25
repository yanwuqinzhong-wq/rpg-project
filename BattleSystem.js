// BattleSystem.js
// ターン制戦闘のロジック本体(Stage5:戦闘)。
//
// 責務:
// - ターン順計算(spd順、毎ラウンド再計算)
// - 行動実行(攻撃/魔法・スキル/ぼうぎょ/説得/逃走)とダメージ計算の橋渡し
//   (実際の数値計算はSkill.jsに委譲し、ここでは対象ループ・MP消費・
//    撃破判定・ルート用カウンター加算などの「進行管理」に専念する)
// - 戦闘終了判定(勝利/敗北/逃走成功)と経験値付与
//
// BattleScene(表示・入力)からは「駒を進める」ためのAPIとして使われる想定:
//   startBattle() -> beginTurn(actor) -> executeAction(actor, action) -> finishTurn()
//   -> checkBattleEnd() -> (勝利ならgrantRewards())

import { Skill } from './Skill.js';
import { StatusEffect } from '../entities/StatusEffect.js';
import { Enemy } from '../entities/Enemy.js';

export class BattleSystem {
  constructor(party, enemies, eventManager, skillData = {}) {
    this.party = party; // Partyインスタンス
    this.enemies = enemies; // Enemy[]
    this.eventManager = eventManager;
    this.skillData = skillData; // skills.jsonの生データ(id -> 定義)

    this.turnOrder = [];
    this.turnIndex = 0;
    this.round = 0;

    this.ended = false;
    this.result = null; // 'victory' | 'defeat' | 'fled'
  }

  // --- 戦闘開始/ターン管理 -----------------------------------------------

  startBattle() {
    this.ended = false;
    this.result = null;
    this.round = 0;
    this.turnIndex = 0;
    this.turnOrder = [];
    this._buildTurnOrder();

    const names = this.enemies.map((e) => e.name).join('、');
    return [{ text: `${names} が現れた！` }];
  }

  _buildTurnOrder() {
    const combatants = [...this.party.active, ...this.enemies].filter(
      (c) => c.isAlive && !(c instanceof Enemy && c.persuaded)
    );
    // spd(実効値)降順。同値はシャッフルして固定順にならないようにする。
    combatants.sort(
      (a, b) => b.getEffectiveStat('spd') - a.getEffectiveStat('spd') + (Math.random() - 0.5)
    );
    this.turnOrder = combatants;
    this.turnIndex = 0;
    this.round += 1;
  }

  // 次に行動する生存中のキャラクターを返す。ラウンドを使い切っていれば
  // 自動的に次のラウンドのターン順を再計算する。誰も戦闘可能でなければnull。
  getNextActor() {
    let guard = 0; // 無限ループ防止(理論上は起きない想定だが安全のため)
    while (guard < 1000) {
      guard += 1;
      if (this.turnIndex >= this.turnOrder.length) {
        this._buildTurnOrder();
        if (this.turnOrder.length === 0) return null;
      }
      const actor = this.turnOrder[this.turnIndex];
      if (!actor.isAlive || (actor instanceof Enemy && actor.persuaded)) {
        this.turnIndex += 1;
        continue;
      }
      return actor;
    }
    return null;
  }

  isPlayerActor(actor) {
    return this.party.active.includes(actor);
  }

  // その手番の開始処理。ぼうぎょ状態のリセットと行動不能(スタン)判定を行う。
  beginTurn(actor) {
    actor.guarding = false;
    if (actor.isStunned) {
      return { stunned: true, messages: [{ text: `${actor.name}は行動できない！` }] };
    }
    return { stunned: false, messages: [] };
  }

  // その手番の終了処理。継続ダメージ等のバフ/デバフを1ターン分進め、次の手番へ送る。
  finishTurn() {
    const actor = this.turnOrder[this.turnIndex];
    if (actor) actor.tickStatusEffectsTurnEnd();
    this.turnIndex += 1;
  }

  // --- 行動選択の補助(BattleSceneがメニュー表示に使う) ----------------

  getLearnedSkills(actor) {
    const ids = actor.skillTree?.getLearnedSkillIds() ?? [];
    return ids.map((id) => new Skill(id, this.skillData[id] ?? {}));
  }

  getAliveEnemies() {
    return this.enemies.filter((e) => e.isAlive && !e.persuaded);
  }

  getAliveAllies() {
    return this.party.active.filter((m) => m.isAlive);
  }

  // 敵AIの行動決定。
  // - aiPattern 'basic'(通常敵): 従来通りランダムな物理攻撃のみ
  // - aiPattern 'boss'(中ボス/四皇/Gルート限定ボス、Stage9): 習得スキル(enemies.jsonの
  //   skillTreeから解禁される。仕組みはCharacter/SkillTreeを流用し新規実装不要)を交えつつ、
  //   HPが低い時は時々ぼうぎょも選ぶ「駆け引きのある」行動パターンにする。
  decideEnemyAction(enemy) {
    const targets = this.getAliveAllies();
    if (targets.length === 0) return null;

    if (enemy.aiPattern === 'boss') {
      return this._decideBossAction(enemy, targets);
    }

    const target = targets[Math.floor(Math.random() * targets.length)];
    return { type: 'attack', targets: [target] };
  }

  _decideBossAction(enemy, targets) {
    // HPが3割を切っている時はたまに態勢を立て直す(ぼうぎょ)
    if (enemy.hp < enemy.maxHp * 0.3 && Math.random() < 0.2) {
      return { type: 'guard' };
    }

    // 習得済みスキル(MPが足りるものだけ)からランダムに選択。65%の確率でスキルを優先する。
    const usableSkills = this.getLearnedSkills(enemy).filter((s) => enemy.mp >= s.mpCost);
    if (usableSkills.length > 0 && Math.random() < 0.65) {
      const skill = usableSkills[Math.floor(Math.random() * usableSkills.length)];
      // target: 'all_enemies'/'self' はSkill.js上の表記だが、使用者がボス(敵)側なので
      // 「相手陣営」はパーティを指す。プレイヤー側スキルと全く同じ解釈で成立する。
      if (skill.target === 'all_enemies') {
        return { type: 'skill', skillId: skill.id, targets: this.getAliveAllies() };
      }
      if (skill.target === 'self') {
        return { type: 'skill', skillId: skill.id, targets: [enemy] };
      }
      const target = targets[Math.floor(Math.random() * targets.length)];
      return { type: 'skill', skillId: skill.id, targets: [target] };
    }

    const target = targets[Math.floor(Math.random() * targets.length)];
    return { type: 'attack', targets: [target] };
  }

  // --- 行動実行 -----------------------------------------------------

  // action = { type: 'attack'|'skill'|'guard'|'persuade'|'flee', skillId?, targets? }
  // 戻り値: メッセージログの配列 [{ text }]
  executeAction(actor, action) {
    switch (action.type) {
      case 'attack':
        return this._executeSkillAction(actor, Skill.basicAttack(), action.targets ?? []);
      case 'skill':
        return this._executeSkillAction(
          actor,
          new Skill(action.skillId, this.skillData[action.skillId] ?? {}),
          action.targets ?? []
        );
      case 'guard':
        actor.guarding = true;
        return [{ text: `${actor.name}は身を守っている。` }];
      case 'persuade':
        return this._executePersuade(actor, action.targets?.[0]);
      case 'flee':
        return this._executeFlee();
      default:
        return [];
    }
  }

  _executeSkillAction(actor, skill, targets) {
    const messages = [];

    if (actor.mp < skill.mpCost) {
      messages.push({ text: `${actor.name}はMPが足りない！` });
      return messages;
    }
    actor.mp -= skill.mpCost;

    if (skill.type === 'buff') {
      const target = targets[0] ?? actor;
      const result = skill.apply(actor, target);
      if (result.applied) {
        target.applyStatusEffect(new StatusEffect(result.statusEffect.id, result.statusEffect));
        messages.push({ text: `${actor.name}は${skill.name}を使った！` });
        messages.push({ text: `${target.name}の様子が変わった！` });
      }
      return messages;
    }

    if (skill.type === 'heal') {
      messages.push({ text: `${actor.name}は${skill.name}を使った！` });
      for (const target of targets) {
        if (!target.isAlive) continue;
        const result = skill.apply(actor, target);
        target.heal(result.healAmount);
        messages.push({ text: `${target.name}のHPが${result.healAmount}回復した！` });
      }
      return messages;
    }

    const actionLabel = skill.id === 'attack' ? '攻撃' : skill.name;
    messages.push({ text: `${actor.name}の${actionLabel}！` });

    for (const target of targets) {
      for (let i = 0; i < skill.hits; i++) {
        if (!target.isAlive) break;

        const result = skill.apply(actor, target);
        if (result.missed) {
          messages.push({ text: `${target.name}には当たらなかった…` });
          continue;
        }

        target.takeDamage(result.damage);
        const critText = result.critical ? '会心の一撃！ ' : '';
        messages.push({ text: `${critText}${target.name}に${result.damage}のダメージ！` });

        if (!target.isAlive) {
          messages.push({ text: `${target.name}を倒した！` });
          if (target instanceof Enemy) {
            // Gルート判定用: 倒した敵の数をカウント(通常戦闘も含む、UNDERTALE的な虐殺数の考え方)
            this.eventManager?.incrementCounter('genocide_kills');
            // クエストの討伐目標(QuestManager)用に敵id別のカウンターも積む
            this.eventManager?.incrementCounter(`defeated_${target.id}`);
          }
        }
      }

      // 第二形態への変身判定(Stage9:ボス)。撃破はしていないが瀕死になった瞬間、
      // hasSecondFormを持つボスのみ一度だけ発動する(Enemy#triggerSecondForm側で二重発動防止)。
      if (
        target instanceof Enemy &&
        target.isAlive &&
        target.hasSecondForm &&
        !target.secondFormTriggered &&
        target.hp <= target.maxHp * 0.4
      ) {
        const info = target.triggerSecondForm();
        if (info) {
          messages.push({ text: `${target.name}の様子が豹変した…！ 真の力を解放した！` });
        }
      }
    }

    return messages;
  }

  _executePersuade(actor, target) {
    if (!target) return [];
    const messages = [];

    if (!(target instanceof Enemy) || !target.persuadable) {
      messages.push({ text: `${target.name}には効果がなかった…` });
      return messages;
    }

    // 残りHPが少ないほど、説得者のluckが高いほど成功しやすい
    const hpRatio = target.maxHp > 0 ? target.hp / target.maxHp : 1;
    const chance = Math.min(
      0.9,
      0.35 + (1 - hpRatio) * 0.4 + actor.getEffectiveStat('luck') * 0.01
    );

    if (Math.random() < chance) {
      target.tryPersuade();
      this.eventManager?.incrementCounter('persuaded_enemies');
      messages.push({ text: `${target.name}を説得した！ 戦意を失ったようだ。` });
    } else {
      messages.push({ text: `${target.name}には響かなかった…` });
    }

    return messages;
  }

  _executeFlee() {
    const allies = this.getAliveAllies();
    const enemies = this.getAliveEnemies();

    const avgPartySpd =
      allies.reduce((sum, m) => sum + m.getEffectiveStat('spd'), 0) / Math.max(1, allies.length);
    const avgEnemySpd =
      enemies.reduce((sum, e) => sum + e.getEffectiveStat('spd'), 0) / Math.max(1, enemies.length);

    const chance = Math.min(0.95, Math.max(0.1, 0.5 + (avgPartySpd - avgEnemySpd) * 0.01));

    if (Math.random() < chance) {
      this.ended = true;
      this.result = 'fled';
      return [{ text: 'うまく逃げ切れた！' }];
    }
    return [{ text: '逃げられなかった！' }];
  }

  // --- 終了判定/報酬 -----------------------------------------------------

  checkBattleEnd() {
    if (this.ended) return this.result;

    if (this.party.isPartyWiped()) {
      this.ended = true;
      this.result = 'defeat';
      return this.result;
    }

    if (this.getAliveEnemies().length === 0) {
      this.ended = true;
      this.result = 'victory';
      return this.result;
    }

    return null;
  }

  // 勝利時に呼び出す。撃破した敵の経験値を前衛全員に付与する
  // (説得のみで済んだ敵は経験値対象外。Enemy側のpersuaded/isAliveを見て判定)
  grantRewards() {
    const defeatedEnemies = this.enemies.filter((e) => !e.isAlive);
    const totalExp = defeatedEnemies.reduce((sum, e) => sum + (e.expReward ?? 0), 0);
    const levelResults = this.party.gainExpAll(totalExp);
    return { totalExp, levelResults, defeatedEnemies };
  }
}
