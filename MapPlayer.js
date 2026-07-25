// MapPlayer.js
// マップ画面上でのプレイヤーの見た目・移動だけを扱う軽量クラス。
// 戦闘ステータス(HP/攻撃力等)はParty内のCharacterが持っており、
// MapPlayerはあくまで「グリッド上のアバター」という役割に限定する(責務分離)。

const MOVE_DURATION = 0.14; // 1マス移動にかかる秒数(見た目の滑らかさ用)

export class MapPlayer {
  constructor(gridX, gridY, tileSize) {
    this.gridX = gridX;
    this.gridY = gridY;
    this.tileSize = tileSize;

    this.pixelX = gridX * tileSize;
    this.pixelY = gridY * tileSize;

    this.direction = 'down'; // down/up/left/right (スプライト差し替え用)
    this.isMoving = false;
    this._moveTimer = 0;
    this._fromX = this.pixelX;
    this._fromY = this.pixelY;
    this._toX = this.pixelX;
    this._toY = this.pixelY;
  }

  startMove(dx, dy) {
    if (this.isMoving) return;

    if (dx < 0) this.direction = 'left';
    else if (dx > 0) this.direction = 'right';
    else if (dy < 0) this.direction = 'up';
    else if (dy > 0) this.direction = 'down';

    this.gridX += dx;
    this.gridY += dy;

    this._fromX = this.pixelX;
    this._fromY = this.pixelY;
    this._toX = this.gridX * this.tileSize;
    this._toY = this.gridY * this.tileSize;

    this.isMoving = true;
    this._moveTimer = 0;
  }

  update(deltaTime) {
    if (!this.isMoving) return;

    this._moveTimer += deltaTime;
    const t = Math.min(1, this._moveTimer / MOVE_DURATION);

    this.pixelX = this._fromX + (this._toX - this._fromX) * t;
    this.pixelY = this._fromY + (this._toY - this._fromY) * t;

    if (t >= 1) {
      this.isMoving = false;
      this.pixelX = this._toX;
      this.pixelY = this._toY;
    }
  }

  // 現在向いている方向の先のマス座標(NPC接触/インタラクト判定に使用)
  getFacingTile() {
    const offsets = {
      down: [0, 1],
      up: [0, -1],
      left: [-1, 0],
      right: [1, 0],
    };
    const [dx, dy] = offsets[this.direction];
    return { x: this.gridX + dx, y: this.gridY + dy };
  }
}
