// SaveManager.js
// セーブ/ロードを一元管理する。
// 保存先はブラウザ版なので localStorage。将来的にファイル書き出しへの
// 差し替えが容易なように、永続化処理を _write/_read に閉じ込めてある。

const SAVE_KEY_PREFIX = 'rpg-save-slot-';

export class SaveManager {
  constructor() {
    this.maxSlots = 3;
  }

  save(slot, gameStateObject) {
    const key = this._slotKey(slot);
    const payload = {
      savedAt: new Date().toISOString(),
      version: 1,
      data: gameStateObject,
    };
    this._write(key, payload);
  }

  load(slot) {
    const key = this._slotKey(slot);
    return this._read(key);
  }

  hasSave(slot) {
    return this.load(slot) !== null;
  }

  deleteSave(slot) {
    localStorage.removeItem(this._slotKey(slot));
  }

  listSaves() {
    const result = [];
    for (let i = 0; i < this.maxSlots; i++) {
      result.push({ slot: i, data: this.load(i) });
    }
    return result;
  }

  _slotKey(slot) {
    return `${SAVE_KEY_PREFIX}${slot}`;
  }

  _write(key, payload) {
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (e) {
      console.error('セーブに失敗しました', e);
    }
  }

  _read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('ロードに失敗しました', e);
      return null;
    }
  }
}
