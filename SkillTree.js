// SkillTree.js
// キャラクターごとのスキルツリーを表現する。
// ノード定義はJSON(characters.jsonのskillTreeフィールド)から渡される想定で、
// ロジック(習得可否判定)とデータ(ツリー構造そのもの)を分離している。
//
// ノード形式の例:
// { id: 'fireball', name: 'ファイアボール', requiredLevel: 3, requires: [] }
// { id: 'flame_burst', name: '火炎爆裂', requiredLevel: 8, requires: ['fireball'] }

export class SkillTree {
  constructor(nodes = []) {
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
    this.learned = new Set();
  }

  // レベルアップ時などに呼び出し、新規習得可能なスキルを解禁して返す
  checkUnlocks(currentLevel) {
    const newlyUnlocked = [];
    for (const node of this.nodes.values()) {
      if (this.learned.has(node.id)) continue;
      if (currentLevel < node.requiredLevel) continue;

      const requires = node.requires ?? [];
      const prereqsMet = requires.every((reqId) => this.learned.has(reqId));
      if (!prereqsMet) continue;

      this.learned.add(node.id);
      newlyUnlocked.push(node);
    }
    return newlyUnlocked;
  }

  hasLearned(skillId) {
    return this.learned.has(skillId);
  }

  getLearnedSkillIds() {
    return Array.from(this.learned);
  }

  // セーブ/ロード用
  serialize() {
    return Array.from(this.learned);
  }

  deserialize(learnedIds = []) {
    this.learned = new Set(learnedIds);
  }
}
