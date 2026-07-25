// DialogueScene.js
// 会話システムの本実装(Stage4イベントで実装、Stage6でUIManager/DialogueBox/Menuへ統合)。
//
// 対応データ形式(src/data/dialogues/*.json):
// {
//   "id": "...",
//   "entry": [                      // 会話開始ノードを条件付きで決定(先勝ち。条件無しは常にtrue=デフォルト)
//     { "condition": {"counter":"affection_riria","gte":2}, "node":"repeat_friendly" },
//     { "condition": {"flag":"met_riria","equals":true}, "node":"repeat_neutral" },
//     { "node": "start" }
//   ],
//   "nodes": {
//     "start": { "speaker":"riria", "text":"...", "next":"n2", "effects":[...] },
//     "n2": { "speaker":"player", "choices": [
//       { "text":"選択肢A", "effects":[{"type":"affection","target":"riria","amount":2}], "next":"a" },
//       { "text":"選択肢B", "next":"b" }
//     ]}
//   }
// }
//
// effects の種類:
//   { "type":"flag", "name":"met_riria", "value":true }     -> EventManager.setFlag
//   { "type":"counter", "name":"some_counter", "amount":1 } -> EventManager.incrementCounter
//   { "type":"affection", "target":"riria", "amount":2 }    -> counter "affection_riria" を増減
//   { "type":"openQuestBoard" }                              -> 返り先(MapScene)のクエスト掲示板を開く(Stage8)
//
// next が null のノードで会話終了、呼び出し元(MapScene)へ復帰する。
//
// 描画は共通UI部品に委譲する:
//   - セリフの1文字ずつ表示演出/枠描画 -> DialogueBox
//   - 選択肢のカーソル移動/一覧描画    -> Menu + UIManager

import { loadJSON } from '../utils/helpers.js';
import { Menu } from '../ui/Menu.js';
import { DialogueBox } from '../ui/DialogueBox.js';
import { UIManager, PALETTE } from '../ui/UIManager.js';

export class DialogueScene {
  constructor(game, dialogueId, { returnTo = null } = {}) {
    this.game = game;
    this.dialogueId = dialogueId;
    this.returnTo = returnTo;

    this.data = null;
    this.loaded = false;

    this.currentNode = null;
    this.menu = null; // 選択肢がある場合のみセット
    this.dialogueBox = new DialogueBox();
  }

  async onEnter() {
    try {
      this.data = await loadJSON(`./src/data/dialogues/${this.dialogueId}.json`);
    } catch (e) {
      this.data = {
        entry: [{ node: 'missing' }],
        nodes: { missing: { speaker: 'system', text: '（この会話はまだ準備中です）', next: null } },
      };
    }

    const startNodeId = this._resolveEntryNode(this.data.entry ?? [{ node: 'start' }]);
    this._enterNode(startNodeId);
    this.loaded = true;
  }

  // --- 条件評価 -----------------------------------------------------

  _resolveEntryNode(entryList) {
    const eventManager = this.game.eventManager;
    for (const entry of entryList) {
      if (this._evalCondition(entry.condition, eventManager)) {
        return entry.node;
      }
    }
    return entryList[entryList.length - 1]?.node;
  }

  _evalCondition(cond, eventManager) {
    if (!cond) return true; // 条件無し = 常に真(デフォルトのフォールバックとして使う)

    if ('flag' in cond) {
      const value = eventManager.getFlag(cond.flag);
      return 'equals' in cond ? value === cond.equals : !!value;
    }
    if ('counter' in cond) {
      const value = eventManager.getCounter(cond.counter);
      if ('gte' in cond) return value >= cond.gte;
      if ('lte' in cond) return value <= cond.lte;
      if ('equals' in cond) return value === cond.equals;
    }
    return true;
  }

  // --- ノード遷移 -----------------------------------------------------

  _enterNode(nodeId) {
    const node = this.data.nodes[nodeId];
    if (!node) {
      console.warn(`[DialogueScene] ノードが見つかりません: ${nodeId}`);
      this._end();
      return;
    }

    this.currentNode = node;
    this.menu = null;

    // ノードに到達した時点で効果を適用(会話進行と切り離して即時反映)
    this._applyEffects(node.effects);

    // 'openQuestBoard'効果が発火した場合は、このノードのテキスト/選択肢を描画せず
    // 即座に呼び出し元(MapScene)のクエスト掲示板を開いて復帰する(Stage8:クエスト)。
    if (this._pendingOpenQuestBoard) {
      this._pendingOpenQuestBoard = false;
      this._openQuestBoardAndReturn();
      return;
    }

    if (node.choices) {
      this.menu = new Menu(node.choices.map((c) => c.text));
    } else {
      this.dialogueBox.setText(node.text ?? '', node.speaker ?? '');
    }
  }

