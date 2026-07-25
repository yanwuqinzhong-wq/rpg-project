// MapScene.js
// フィールド表示、プレイヤー移動、NPC接触、エンカウント判定を担当する。
//
// 責務分離のポイント:
// - タイルの意味/当たり判定は TileMap に委譲
// - NPC接触判定は NPC クラス、エンカウント判定は EncounterZone クラスに委譲
// - このクラス自身は「入力を受けて誰を動かし、何が起きたら次に何をするか」の
//   調整役(コントローラー)に徹する

import { TileMap } from '../map/TileMap.js';
import { NPC } from '../map/NPC.js';
import { EncounterZone } from '../map/EncounterZone.js';
import { MapPlayer } from '../entities/MapPlayer.js';
import { loadJSON, formatSaveSlotLabel } from '../utils/helpers.js';
import { DialogueScene } from './DialogueScene.js';
import { BattleScene } from './BattleScene.js';
import { Menu } from '../ui/Menu.js';
import { UIManager, PALETTE } from '../ui/UIManager.js';

const DIRECTION_KEYS = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
};

export class MapScene {
  constructor(game, mapId, { initialPlayerState = null } = {}) {
    this.game = game;
    this.mapId = mapId;
    this.initialPlayerState = initialPlayerState; // ロード時の復帰座標(Stage7:セーブ)

    this.tileMap = null;
    this.npcs = [];
    this.encounterZones = [];
    this.player = null;

    this.loaded = false;
    this.message = null; // 画面下部の一時メッセージ(壁にぶつかった時など)
    this.messageTimer = 0;

    this.state = 'field'; // 'field' | 'menu' | 'status' | 'quest' | 'save'
    this.mainMenu = null; // Xキーで開くメインメニュー(Stage7でセーブ項目を追加、Stage8でクエスト項目を追加)
    this.statusMenu = null; // パーティステータス画面用のカーソル(Stage6:UI)
    this.questMenu = null; // クエスト掲示板用のカーソル(Stage8:クエスト)
    this._questEntries = []; // questMenuの各行に対応するクエスト情報([{id, status}])
    this.saveMenu = null; // セーブスロット選択用のカーソル(Stage7:セーブ)
  }

  async onEnter() {
    const data = await loadJSON(`./src/data/maps/${this.mapId}.json`);

    this.tileMap = new TileMap(data);
    this.npcs = data.npcs.map((n) => new NPC(n));
    this.encounterZones = (data.encounterZones ?? []).map((z) => new EncounterZone(z));
    this.exits = data.exits ?? [];

    const spawn = this.initialPlayerState ?? data.playerSpawn ?? { x: 1, y: 1 };
    this.player = new MapPlayer(spawn.x, spawn.y, this.tileMap.tileSize);
    if (this.initialPlayerState?.direction) {
      this.player.direction = this.initialPlayerState.direction;
    }

    this.loaded = true;
  }

  update(deltaTime) {
    if (!this.loaded) return;

    if (this.messageTimer > 0) {
      this.messageTimer -= deltaTime;
      if (this.messageTimer <= 0) this.message = null;
    }

    if (this.state === 'menu') {
      this._updateMainMenu();
      this.game.input.clearFrame();
      return;
    }
    if (this.state === 'status') {
      this._updateStatusMenu();
      this.game.input.clearFrame();
      return;
    }
    if (this.state === 'quest') {
      this._updateQuestMenu();
      this.game.input.clearFrame();
      return;
    }
    if (this.state === 'save') {
      this._updateSaveMenu();
      this.game.input.clearFrame();
      return;
    }

    this.player.update(deltaTime);

    if (!this.player.isMoving) {
      this._handleInput();
    }

    this.game.input.clearFrame();
  }

  _handleInput() {
    const input = this.game.input;

    // インタラクト(会話開始)
    if (input.wasPressed('z') || input.wasPressed('Enter')) {
      this._tryInteract();
      return;
    }

    // メインメニュー(Stage6:UI / Stage7:セーブ)
    if (input.wasPressed('x')) {
      this._openMainMenu();
      return;
    }

    for (const [key, [dx, dy]] of Object.entries(DIRECTION_KEYS)) {
      if (input.isDown(key)) {
        this._tryMove(dx, dy);
        return; // 1フレームで1方向のみ処理
      }
    }
  }

