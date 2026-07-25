// EventManager.js
// ゲーム全体の「フラグ」を一元管理する。
// 好感度、ルート分岐条件、実績解除、クエスト進行などはすべてここに集約し、
// 各システムが直接依存し合わないようにする(疎結合化)。

export class EventManager {
  constructor() {
    // 例: { "met_riria": true, "goblin_defeated": false, "riria_affection": 3 }
    this.flags = new Map();

    // ルート判定に使う集計値(Gルートの虐殺数など)
    this.counters = new Map();

    // フラグ変化を監視するリスナー { flagName: [callback, ...] }
    this.listeners = new Map();
  }

  setFlag(name, value = true) {
    this.flags.set(name, value);
    this._notify(name, value);
  }

  getFlag(name) {
    return this.flags.get(name) ?? false;
  }

  incrementCounter(name, amount = 1) {
    const current = this.counters.get(name) ?? 0;
    const next = current + amount;
    this.counters.set(name, next);
    this._notify(name, next);
    return next;
  }

  getCounter(name) {
    return this.counters.get(name) ?? 0;
  }

  // 「はじめから」用。リスナー登録(コード側の配線)はそのままに、
  // セーブデータ由来の状態(flags/counters)だけを空にする。
  reset() {
    this.flags.clear();
    this.counters.clear();
  }

  on(flagName, callback) {
    if (!this.listeners.has(flagName)) {
      this.listeners.set(flagName, []);
    }
    this.listeners.get(flagName).push(callback);
  }

  _notify(name, value) {
    const callbacks = this.listeners.get(name);
    if (callbacks) {
      callbacks.forEach((cb) => cb(value));
    }
  }

  // セーブ/ロード用にシリアライズ可能な形へ変換
  serialize() {
    return {
      flags: Object.fromEntries(this.flags),
      counters: Object.fromEntries(this.counters),
    };
  }

  deserialize(data) {
    this.flags = new Map(Object.entries(data.flags ?? {}));
    this.counters = new Map(Object.entries(data.counters ?? {}));
  }
}
