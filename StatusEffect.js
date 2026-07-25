// StatusEffect.js
// 状態異常/バフ・デバフの汎用クラス(Stage5:戦闘で本実装)。
//
// サブクラスを増やさず、kind/statMods/dotDamageのデータだけで
// 挙動を表現するデータ駆動設計にしてある(skills.jsonのstatusEffectフィールドから
// そのままコンストラクタへ渡せる)。
//
// kind:
//   'buff'   - statModsによる能力値倍率(例: { def: 1.6 } でDEF1.6倍)
//   'debuff' - buffと同じ仕組み。statModsに1未満の倍率を渡す
//   'stun'   - 行動不能(BattleSystem側でisStunnedを見て行動をスキップさせる)
//   'dot'    - ターン終了時にdotDamage分の継続ダメージ

export class StatusEffect {
  constructor(id, {
    name = id,
    duration = 3,
    kind = 'buff',
    statMods = {},
    dotDamage = 0,
  } = {}) {
    this.id = id;
    this.name = name;
    this.duration = duration; // 残りターン数(付与された対象の「自分の手番」基準で減少)
    this.kind = kind;
    this.statMods = statMods;
    this.dotDamage = dotDamage;
  }

  // ターン開始時にCharacter側から呼ばれる想定(現状フックのみ、将来の拡張用)
  onTurnStart(target) {}

  // ターン終了時にCharacter側から呼ばれる。継続ダメージの適用と残り時間の減少を行う。
  onTurnEnd(target) {
    if (this.dotDamage > 0 && target.isAlive) {
      target.takeDamage(this.dotDamage);
    }
    this.duration -= 1;
  }

  isExpired() {
    return this.duration <= 0;
  }
}