  _openMainMenu() {
    this.state = 'menu';
    this.mainMenu = new Menu(['ステータス', 'クエスト', 'セーブ', 'とじる']);
  }

  _updateMainMenu() {
    const input = this.game.input;
    if (input.wasPressed('ArrowUp') || input.wasPressed('w')) this.mainMenu.moveUp();
    if (input.wasPressed('ArrowDown') || input.wasPressed('s')) this.mainMenu.moveDown();

    if (input.wasPressed('x') || input.wasPressed('Escape')) {
      this.state = 'field';
      return;
    }
    if (!(input.wasPressed('z') || input.wasPressed('Enter'))) return;

    const selected = this.mainMenu.getSelected();
    if (selected === 'ステータス') {
      this._openStatusMenu();
    } else if (selected === 'クエスト') {
      this._openQuestBoard();
    } else if (selected === 'セーブ') {
      this._openSaveMenu();
    } else {
      this.state = 'field';
    }
  }

  _openStatusMenu() {
    this.state = 'status';
    this.statusMenu = new Menu(this.game.party.active.map((m) => m.id));
  }

  _updateStatusMenu() {
    const input = this.game.input;
    if (this.game.party.active.length > 0) {
      if (input.wasPressed('ArrowUp') || input.wasPressed('w')) this.statusMenu.moveUp();
      if (input.wasPressed('ArrowDown') || input.wasPressed('s')) this.statusMenu.moveDown();
    }
    if (input.wasPressed('x') || input.wasPressed('Escape') || input.wasPressed('z') || input.wasPressed('Enter')) {
      this.state = 'field';
    }
  }

  // クエスト掲示板(Stage8:クエスト)。ギルド受付嬢の会話(effects:'openQuestBoard')から
  // 呼ばれる想定だが、Xメニューの「クエスト」からも直接開けるようにしてある(現在受注中の
  // 依頼の進行度確認だけしたい場合に、わざわざNPCの元まで戻らずに済むように)。
  _openQuestBoard() {
    this.state = 'quest';
    this._rebuildQuestMenu();
  }

  _rebuildQuestMenu() {
    this._questEntries = this._buildQuestEntries();
    const labels = this._questEntries.map((e) => this._questLabel(e)).concat(['もどる']);
    this.questMenu = new Menu(labels);
  }

  // 受注可能/進行中/達成済みのいずれかに該当するクエストのみを一覧に出す
  // (ランク未達などでまだ受けられない依頼は掲示板に載らない=隠しクエストを自然に表現できる)。
  _buildQuestEntries() {
    const qm = this.game.questManager;
    const entries = [];
    for (const id of qm.getAllQuestIds()) {
      if (qm.isCompleted(id)) entries.push({ id, status: 'completed' });
      else if (qm.isAccepted(id)) entries.push({ id, status: 'active' });
      else if (qm.isAvailable(id)) entries.push({ id, status: 'available' });
    }
    return entries;
  }

  _questLabel(entry) {
    const qm = this.game.questManager;
    const quest = qm.getQuest(entry.id);
    if (entry.status === 'completed') return `✓ ${quest.name}（達成済み）`;
    if (entry.status === 'available') return `☆ ${quest.name}（受注可能／${quest.requiredRank}ランク）`;

    // active
    if (quest.objective?.type === 'battle') {
      return `▶ ${quest.name}（挑戦可能）`;
    }
    const progress = qm.getObjectiveProgress(entry.id);
    if (progress.met) return `● ${quest.name}（報告可能！）`;
    return `… ${quest.name}（${progress.current}/${progress.required}）`;
  }

