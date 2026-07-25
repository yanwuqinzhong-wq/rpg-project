// DialogueBox.js
// 会話テキストの一文字ずつ表示演出(UNDERTALE風)を担当する部品(Stage6:UI 本実装)。
//
// DialogueScene(通常会話)とBattleScene(戦闘メッセージログ)の両方が
// 同じ演出ロジック(1文字ずつ表示/スキップ/枠描画)を使い回せるようにする。
// ロジック(reveal進行)と描画(render)の両方を持つが、状態は自分自身の
// テキスト表示分だけに閉じており、会話の分岐や戦闘進行の管理は一切持たない。

import { UIManager, PALETTE } from './UIManager.js';

const DEFAULT_CHARS_PER_SECOND = 45;

export class DialogueBox {
  constructor({ charsPerSecond = DEFAULT_CHARS_PER_SECOND } = {}) {
    this.speaker = '';
    this.currentText = '';
    this.displayedChars = 0;
    this.revealTimer = 0;
    this.charsPerSecond = charsPerSecond;
  }

  setText(text, speaker = '') {
    this.currentText = text ?? '';
    this.speaker = speaker;
    this.displayedChars = 0;
    this.revealTimer = 0;
  }

  update(deltaTime) {
    if (this.isFullyRevealed()) return;
    this.revealTimer += deltaTime;
    this.displayedChars = Math.min(this.currentText.length, Math.floor(this.revealTimer * this.charsPerSecond));
  }

  // Z/Enter押下時、まだ全文表示されていなければ演出をスキップして即座に全文表示する。
  skipReveal() {
    this.displayedChars = this.currentText.length;
  }

  isFullyRevealed() {
    return this.displayedChars >= this.currentText.length;
  }

  get shownText() {
    return this.currentText.slice(0, this.displayedChars);
  }

  // x,y,w,h はボックス全体の矩形。パネル背景/話者名/本文/ヒントをまとめて描画する。
  render(ctx, x, y, w, h, { hint = '', showSpeaker = true } = {}) {
    UIManager.drawPanel(ctx, x, y, w, h);

    let textTop = y + 34;
    if (showSpeaker && this.speaker) {
      ctx.fillStyle = PALETTE.textHighlight;
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(this.speaker, x + 20, y + 28);
    }

    UIManager.drawWrappedText(ctx, this.shownText, x + 20, textTop, w - 40, 26, {
      font: '18px sans-serif',
      color: PALETTE.textMain,
    });

    if (hint) {
      UIManager.drawHint(ctx, hint, x + w - 20, y + h - 12);
    }
  }
}
