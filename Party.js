// Party.js
// 現在パーティに加入しているCharacterの管理。
// 「戦闘に出る前衛(active)」と「同行はしているが控えの仲間(reserve)」を分け、
// 将来的な戦闘人数制限(例:同時に戦えるのは3人まで)に対応できるようにしてある。
//
// Pルートでの説得加入・Gルートでの離脱など、加入/離脱イベントは
// すべてEventManager経由のフラグ変化をトリガーに、外側(イベントシステム)から
// addMember/removeMemberを呼ぶ想定(Partyクラス自体はルート判定を知らない=疎結合)。

const DEFAULT_MAX_ACTIVE = 3;

export class Party {
  constructor({ maxActive = DEFAULT_MAX_ACTIVE } = {}) {
    this.maxActive = maxActive;
    this.active = [];   // 戦闘に出るメンバー
    this.reserve = [];  // 同行中だが控えのメンバー
  }

  get allMembers() {
    return [...this.active, ...this.reserve];
  }

  addMember(character, { toActive = true } = {}) {
    if (this.hasMember(character.id)) return; // 二重加入防止

    if (toActive && this.active.length < this.maxActive) {
      this.active.push(character);
    } else {
      this.reserve.push(character);
    }
  }

  removeMember(id) {
    this.active = this.active.filter((m) => m.id !== id);
    this.reserve = this.reserve.filter((m) => m.id !== id);
  }

  hasMember(id) {
    return this.allMembers.some((m) => m.id === id);
  }

  getMember(id) {
    return this.allMembers.find((m) => m.id === id) ?? null;
  }

  // 控えメンバーを前衛に入れ替える(戦闘前の編成画面などで使用)
  swapToActive(reserveId, activeId) {
    const reserveMember = this.reserve.find((m) => m.id === reserveId);
    const activeIndex = this.active.findIndex((m) => m.id === activeId);
    if (!reserveMember || activeIndex === -1) return false;

    const swappedOut = this.active[activeIndex];
    this.active[activeIndex] = reserveMember;
    this.reserve = this.reserve.filter((m) => m.id !== reserveId);
    this.reserve.push(swappedOut);
    return true;
  }

  isPartyWiped() {
    return this.active.length > 0 && this.active.every((m) => !m.isAlive);
  }

  gainExpAll(amount) {
    // 前衛のみ経験値を得る(控えは同行しているだけという想定。
    // 均等に与えたい場合はallMembersに変更すればよい)
    return this.active.map((member) => ({
      id: member.id,
      result: member.gainExp(amount),
    }));
  }

  serialize() {
    return {
      active: this.active.map((m) => m.serialize()),
      reserve: this.reserve.map((m) => m.serialize()),
    };
  }
}