  _updateQuestMenu() {
    const input = this.game.input;
    if (input.wasPressed('ArrowUp') || input.wasPressed('w')) this.questMenu.moveUp();
    if (input.wasPressed('ArrowDown') || input.wasPressed('s')) this.questMenu.moveDown();

    if (input.wasPressed('x') || input.wasPressed('Escape')) {
      this.state = 'field';
      return;
    }
    if (!(input.wasPressed('z') || input.wasPressed('Enter'))) return;

    const idx = this.questMenu.selectedIndex;
    if (idx >= this._questEntries.length) {
      // 「もどる」
      this.state = 'field';
      return;
    }

    const entry = this._questEntries[idx];
    const qm = this.game.questManager;

    if (entry.status === 'completed') {
      this._showMessage('（達成済みの依頼です）');
      return;
    }

    if (entry.status === 'available') {
      qm.acceptQuest(entry.id);
      this._showMessage(`「${qm.getQuest(entry.id).name}」を受注した`);
      this._rebuildQuestMenu();
      return;
    }

    // active
    const quest = qm.getQuest(entry.id);
    if (quest.objective?.type === 'battle') {
      // 掲示板から直接その敵への挑戦を開始する(勝利すればBattleScene側で自動的に達成処理される)。
      this.state = 'field';
      this.game.sceneManager.changeScene(
        new BattleScene(this.game, {
          enemyIds: [quest.objective.enemyId],
          returnTo: this,
          questId: entry.id,
        })
      );
      return;
    }

    const progress = qm.getObjectiveProgress(entry.id);
    if (!progress.met) {
      this._showMessage('まだ目標を達成していない');
      return;
    }

    const result = qm.completeQuest(entry.id);
    if (result) {
      if (result.rewards.exp) this.game.party.gainExpAll(result.rewards.exp);
      this._showMessage(`「${result.quest.name}」を報告した！ 報酬を受け取った`);
    }
    this._rebuildQuestMenu();
  }

  // セーブスロット選択(Stage7:セーブ)。既存スロットは上書き確認なしで即保存する
  // (スロットの中身はメニュー上で日時・パーティ名として常に見えているため)。
  _openSaveMenu() {
    this.state = 'save';
    this._rebuildSaveMenu();
  }

  _rebuildSaveMenu() {
    const saves = this.game.saveManager.listSaves();
    const labels = saves.map((s) => formatSaveSlotLabel(s.data, s.slot)).concat(['もどる']);
    this.saveMenu = new Menu(labels);
  }

  _updateSaveMenu() {
    const input = this.game.input;
    if (input.wasPressed('ArrowUp') || input.wasPressed('w')) this.saveMenu.moveUp();
    if (input.wasPressed('ArrowDown') || input.wasPressed('s')) this.saveMenu.moveDown();

    if (input.wasPressed('x') || input.wasPressed('Escape')) {
      this.state = 'menu';
      return;
    }
    if (!(input.wasPressed('z') || input.wasPressed('Enter'))) return;

    const idx = this.saveMenu.selectedIndex;
    const slotCount = this.game.saveManager.maxSlots;
    if (idx >= slotCount) {
      this.state = 'menu';
      return;
    }

    const ok = this.game.saveGame(idx);
    this.state = 'field';
    this._showMessage(ok ? `スロット${idx + 1}にセーブしました` : 'セーブに失敗しました');
  }

  _tryMove(dx, dy) {
    const targetX = this.player.gridX + dx;
    const targetY = this.player.gridY + dy;

    // 向き変更だけ先に反映(壁でも振り向ける方が操作感が良い)
    if (dx < 0) this.player.direction = 'left';
    else if (dx > 0) this.player.direction = 'right';
    else if (dy < 0) this.player.direction = 'up';
    else if (dy > 0) this.player.direction = 'down';

    if (!this.tileMap.isWalkable(targetX, targetY)) {
      this._showMessage('（進めない）');
      return;
    }

    const blockingNpc = this.npcs.find((n) => n.blocking && n.isAt(targetX, targetY));
    if (blockingNpc) {
      this._showMessage(`（${blockingNpc.name}がいる）`);
      return;
    }

    this.player.startMove(dx, dy);
    this._checkEncounter(targetX, targetY);
    this._checkExit(targetX, targetY);
  }

  _tryInteract() {
    const facing = this.player.getFacingTile();
    const npc = this.npcs.find((n) => n.isAt(facing.x, facing.y));
    if (!npc) return;

    if (npc.dialogueId) {
      this.game.sceneManager.changeScene(
        new DialogueScene(this.game, npc.dialogueId, { returnTo: this }),
        { keepPrevious: true }
      );
    }
  }

