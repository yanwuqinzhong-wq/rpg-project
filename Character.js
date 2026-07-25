// Character.js
// 主人公・仲間(リリア/ガロン/セリア)・敵の共通基底クラス。
// ステータス計算やレベルアップ処理はここに集約し、EnemyはこれをExtendするだけにする。
//
// 設計方針:
// - コンストラクタはcharacters.json/enemies.jsonの生データをそのまま受け取る
// - baseStats + growthRates からレベル依存の実ステータスを毎回導出する
//   (「現在のhp/mp」だけは実測値として保持し、他の攻撃力等は都度計算でもよいが
//    パフォーマンスと分かりやすさを優先し、レベルアップ時に再計算してキャッシュする)

import { SkillTree } from './SkillTree.js';
import {
  expRequiredForLevel,
  expToNextLevel,
  levelFromExp,
  calcStatAtLevel,
} from '../utils/leveling.js';

const DEFAULT_BASE_STATS = {
  hp: 30,
  mp: 10,
  atk: 8,
  def: 5,
  matk: 5,
  mdef: 5,
  spd: 8,
  luck: 5,
};

const DEFAULT_GROWTH = {
  hp: 6,
  mp: 2,
  atk: 1.2,
  def: 1,
  matk: 1,
  mdef: 1,
  spd: 0.6,
  luck: 0.3,
};

export class Character {
  constructor(id, data = {}) {
    this.id = id;
    this.name = data.name ?? id;

    this.baseStats = { ...DEFAULT_BASE_STATS, ...(data.baseStats ?? {}) };
    this.growthRates = { ...DEFAULT_GROWTH, ...(data.growthRates ?? {}) };

    this.exp = data.exp ?? expRequiredForLevel(data.level ?? 1);
    this.level = data.level ?? levelFromExp(this.exp);

    this.statusEffects = [];
    this.skillTree = new SkillTree(data.skillTree ?? []);

    // 戦闘中のみ意味を持つ一時フラグ(ぼうぎょ)。
    // 継続ターン管理が必要なバフはstatusEffectsで扱うが、
    // ぼうぎょは「自分の次の手番が来るまで」有効にしたいだけなので
    // シンプルなbool管理にしてある(BattleSystemが手番開始時にリセットする)。
    this.guarding = false;

    // 実ステータスを算出してから、現在HP/MPを設定する
    this._recalcStats();
    this.hp = data.hp ?? this.maxHp;
    this.mp = data.mp ?? this.maxMp;

    // 初期レベル分のスキルは最初から解禁しておく
    this.skillTree.checkUnlocks(this.level);
  }

  // レベルに応じた実ステータスを再計算してキャッシュする
  _recalcStats() {
    const s = this.baseStats;
    const g = this.growthRates;
    const lv = this.level;

    this.maxHp = calcStatAtLevel(s.hp, g.hp, lv);
    this.maxMp = calcStatAtLevel(s.mp, g.mp, lv);
    this.atk = calcStatAtLevel(s.atk, g.atk, lv);
    this.def = calcStatAtLevel(s.def, g.def, lv);
    this.matk = calcStatAtLevel(s.matk, g.matk, lv);
    this.mdef = calcStatAtLevel(s.mdef, g.mdef, lv);
    this.spd = calcStatAtLevel(s.spd, g.spd, lv);
    this.luck = calcStatAtLevel(s.luck, g.luck, lv);
  }

  get isAlive() {
    return this.hp > 0;
  }

  get expToNext() {
    return expToNextLevel(this.level, this.exp);
  }

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - Math.max(0, amount));
    return this.hp;
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + Math.max(0, amount));
    return this.hp;
  }

  restoreMp(amount) {
    this.mp = Math.min(this.maxMp, this.mp + Math.max(0, amount));
    return this.mp;
  }

  // 経験値を加算し、レベルアップが発生した場合はその結果をまとめて返す。
  // 戦闘後にBattleScene側が結果をUI表示できるよう、詳細を返り値にまとめる。
  gainExp(amount) {
    this.exp += amount;
    const newLevel = levelFromExp(this.exp);

    const result = {
      leveledUp: false,
      previousLevel: this.level,
      newLevel,
      unlockedSkills: [],
    };

    if (newLevel > this.level) {
      this.level = newLevel;
      this._recalcStats();
      // レベルが上がった分だけ現在HP/MPも増分を反映(全回復ではなく差分加算)
      result.leveledUp = true;
      result.unlockedSkills = this.skillTree.checkUnlocks(this.level);
      // 上限を超えないよう安全のためclamp
      this.hp = Math.min(this.hp, this.maxHp);
      this.mp = Math.min(this.mp, this.maxMp);
    }

    return result;
  }

  applyStatusEffect(effect) {
    // 同一idのバフ/デバフが既にある場合は上書き(重ねがけで無限にスタックしないように)
    this.statusEffects = this.statusEffects.filter((e) => e.id !== effect.id);
    this.statusEffects.push(effect);
  }

  clearExpiredStatusEffects() {
    this.statusEffects = this.statusEffects.filter((e) => !e.isExpired());
  }

  get isStunned() {
    return this.statusEffects.some((e) => e.kind === 'stun' && !e.isExpired());
  }

  // statusEffectsのstatModsを反映した実効ステータスを返す。
  // ダメージ計算など戦闘中の判定は、生の(this.atk等)ではなく必ずこちらを参照すること。
  getEffectiveStat(statName) {
    const base = this[statName] ?? 0;
    let multiplier = 1;
    for (const effect of this.statusEffects) {
      if (effect.isExpired()) continue;
      const mod = effect.statMods?.[statName];
      if (mod != null) multiplier *= mod;
    }
    return base * multiplier;
  }

  // 自分の手番終了時にBattleSystemから呼ばれる。
  // 継続ダメージ(dot)の適用・バフ/デバフ残り時間の減少・期限切れの掃除をまとめて行う。
  tickStatusEffectsTurnEnd() {
    for (const effect of this.statusEffects) {
      if (!effect.isExpired()) effect.onTurnEnd(this);
    }
    this.clearExpiredStatusEffects();
  }

  // セーブ/ロード用のシリアライズ(装備やスキルツリー習得状況も含める)
  serialize() {
    return {
      id: this.id,
      name: this.name, // セーブスロット一覧表示でテンプレートJSONを参照せずに済むよう含めておく
      level: this.level,
      exp: this.exp,
      hp: this.hp,
      mp: this.mp,
      learnedSkills: this.skillTree.serialize(),
    };
  }

  applySaveData(saveData) {
    this.level = saveData.level;
    this.exp = saveData.exp;
    this._recalcStats();
    this.hp = saveData.hp;
    this.mp = saveData.mp;
    this.skillTree.deserialize(saveData.learnedSkills ?? []);
  }
}
