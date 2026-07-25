// UIManager.js
// 共通UI部品の描画を集約する静的ユーティリティ(Stage6:UI 本実装)。
//
// 設計方針:
// - これまで各シーン(BattleScene/DialogueScene/MapScene)に重複していた
//   「パネル背景」「HP/MPバー」「選択肢一覧」の描画コードをここに集約し、
//   配色や余白のルールを一箇所で統一管理する。
// - すべて静的メソッド。UIManager自体は状態を持たない「描画関数の置き場」として扱う
//   (ctxと引数だけで完結する純粋関数群にすることで、どのシーンからも
//    副作用なく呼び出せるようにしてある)。
// - コンストラクタ(インスタンス化)は将来的な画像アセットキャッシュ等のために
//   一応残してあるが、現状は使用しなくてよい。

export const PALETTE = {
  panelBg: 'rgba(10,10,20,0.92)',
  panelBorder: '#ffd45c',
  textMain: '#f0f0f0',
  textSub: '#888888',
  textHighlight: '#ffd45c',
  hp: '#4caf50',
  hpLow: '#e05050',
  mp: '#4a90d9',
  enemyHp: '#e05050',
  barBg: '#222222',
  barBorder: '#000000',
};

const HP_LOW_RATIO = 0.25;

export class UIManager {
  constructor(game) {
    this.game = game; // 現状未使用(将来のアセットキャッシュ用に確保)。
  }

  // --- パネル -----------------------------------------------------------

  static drawPanel(ctx, x, y, w, h, { fill = PALETTE.panelBg, border = PALETTE.panelBorder, lineWidth = 1 } = {}) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(x, y, w, h);
    }
  }

  // --- バー ---------------------------------------------------------------

  // ratio: 0〜1。lowColorを指定すると残量がlowThreshold以下の時に自動で色が変わる(HP用)。
  static drawBar(
    ctx,
    x,
    y,
    w,
    h,
    ratio,
    { color = PALETTE.hp, lowColor = null, lowThreshold = HP_LOW_RATIO, bg = PALETTE.barBg, border = PALETTE.barBorder } = {}
  ) {
    const clamped = Math.max(0, Math.min(1, ratio));
    const actualColor = lowColor && clamped <= lowThreshold ? lowColor : color;

    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = actualColor;
    ctx.fillRect(x, y, w * clamped, h);
    if (border) {
      ctx.strokeStyle = border;
      ctx.strokeRect(x, y, w, h);
    }
  }

  // 骨組み版UIManagerとの互換名(HPバー専用の薄いラッパー)
  static drawHpBar(ctx, x, y, w, h, current, max) {
    UIManager.drawBar(ctx, x, y, w, h, max > 0 ? current / max : 0, { color: PALETTE.hp, lowColor: PALETTE.hpLow });
  }

  // --- パーティメンバー1人分のステータスブロック(名前/Lv/HP/MPバー) ---------
  // BattleScene(パーティ帯)とMapSceneのステータスメニューの両方で使う共通部品。

  static drawStatBlock(ctx, x, y, w, member, { highlighted = false, showGuard = true } = {}) {
    ctx.textAlign = 'left';
    ctx.fillStyle = highlighted ? PALETTE.textHighlight : PALETTE.textMain;
    ctx.font = '15px sans-serif';
    ctx.fillText(`${highlighted ? '▶ ' : '　'}${member.name} Lv${member.level}`, x, y);

    ctx.fillStyle = member.isAlive ? '#cccccc' : '#666666';
    ctx.font = '12px sans-serif';
    ctx.fillText(`HP ${member.hp}/${member.maxHp}`, x, y + 18);
    ctx.fillText(`MP ${member.mp}/${member.maxMp}`, x, y + 33);

    const barX = x + 90;
    const barW = Math.max(40, w - 90);
    UIManager.drawBar(ctx, barX, y + 11, barW, 6, member.maxHp > 0 ? member.hp / member.maxHp : 0, {
      color: PALETTE.hp,
      lowColor: PALETTE.hpLow,
    });
    UIManager.drawBar(ctx, barX, y + 26, barW, 6, member.maxMp > 0 ? member.mp / member.maxMp : 0, {
      color: PALETTE.mp,
    });

    if (showGuard && member.guarding) {
      ctx.fillStyle = '#8ad0ff';
      ctx.font = '11px sans-serif';
      ctx.fillText('(ぼうぎょ中)', x, y + 46);
    }
  }

  // --- テキスト(折り返し) ---------------------------------------------------

  // 指定した幅で単純な折り返し処理を行い、複数行を描画する。戻り値は使用した行数。
  static drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, { font = '16px sans-serif', color = PALETTE.textMain, align = 'left' } = {}) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;

    const lines = UIManager.wrapText(ctx, text, maxWidth);
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
    return lines.length;
  }

  // 日本語(単語区切りが無い)前提の1文字単位の折り返し。
  // ctx.fontは呼び出し前(drawWrappedText内)でセット済みの状態で呼ばれる想定。
  static wrapText(ctx, text, maxWidth) {
    const lines = [];
    let current = '';
    for (const ch of text) {
      if (ch === '\n') {
        lines.push(current);
        current = '';
        continue;
      }
      const tentative = current + ch;
      if (ctx.measureText(tentative).width > maxWidth && current.length > 0) {
        lines.push(current);
        current = ch;
      } else {
        current = tentative;
      }
    }
    lines.push(current);
    return lines;
  }

  // --- メニュー(選択肢一覧) -------------------------------------------------

  // menu: Menuインスタンス(options/selectedIndexを持つ)。
  // rowsPerCol: 1列あたりの表示件数(超えたら次の列へ)。省略時は全件1列。
  static drawMenuList(
    ctx,
    menu,
    x,
    y,
    { colWidth = 260, rowHeight = 24, rowsPerCol = null, font = '15px sans-serif', highlightColor = PALETTE.textHighlight, textColor = PALETTE.textMain } = {}
  ) {
    const perCol = rowsPerCol ?? menu.options.length;

    ctx.font = font;
    ctx.textAlign = 'left';

    menu.options.forEach((label, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const drawX = x + col * colWidth;
      const drawY = y + row * rowHeight;
      const selected = i === menu.selectedIndex;
      ctx.fillStyle = selected ? highlightColor : textColor;
      ctx.fillText(`${selected ? '▶ ' : '　'}${label}`, drawX, drawY);
    });
  }

  static drawHint(ctx, text, x, y, { align = 'right', color = PALETTE.textSub, font = '12px sans-serif' } = {}) {
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  }
}