  _applyEffects(effects = []) {
    const eventManager = this.game.eventManager;
    for (const effect of effects ?? []) {
      if (effect.type === 'flag') {
        eventManager.setFlag(effect.name, effect.value ?? true);
      } else if (effect.type === 'counter') {
        eventManager.incrementCounter(effect.name, effect.amount ?? 1);
      } else if (effect.type === 'affection') {
        eventManager.incrementCounter(`affection_${effect.target}`, effect.amount ?? 1);
      } else if (effect.type === 'openQuestBoard') {
        // ここでは呼び出し元(MapScene)への遷移フラグを立てるだけに留める。
        // 実際のシーン遷移は_enterNode側でノードの他の処理より先に行う。
        this._pendingOpenQuestBoard = true;
      }
    }
  }

  // ギルド受付嬢などの会話から「依頼掲示板を見る」を選んだ時に呼ばれる。
  // MapScene側に掲示板を開いてもらった上で、このDialogueSceneからMapSceneへ復帰する。
  _openQuestBoardAndReturn() {
    if (this.returnTo && typeof this.returnTo._openQuestBoard === 'function') {
      this.returnTo._openQuestBoard();
      this.game.sceneManager.changeScene(this.returnTo);
    } else {
      this._end();
    }
  }

  _end() {
    if (this.returnTo) {
      this.game.sceneManager.changeScene(this.returnTo);
    }
  }

  // --- 更新 -----------------------------------------------------

  update(deltaTime) {
    if (!this.loaded) return;

    if (this.currentNode.choices) {
      this._updateChoice();
    } else {
      this._updateLine(deltaTime);
    }

    this.game.input.clearFrame();
  }

  _updateLine(deltaTime) {
    this.dialogueBox.update(deltaTime);

    const advancePressed = this.game.input.wasPressed('z') || this.game.input.wasPressed('Enter');
    if (!advancePressed) return;

    if (!this.dialogueBox.isFullyRevealed()) {
      // 表示中なら即座に全文表示(演出スキップ)
      this.dialogueBox.skipReveal();
    } else if (this.currentNode.next) {
      this._enterNode(this.currentNode.next);
    } else {
      this._end();
    }
  }

  _updateChoice() {
    const input = this.game.input;
    if (input.wasPressed('ArrowUp') || input.wasPressed('w')) this.menu.moveUp();
    if (input.wasPressed('ArrowDown') || input.wasPressed('s')) this.menu.moveDown();

    if (input.wasPressed('z') || input.wasPressed('Enter')) {
      const chosen = this.currentNode.choices[this.menu.selectedIndex];
      this._applyEffects(chosen.effects);
      if (chosen.next) {
        this._enterNode(chosen.next);
      } else {
        this._end();
      }
    }
  }

  // --- 描画 -----------------------------------------------------

  render(ctx) {
    const { width, height } = ctx.canvas;

    if (this.returnTo && this.returnTo.render) {
      this.returnTo.render(ctx); // 背景としてマップを表示
    }

    if (!this.loaded) return;

    const boxHeight = 130;
    const boxY = height - boxHeight - 20;
    const boxX = 20;
    const boxW = width - 40;

    if (this.currentNode.choices) {
      this._renderChoices(ctx, boxX, boxY, boxW, boxHeight);
    } else {
      const fullyRevealed = this.dialogueBox.isFullyRevealed();
      const hint = fullyRevealed
        ? this.currentNode.next
          ? 'Z/Enterで次へ'
          : 'Z/Enterで会話終了'
        : 'Z/Enterでスキップ';
      this.dialogueBox.render(ctx, boxX, boxY, boxW, boxHeight, { hint });
    }
  }

  _renderChoices(ctx, x, y, w, h) {
    UIManager.drawPanel(ctx, x, y, w, h);

    ctx.fillStyle = PALETTE.textHighlight;
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('どうする?', x + 20, y + 24);

    this.menu.render(ctx, x + 30, y + 52, { rowHeight: 26 });

    UIManager.drawHint(ctx, '↑↓で選択 / Z・Enterで決定', x + w - 20, y + h - 12);
  }

  onExit() {}
}
