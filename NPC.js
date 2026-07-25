// NPC.js
// マップ上に配置されるNPC。会話データ(dialogueId)への参照だけを持ち、
// 実際の会話内容はDialogueScene側がsrc/data/dialogues/*.jsonから読む(疎結合)。

export class NPC {
  constructor(data) {
    this.id = data.id;
    this.name = data.name ?? data.id;
    this.x = data.x;
    this.y = data.y;
    this.dialogueId = data.dialogueId ?? null;
    this.color = data.color ?? '#4caf50';
    this.blocking = data.blocking ?? true; // マス上を通行禁止にするか
  }

  isAt(gridX, gridY) {
    return this.x === gridX && this.y === gridY;
  }
}
