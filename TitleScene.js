// TitleScene.js
// 起動直後に表示されるタイトル画面。
// 「はじめから」で新規パーティを整えてルミナスへ、「つづきから」でセーブスロットを
// 選んでロードする(Stage7:セーブ)。

import { MapScene } from './MapScene.js';
import { Menu } from '../ui/Menu.js';
import { UIManager, PALETTE } from '../ui/UIManager.js';
import { formatSaveSlotLabel } from '../utils/helpers.js';

export class TitleScene {
  constructor(game) {
    this.game = game;
    this.blinkTimer = 0;
    this.showPrompt = true;

    this.state = 'title'; // 'title' | 'menu' | 'load'
    this.menu = null;
    this.loadMenu = null;
    this._loadSlotData = [];
    this.infoMessage = null; // 「セーブデータがありません」等の一時メッセージ
  }

  onEnter() {
    console.log('[TitleScene] enter');
  }

  update(deltaTime) {
    this.blinkTimer += deltaTime;
    if (this.blinkTimer > 0.6) {
      this.blinkTimer = 0;
      this.showPrompt = !this.showPrompt;
    }

    if (this.state === 'title') {
      this._updateTitle();
    } else if (this.state === 'menu') {
      this._updateMenu();
    } else if (this.state === 'load') {
      this._updateLoadMenu();
    }

    this.game.input.clearFrame();
  }

  _updateTitle() {
    if (this.game.input.wasPressed('Enter') || this.game.input.wasPressed('z')) {
      this.state = 'menu';
      this.menu = new Menu(['はじめから', 'つづきから']);
    }
  }

  _updateMenu() {
    const input = this.game.input;
    if (input.wasPressed('ArrowUp') || input.wasPressed('w')) this.menu.moveUp();
    if (input.wasPressed('ArrowDown') || input.wasPressed('s')) this.menu.moveDown();
    if (input.wasPressed('Escape')) {
      this.state = 'title';
      return;
    }
    if (!(input.wasPressed('z') || input.wasPressed('Enter'))) return;

    const selected = this.menu.getSelected();
    if (selected === 'はじめから') {
      this.game.newGameParty();
      this.game.sceneManager.changeScene(new MapScene(this.game, 'luminas'));
    } else if (selected === 'つづきから') {
      this._openLoadMenu();
    }
  }

  _openLoadMenu() {
    const saves = this.game.saveManager.listSaves();
    if (saves.every((s) => !s.data)) {
      this.infoMessage = 'セーブデータがありません';
      return;
    }
    this.infoMessage = null;
    this.state = 'load';
    this._loadSlotData = saves;
    const labels = saves.map((s) => formatSaveSlotLabel(s.data, s.slot)).concat(['もどる']);
    this.loadMenu = new Menu(labels);
  }

  _updateLoadMenu() {
    const input = this.game.input;
    if (input.wasPressed('ArrowUp') || input.wasPressed('w')) this.loadMenu.moveUp();
    if (input.wasPressed('ArrowDown') || input.wasPressed('s')) this.loadMenu.moveDown();
    if (input.wasPressed('Escape')) {
      this.state = 'menu';
      return;
    }
    if (!(input.wasPressed('z') || input.wasPressed('Enter'))) return;

    const idx = this.loadMenu.selectedIndex;
    if (idx >= this._loadSlotData.length) {
      this.state = 'menu';
      return;
    }

    if (!this._loadSlotData[idx].data) {
      this.infoMessage = 'そのスロットはからっぽです';
      return;
    }

    this.infoMessage = null;
    this.game.loadGame(idx); // 成功時はGame側でMapSceneへ遷移する
  }

  render(ctx) {
    const { width, height } = ctx.canvas;

    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#f0f0f0';
    ctx.font = '48px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('大陸戦記(仮)', width / 2, height / 2 - 80);

    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText('RPG Project', width / 2, height / 2 - 44);

    if (this.state === 'title') {
      if (this.showPrompt) {
        ctx.fillStyle = PALETTE.textHighlight;
        ctx.font = '18px sans-serif';
        ctx.fillText('Enter を押してください', width / 2, height / 2 + 40);
      }
      return;
    }

    if (this.state === 'menu') {
      this._renderMenuBox(ctx, width, height, this.menu, 'はじめから / つづきから', 220);
    } else if (this.state === 'load') {
      this._renderMenuBox(ctx, width, height, this.loadMenu, 'ロードするスロットを選んでください', 420);
    }

    if (this.infoMessage) {
      ctx.fillStyle = '#e0a840';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.infoMessage, width / 2, height - 30);
    }
  }

  _renderMenuBox(ctx, width, height, menu, title, panelW) {
    const rowHeight = 30;
    const panelH = 64 + menu.options.length * rowHeight;
    const panelX = (width - panelW) / 2;
    const panelY = height / 2 - 20;

    UIManager.drawPanel(ctx, panelX, panelY, panelW, panelH);

    ctx.fillStyle = PALETTE.textHighlight;
    ctx.font = '15px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, panelX + 20, panelY + 26);

    menu.render(ctx, panelX + 24, panelY + 54, { rowHeight });
    UIManager.drawHint(ctx, 'Escでもどる', panelX + panelW - 16, panelY + panelH - 12);
  }

  onExit() {
    console.log('[TitleScene] exit');
  }
}
