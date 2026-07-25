// helpers.js
// どのモジュールにも属さない汎用関数置き場。

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`JSON読み込み失敗: ${path}`);
  }
  return res.json();
}

// セーブスロット一覧表示用のラベル生成(TitleScene/MapScene両方で使う共通フォーマット)。
// record は SaveManager#load() の戻り値(なければnull = 空きスロット)。
export function formatSaveSlotLabel(record, slotIndex) {
  if (!record) return `スロット${slotIndex + 1}: ── からっぽ ──`;

  const savedAt = new Date(record.savedAt);
  const dateLabel = Number.isNaN(savedAt.getTime()) ? '' : savedAt.toLocaleString('ja-JP');
  const names = (record.data?.party?.active ?? []).map((m) => m.name).join('/');

  return `スロット${slotIndex + 1}: ${dateLabel}${names ? `（${names}）` : ''}`;
}
