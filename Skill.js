// Skill.js
// 魔法/スキルの効果定義(データ駆動: src/data/skills.jsonから読込)。
// リリアの火・氷・雷、ガロンの斧技、セリアの弓技などはすべてskills.jsonの
// エントリとして定義し、このクラスはその値を汎用的に処理するだけにする。
// 新スキル追加時にこのファイルを触らずに済むのが目標。
//
// type:
//   'physical' - atk基準のダメージ(defで軽減)
//   'magic'    - matk基準のダメージ(mdefで軽減)
//   'buff'     - ダメージを与えず、statusEffectを対象に付与する
//   'heal'     - matk基準でHPを回復する(与ダメージ計算とは別軸、防御力の影響を受けない)
//
// target:
//   'single_enemy' | 'all_enemies' | 'self' | 'single_ally' | 'all_allies'
//   (どの対象候補から選ばせるかはBattleScene/BattleSystem側の責務)

const MISS_CHANCE_BASE = 0.05;
const CRIT_MULTIPLIER = 1.5;

export class Skill {
  constructor(id, data = {}) {
    this.id = id;
    this.name = data.name ?? id;
    this.mpCost = data.mpCost ?? 0;
    this.type = data.type ?? 'physical'; // physical / magic / buff
    this.power = data.power ?? 0;
    this.element = data.element ?? 'none';
    this.hits = data.hits ?? 1;
    this.target = data.target ?? 'single_enemy';
    this.ignoreDef = data.ignoreDef ?? false;
    this.statusEffect = data.statusEffect ?? null; // buff系のみ使用
  }

  // 通常攻撃(スキルツリーに依存しない、誰でも常時使える基本行動)。
  // ダメージ計算式を一本化するため、あえてSkillとして扱う。
  static basicAttack() {
    return new Skill('attack', {
      name: 'たたかう',
      mpCost: 0,
      type: 'physical',
      power: 0,
      hits: 1,
      target: 'single_enemy',
    });
  }

  get isDamageSkill() {
    return this.type === 'physical' || this.type === 'magic';
  }

  // 1体・1回分の効果を適用し、結果を返す。
  // 複数対象(all_enemies)や複数回攻撃(hits>1)のループはBattleSystem側が担当する。
  apply(user, target) {
    if (this.type === 'buff') {
      return this._applyBuff(user, target);
    }
    if (this.type === 'heal') {
      return this._applyHeal(user, target);
    }
    return this._applyDamage(user, target);
  }

  _applyHeal(user, target) {
    // matk基準(魔法回復)。povwerが基礎値、ユーザーのmatkの半分を上乗せする。
    // 会心/回避判定は行わない(回復は外さない設計にして、道具としての信頼性を持たせる)。
    const amount = Math.max(1, Math.floor(this.power + user.getEffectiveStat('matk') * 0.5));
    return { healAmount: amount };
  }

  _applyBuff(user, target) {
    if (!this.statusEffect) return { applied: false };
    // statusEffectのidが重複しないよう、Skill側で定義済みのオブジェクトをそのまま渡す。
    // BattleSystem側でStatusEffectインスタンス化してtarget.applyStatusEffect()する。
    return { applied: true, statusEffect: this.statusEffect };
  }

  _applyDamage(user, target) {
    // 命中判定(素早さ差で多少ブレる。会心はluckに応じて発生)
    const evasionFactor = (target.getEffectiveStat('spd') - user.getEffectiveStat('spd')) * 0.002;
    const missChance = Math.min(0.3, Math.max(0.02, MISS_CHANCE_BASE + evasionFactor));
    if (Math.random() < missChance) {
      return { damage: 0, missed: true, critical: false };
    }

    const isMagic = this.type === 'magic';
    const offense = user.getEffectiveStat(isMagic ? 'matk' : 'atk');
    const defense = this.ignoreDef ? 0 : target.getEffectiveStat(isMagic ? 'mdef' : 'def');

    let base = Math.max(1, offense + this.power - defense * 0.5);

    const critChance = Math.min(0.3, user.getEffectiveStat('luck') * 0.006);
    const critical = Math.random() < critChance;
    if (critical) base *= CRIT_MULTIPLIER;

    const variance = 0.9 + Math.random() * 0.2; // 0.9〜1.1倍のブレ
    let damage = Math.floor(base * variance);

    // ぼうぎょ中の対象はダメージ半減
    if (target.guarding) damage = Math.floor(damage * 0.5);

    damage = Math.max(1, damage);

    return { damage, missed: false, critical };
  }
}
