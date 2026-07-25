// TileMap.js
// マップJSON(グリッド文字列の配列)を解釈し、当たり判定・座標変換を提供する。
// 描画方法(色分けタイル/将来的なスプライトシート差し替え)とは切り離してあるので、
// 後で見た目だけをリッチにしても、このクラスは変更不要。

// タイル種別コード -> 意味
const TILE_TYPES = {
  '0': { walkable: true, name: 'grass' },
  '1': { walkable: false, name: 'wall' },
  '2': { walkable: true, name: 'path' },
  '3': { walkable: true, name: 'water_edge' },
  '4': { walkable: false, name: 'water' },
};

export class TileMap {
  constructor(data) {
    this.tileSize = data.tileSize ?? 32;
    this.grid = data.grid.map((row) => row.split(''));
    this.height = this.grid.length;
    this.width = this.grid[0]?.length ?? 0;
  }

  getTileTypeAt(x, y) {
    if (x < 0 || y < 0 || y >= this.height || x >= this.width) return null;
    const code = this.grid[y][x];
    return TILE_TYPES[code] ?? null;
  }

  isWalkable(x, y) {
    const tile = this.getTileTypeAt(x, y);
    return tile !== null && tile.walkable;
  }

  // グリッド座標 -> ピクセル座標
  toPixel(gridX, gridY) {
    return { x: gridX * this.tileSize, y: gridY * this.tileSize };
  }
}

export { TILE_TYPES };