  _checkEncounter(x, y) {
    for (const zone of this.encounterZones) {
      if (!zone.contains(x, y)) continue;
      const enemyId = zone.rollEncounter();
      if (enemyId) {
        this.game.sceneManager.changeScene(
          new BattleScene(this.game, { enemyIds: [enemyId], returnTo: this })
        );
        return;
      }
    }
  }

  _checkExit(x, y) {
    const exit = this.exits.find((e) => e.x === x && e.y === y);
    if (exit) {
      // ダンジョン等の別マップはStage3後半/以降のコンテンツ追加で対応。
      // 現段階では未実装であることをメッセージで示す。
      this._showMessage(`（${exit.targetMap} は準備中）`);
    }
  }

  _showMessage(text) {
    this.message = text;
    this.messageTimer = 1.2;
  }

  render(ctx) {
    const { width, height } = ctx.canvas;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    if (!this.loaded) {
      ctx.fillStyle = '#fff';
      ctx.font = '20px sans-serif';
      ctx.fillText('読み込み中...', 20, 30);
      return;
    }

    this._renderTiles(ctx);
    this._renderNpcs(ctx);
    this._renderPlayer(ctx);
    this._renderUi(ctx);

    if (this.state === 'status') {
      this._renderStatusOverlay(ctx, width, height);
    } else if (this.state === 'quest') {
      this._renderQuestOverlay(ctx, width, height);
    } else if (this.state === 'menu') {
      this._renderMainMenuOverlay(ctx, width, height);
    } else if (this.state === 'save') {
      this._renderSaveOverlay(ctx, width, height);
    }
  }

  _renderTiles(ctx) {
    const ts = this.tileMap.tileSize;
    const colors = {
      grass: '#3a6b35',
      wall: '#4a4a52',
      path: '#8a7550',
      water_edge: '#3a7a8a',
      water: '#1a4a6a',
    };

    for (let y = 0; y < this.tileMap.height; y++) {
      for (let x = 0; x < this.tileMap.width; x++) {
        const tile = this.tileMap.getTileTypeAt(x, y);
        ctx.fillStyle = colors[tile?.name] ?? '#111';
        ctx.fillRect(x * ts, y * ts, ts, ts);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.strokeRect(x * ts, y * ts, ts, ts);
      }
    }

    // エンカウントゾーンを薄く色付けして視認できるようにする(デバッグ表示兼ねる)
    ctx.fillStyle = 'rgba(200,50,50,0.15)';
    for (const zone of this.encounterZones) {
      ctx.fillRect(zone.x * ts, zone.y * ts, zone.width * ts, zone.height * ts);
    }
  }

  _renderNpcs(ctx) {
    const ts = this.tileMap.tileSize;
    for (const npc of this.npcs) {
      ctx.fillStyle = npc.color;
      ctx.fillRect(npc.x * ts + 4, npc.y * ts + 4, ts - 8, ts - 8);
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(npc.name, npc.x * ts + ts / 2, npc.y * ts - 4);
    }
  }

