// Menu.js
// 汎用選択メニュー(戦闘コマンド、会話選択肢、アイテムメニュー等で共用)。
// カーソル移動(moveUp/moveDown)と決定(getSelected)のロジックのみを持ち、
// 実際の描画はUIManager.drawMenuListに委譲する(ロジックと見た目の分離)。
// これにより新しいメニュー画面を追加する際もMenuクラス自体は変更不要。

import { UIManager } from './UIManager.js';

export class Menu {
  constructor(options = []) {
    this.options = options;
    this.selectedIndex = 0;
  }

  moveUp() {
    if (this.options.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.options.length) % this.options.length;
  }

  moveDown() {
    if (this.options.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.options.length;
  }

  getSelected() {
    return this.options[this.selectedIndex];
  }

  // UIManagerへの薄い委譲。列数や行間を変えたい場合は呼び出し元でuiOptionsを渡す。
  render(ctx, x, y, uiOptions = {}) {
    UIManager.drawMenuList(ctx, this, x, y, uiOptions);
  }
}
