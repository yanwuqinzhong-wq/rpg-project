// Game.js
// ゲーム全体のブートストラップ + メインループ管理
// ここが唯一のエントリーポイント。他のマネージャーはすべてここから初期化される。
//
// Stage7: セーブ/ロードの実処理(状態のシリアライズ/デシリアライズと
// パーティ・シーンの再構築)をここに集約する。SaveManager自体は
// 「保存先(localStorage)とのやりとり」だけを知っていて、
// 「ゲーム側の何を保存するか」は関与しない疎結合を維持している。

import { SceneManager } from './SceneManager.js';
import { EventManager } from './EventManager.js';
import { SaveManager } from './SaveManager.js';
import { Input } from './Input.js';
import { TitleScene } from '../scenes/TitleScene.js';
import { MapScene } from '../scenes/MapScene.js';
import { Party } from '../entities/Party.js';
import { Character } from '../entities/Character.js';
import { QuestManager } from '../quest/QuestManager.js';
import { loadJSON } from '../utils/helpers.js';

class Game {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    // グローバルにアクセスされる主要マネージャー群
    this.input = new Input(this.canvas);
    this.eventManager = new EventManager();
    this.saveManager = new SaveManager();
    this.sceneManager = new SceneManager(this);
    this.party = new Party();
    this.questManager = new QuestManager(this.eventManager);

    this._charactersTemplate = null; // characters.jsonの生データ(新規作成/ロード時の再構築に使う)

    this.lastTime = 0;
    this._loop = this._loop.bind(this);
  }

  async start() {
    // 仲間キャラの元データ・クエスト定義は新規作成/ロードの両方で使い回すため先に読み込んでおく
    const [charactersTemplate, questsData] = await Promise.all([
      loadJSON('./src/data/characters.json'),
      loadJSON('./src/data/quests.json'),
    ]);
    this._charactersTemplate = charactersTemplate;
    this.questManager.loadData(questsData);

    // Stage5暫定処置: 正式な仲間加入(EventManagerのフラグと連動した会話イベント経由の
    // addMember呼び出し)はStage4以降のイベント拡張で対応予定。
    // 現段階では戦闘システムの動作確認のため、起動時点で3人を前衛に加入させておく。
    this.newGameParty();

    // 最初のシーンとしてタイトル画面を登録
    this.sceneManager.changeScene(new TitleScene(this));
    requestAnimationFrame(this._loop);
  }

  // 「はじめから」用。パーティ・フラグ・クエスト進行を初期状態に戻す(セーブデータには触れない)。
  newGameParty() {
    this.party = new Party();
    for (const [id, data] of Object.entries(this._charactersTemplate)) {
      this.party.addMember(new Character(id, data));
    }
    this.eventManager.reset();
    this.questManager.reset();
  }

  // 現在マップ上にいる場合のみ保存できる(戦闘/会話の途中セーブは対応外)。
  // 戻り値: 成功したかどうか。
  saveGame(slot) {
    const scene = this.sceneManager.currentScene;
    if (!(scene instanceof MapScene) || !scene.loaded) return false;

    const state = {
      mapId: scene.mapId,
      player: {
        x: scene.player.gridX,
        y: scene.player.gridY,
        direction: scene.player.direction,
      },
      party: this.party.serialize(),
      event: this.eventManager.serialize(),
      quest: this.questManager.serialize(),
    };

    this.saveManager.save(slot, state);
    return true;
  }

  // 戻り値: 成功したかどうか。
  loadGame(slot) {
    const record = this.saveManager.load(slot);
    if (!record) return false;

    const data = record.data;

    this.party = new Party();
    for (const entry of data.party?.active ?? []) {
      const character = this._buildCharacterFromSave(entry);
      if (character) this.party.addMember(character, { toActive: true });
    }
    for (const entry of data.party?.reserve ?? []) {
      const character = this._buildCharacterFromSave(entry);
      if (character) this.party.addMember(character, { toActive: false });
    }

    this.eventManager.deserialize(data.event ?? {});
    this.questManager.deserialize(data.quest ?? {});

    this.sceneManager.changeScene(
      new MapScene(this, data.mapId, { initialPlayerState: data.player })
    );
    return true;
  }

  // セーブデータ1人分のエントリから、テンプレート(baseStats/成長率/スキルツリー定義)を
  // 元にCharacterを再構築する。テンプレートに無いid(将来削除されたキャラ等)は
  // 安全側に倒して読み飛ばす。
  _buildCharacterFromSave(entry) {
    const template = this._charactersTemplate[entry.id];
    if (!template) {
      console.warn(`セーブデータ内の未知のキャラクターIDをスキップしました: ${entry.id}`);
      return null;
    }
    const character = new Character(entry.id, template);
    character.applySaveData(entry);
    return character;
  }

  _loop(timestamp) {
    const deltaTime = (timestamp - this.lastTime) / 1000; // 秒単位
    this.lastTime = timestamp;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.sceneManager.update(deltaTime);
    this.sceneManager.render(this.ctx);

    requestAnimationFrame(this._loop);
  }
}

// ブート
const game = new Game('game-canvas');
game.start();

// デバッグ用に window にぶら下げておく（開発時のみ想定）
window.__game = game;

export { Game };