  _renderPlayer(ctx) {
    const ts = this.tileMap.tileSize;
    ctx.fillStyle = '#ffd45c';
    ctx.fillRect(this.player.pixelX + 4, this.player.pixelY + 4, ts - 8, ts - 8);

    // 向いている方向を示す小さな三角(スプライト未実装のための簡易表現)
    ctx.fillStyle = '#000';
    const cx = this.player.pixelX + ts / 2;
    const cy = this.player.pixelY + ts / 2;
    const dirOffsets = { down: [0, 8], up: [0, -8], left: [-8, 0], right: [8, 0] };
    const [ox, oy] = dirOffsets[this.player.direction];
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  _renderUi(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, ctx.canvas.height - 28, ctx.canvas.width, 28);
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      this.message ?? '矢印キー/WASD: 移動   Z/Enter: 話す   X: メニュー',
      10,
      ctx.canvas.height - 9
    );
  }

  // パーティステータス画面(Stage6:UI)。マップを暗転させた上にパネルを重ねて表示する。
  _renderStatusOverlay(ctx, width, height) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, width, height);

    const party = this.game.party;
    const rowHeight = 60;
    const panelW = 420;
    const panelH = 78 + Math.max(1, party.active.length) * rowHeight;
    const panelX = (width - panelW) / 2;
    const panelY = (height - panelH) / 2;

    UIManager.drawPanel(ctx, panelX, panelY, panelW, panelH);

    ctx.fillStyle = PALETTE.textHighlight;
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('パーティ', panelX + 20, panelY + 28);

    const gold = this.game.eventManager.getCounter('gold');
    const rank = this.game.questManager.getGuildRank();
    ctx.fillStyle = PALETTE.textSub;
    ctx.font = '13px sans-serif';
    ctx.fillText(`ギルドランク: ${rank}　所持金: ${gold}G`, panelX + 20, panelY + 46);

    if (party.active.length === 0) {
      ctx.fillStyle = PALETTE.textSub;
      ctx.font = '14px sans-serif';
      ctx.fillText('（仲間がいません）', panelX + 20, panelY + 80);
    } else {
      party.active.forEach((member, i) => {
        const y = panelY + 78 + i * rowHeight;
        const selected = this.statusMenu && this.statusMenu.selectedIndex === i;
        UIManager.drawStatBlock(ctx, panelX + 20, y, panelW - 40, member, {
          highlighted: selected,
          showGuard: false,
        });
      });
    }

    UIManager.drawHint(ctx, 'X・Escで閉じる', panelX + panelW - 20, panelY + panelH - 12);
  }

  // クエスト掲示板(Stage8:クエスト)。受注可能/進行中(進行度・報告可否)/達成済みを一覧表示する。
  _renderQuestOverlay(ctx, width, height) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, width, height);

    const panelW = 620;
    const panelH = 420;
    const panelX = (width - panelW) / 2;
    const panelY = (height - panelH) / 2;

    UIManager.drawPanel(ctx, panelX, panelY, panelW, panelH);

    ctx.fillStyle = PALETTE.textHighlight;
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ギルド依頼掲示板', panelX + 20, panelY + 30);

    const gold = this.game.eventManager.getCounter('gold');
    const rank = this.game.questManager.getGuildRank();
    ctx.fillStyle = PALETTE.textSub;
    ctx.font = '13px sans-serif';
    ctx.fillText(`ギルドランク: ${rank}　所持金: ${gold}G`, panelX + 20, panelY + 50);

    if (this._questEntries.length === 0) {
      ctx.fillStyle = PALETTE.textSub;
      ctx.font = '14px sans-serif';
      ctx.fillText('（現在受けられる依頼はありません）', panelX + 20, panelY + 88);
    }

    this.questMenu.render(ctx, panelX + 24, panelY + 100, { rowHeight: 26, colWidth: panelW - 48 });

    UIManager.drawHint(ctx, 'X・Escでもどる / Z・Enterで選択', panelX + panelW - 20, panelY + panelH - 14);
  }

  // Xキーのメインメニュー(Stage7:セーブ)。ステータス/セーブ画面を開くための入口。
  _renderMainMenuOverlay(ctx, width, height) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, width, height);

    const panelW = 220;
    const panelH = 130;
    const panelX = (width - panelW) / 2;
    const panelY = (height - panelH) / 2;

    UIManager.drawPanel(ctx, panelX, panelY, panelW, panelH);
    this.mainMenu.render(ctx, panelX + 24, panelY + 34, { rowHeight: 30 });
    UIManager.drawHint(ctx, 'X・Escで閉じる', panelX + panelW - 16, panelY + panelH - 12);
  }

  // セーブスロット選択画面(Stage7:セーブ)。日時とパーティ構成を一覧表示する。
  _renderSaveOverlay(ctx, width, height) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, width, height);

    const panelW = 560;
    const panelH = 220;
    const panelX = (width - panelW) / 2;
    const panelY = (height - panelH) / 2;

    UIManager.drawPanel(ctx, panelX, panelY, panelW, panelH);

    ctx.fillStyle = PALETTE.textHighlight;
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('セーブ先を選んでください', panelX + 20, panelY + 32);

    this.saveMenu.render(ctx, panelX + 24, panelY + 68, { rowHeight: 30 });

    UIManager.drawHint(ctx, 'X・Escでもどる', panelX + panelW - 20, panelY + panelH - 14);
  }

  onExit() {}
}
