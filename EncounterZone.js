// EncounterZone.js
// 指定した矩形範囲(グリッド座標)内を移動する度に、encounterRateの確率で
// enemyPoolからランダムに敵を選び戦闘を発生させる。
// 「草むら」「危険地帯」等、複数のゾーンをマップごとに何個でも定義できる。

export class EncounterZone {
  constructor(data) {
    this.x = data.x;
    this.y = data.y;
    this.width = data.width ?? 1;
    this.height = data.height ?? 1;
    this.encounterRate = data.encounterRate ?? 0.1;
    this.enemyPool = data.enemyPool ?? [];
  }

  contains(gridX, gridY) {
    return (
      gridX >= this.x &&
      gridX < this.x + this.width &&
      gridY >= this.y &&
      gridY < this.y + this.height
    );
  }

  rollEncounter() {
    if (Math.random() >= this.encounterRate) return null;
    if (this.enemyPool.length === 0) return null;
    const index = Math.floor(Math.random() * this.enemyPool.length);
    return this.enemyPool[index];
  }
}
