// EndingScene.js
// 最終ボス(finalBoss:trueのクエスト)を討伐した瞬間にBattleSceneから遷移してくる、
// N/P/Gルート別のエンディング画面(Stage10)。
//
// ルート判定はRouteManagerに一元化されているため、このシーンは「表示するだけ」で済む
// (どのカウンターが何件でどう分岐するかという判定ロジックを二重管理しない)。

import { RouteManager, ROUTE } from '../route/RouteManager.js';
import { UIManager, PALETTE } from '../ui/UIManager.js';
import { TitleScene } from './TitleScene.js';

const ENDING_CONTENT = {
  [ROUTE.PACIFIST]: {
    title: 'PACIFIST ENDING - 和解の道',
    color: '#8fe3c0',
    lines: [
      '剣を交えず、言葉を尽くした戦いだった。',
      'ゴブ之助は仲間の元へ帰り、フロストは静かに剣を収めた。',
      '説き伏せられた者たちの噂は、やがて魔王軍の中にも広まっていく。',
      '「殺さずとも、世界は変えられる」——その証明は、小さくとも確かな光となった。',
      '大陸に、これまでよりずっと穏やかな風が吹き始めている。',
    ],
  },
  [ROUTE.NEUTRAL]: {
    title: 'NEUTRAL ENDING - 静かなる終幕',
    color: '#cfd8e8',
    lines: [
      '戦うべき時に戦い、退くべき時に退いた。',
      '英雄と呼ばれるにはまだ遠いが、確かに世界の均衡を守り抜いた。',
      '四皇は倒れ、脅威は去った。だが、失われたものも少なくない。',
      'それでも旅は続く。次にどんな道を選ぶかは、まだ誰にも分からない。',
    ],
  },
  [ROUTE.GENOCIDE]: {
    title: 'GENOCIDE ENDING - 滅びの道',
    color: '#e08a8a',
    lines: [
      '行く手を阻む者はことごとく斬り伏せた。慈悲はどこにもなかった。',
      '鬼面の処刑人すらも、その刃の前には沈黙するしかなかった。',
      '大陸に静寂が訪れる。だがそれは平和ではなく、ただの「何もない」だった。',
      '——本当に、これでよかったのだろうか。',
    ],
  },
};

export class EndingScene {
  constructor(game) {
    this.game = game;
    const routeManager = new RouteManager(game.eventManager);
    this.route = routeManager.getCurrentRoute();
    this.content = ENDING_CONTENT[this.route] ?? ENDING_CONTENT[ROUTE.NEUTRAL];

    this.timer = 0;
    this.fadeInDuration = 1.2;
    this.canAdvance = false;
    this.advanceDelay = 1.5; // 演出が始まってすぐ誤って閉じてしまわないための猶予
  }

  onEnter() {
    console.log(`[EndingScene] route=${this.route}`);
  }

  update(deltaTime) {
    this.timer += deltaTime;
    if (this.timer >= this.advanceDelay) this.canAdvance = true;

    const input = this.game.input;
    if (this.canAdvance && (input.wasPressed('z') || input.wasPressed('Enter'))) {
      this.game.sceneManager.changeScene(new TitleScene(this.game));
    }
    input.clearFrame();
  }

  render(ctx) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, width, height);

    const alpha = Math.min(1, this.timer / this.fadeInDuration);
    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.textAlign = 'center';
    ctx.fillStyle = this.content.color;
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(this.content.title, width / 2, height * 0.28);

    const bodyX = width * 0.5;
    const bodyY = height * 0.4;
    const bodyWidth = Math.min(560, width - 80);
    ctx.textAlign = 'left';
    const startX = bodyX - bodyWidth / 2;
    let lineY = bodyY;
    for (const line of this.content.lines) {
      const lineCount = UIManager.drawWrappedText(ctx, line, startX, lineY, bodyWidth, 24, {
        font: '15px sans-serif',
        color: PALETTE.textMain,
      });
      lineY += lineCount * 24 + 12;
    }

    ctx.restore();

    if (this.canAdvance) {
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.textSub;
      ctx.font = '12px sans-serif';
      ctx.fillText('Z・Enter でタイトルへ戻る', width / 2, height - 30);
    }
  }

  onExit() {}
}
