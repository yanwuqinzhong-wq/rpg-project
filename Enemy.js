// Enemy.js
// Characterを継承し、AI行動パターンや報酬情報を追加する。
// 具体的な戦闘AIロジック(行動選択)はStage5(戦闘)/Stage9(ボス)で本実装するが、
// 四皇・中ボス・Gルート限定ボスの「差し替え可能な行動パターン枠」と
// 経験値/ドロップ報酬まわりはコアシステムの一部としてここで定義しておく。

import { Character } from './Character.js';

export class Enemy extends Character {
  constructor(id, data = {}) {
    super(id, data);

    this.aiPattern = data.aiPattern ?? 'basic';
    this.category = data.category ?? 'normal'; // normal / mid_boss / four_generals / genocide_only_boss

    // Pルートで説得可能かどうか(仕様書: フロストはPルートで仲間候補、等)
    this.persuadable = data.persuadable ?? false;
    this.persuaded = false;

    // Gルート等の強化倍率(RouteManagerの判定結果を受けて外側からapplyBuffする想定)
    this.buffMultiplier = 1.0;

    this.expReward = data.expReward ?? 0;
    this.dropTable = data.dropTable ?? []; // [{ itemId, chance }]
    this.hasSecondForm = data.hasSecondForm ?? false;
    this.secondFormTriggered = false;
  }

  // Gルートでのボス強化など、ルートに応じたステータス倍率を適用する
  applyRouteBuff(multiplier) {
    this.buffMultiplier = multiplier;
    this.maxHp = Math.floor(this.maxHp * multiplier);
    this.hp = this.maxHp;
    this.atk = Math.floor(this.atk * multiplier);
  }

  tryPersuade() {
    if (!this.persuadable || this.persuaded) return false;
    this.persuaded = true;
    return true;
  }

  // Gルート限定ボスや四皇最強格の「第二形態」。HPが一定割合を切った瞬間に
  // 一度だけ発動する想定(呼び出し側=BattleSystemがHP閾値を監視する)。
  // 攻撃力を底上げしHPを少量回復させることで、既存のダメージ計算式(Skill.js)を
  // 一切変更せずに「後半戦が厳しくなるボス」を表現する。
  triggerSecondForm() {
    if (!this.hasSecondForm || this.secondFormTriggered) return null;
    this.secondFormTriggered = true;
    this.atk = Math.floor(this.atk * 1.5);
    this.matk = Math.floor(this.matk * 1.5);
    this.spd = Math.floor(this.spd * 1.3);
    const healAmount = Math.floor(this.maxHp * 0.2);
    this.heal(healAmount);
    return { healAmount };
  }
}
