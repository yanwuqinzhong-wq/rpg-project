// RouteManager.js
// [骨組み / Stage9前後で本格実装予定。ただし設計上は全ステージから参照される重要モジュール]
//
// 想定責務:
// - EventManagerのフラグ/カウンター(虐殺数、説得数など)を監視し、
//   現在のルート判定(N/P/G)を計算する
// - ルートに応じて分岐する中ボス・四皇・エンディングの出し分けを一元化
//   (各シーンが個別にif分岐しないようにするための集約ポイント)

export const ROUTE = Object.freeze({
  NEUTRAL: 'N',
  PACIFIST: 'P',
  GENOCIDE: 'G',
});

export class RouteManager {
  constructor(eventManager) {
    this.eventManager = eventManager;
  }

  getCurrentRoute() {
    const genocideCount = this.eventManager.getCounter('genocide_kills');
    const persuadedCount = this.eventManager.getCounter('persuaded_enemies');

    if (genocideCount >= 10) return ROUTE.GENOCIDE;
    if (persuadedCount >= 2) return ROUTE.PACIFIST;
    return ROUTE.NEUTRAL;
  }
}
