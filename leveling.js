// leveling.js
// レベル/経験値まわりの計算式を一箇所に集約する。
// 将来バランス調整する際もここだけ触ればよいようにする。

const MAX_LEVEL = 60;

// レベルNに到達するために必要な累積経験値。
// 緩やかな指数カーブ(RPGでよくある「後半ほど重くなる」形)。
export function expRequiredForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(20 * Math.pow(level, 2.2));
}

export function expToNextLevel(currentLevel, currentExp) {
  const next = expRequiredForLevel(currentLevel + 1);
  return Math.max(0, next - currentExp);
}

// 累積経験値から到達レベルを逆算する(カンストはMAX_LEVELで打ち止め)。
export function levelFromExp(totalExp) {
  let level = 1;
  while (level < MAX_LEVEL && totalExp >= expRequiredForLevel(level + 1)) {
    level++;
  }
  return level;
}

// growthRates(レベル毎の伸び率)を基にレベルNの実ステータスを算出する。
// base: レベル1時点のステータス、growth: レベル毎の加算値
export function calcStatAtLevel(base, growth, level) {
  return Math.floor(base + growth * (level - 1));
}

export { MAX_LEVEL };
