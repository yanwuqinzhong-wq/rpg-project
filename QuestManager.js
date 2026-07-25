// QuestManager.js
// クエスト(依頼)の受注/進行/達成/報酬、ギルドランクを一元管理する(Stage8:クエスト本実装)。
//
// 設計方針(既存モジュールとの整合性を優先):
// - EventManagerを「フラグ/カウンターの唯一の情報源」として使い続ける。討伐数の集計は
//   BattleSystemがEnemyを倒すたびに `defeated_<enemyId>` カウンターを積む(既存のgenocide_kills
//   カウンター加算と同じ場所に追加しただけ)。QuestManagerはそれを読むだけで、戦闘システムの
//   詳細には関知しない(疎結合)。
// - 所持金も同様にEventManagerのカウンター 'gold' を単一の情報源として使う(Party/Characterには
//   ステータス以外を持たせたくないため)。
//
// objective.type:
//   'defeat' - { enemyId, count } 該当敵をcount体倒すと達成条件を満たす(ギルドで報告して完了)
//   'battle' - { enemyId } 受注後、掲示板から直接その敵への挑戦(戦闘)を開始できる。
//              勝利した瞬間に自動で達成扱いになる(BattleScene側からcompleteQuestを呼ぶ)。
//
// クエストは requiredRank(現在のギルドランク以上で受注可能)に加え、任意で
// requiredCounter: { name, gte } を指定でき、特定条件(例:虐殺数)を満たすまで
// 掲示板に出てこない隠しクエストを表現できる(Gルート限定ボス用)。

const RANK_ORDER = ['E', 'D', 'C', 'B', 'A', 'S'];
// 何件クエストを達成したら次のランクに上がるか(小さい方から判定)
const RANK_THRESHOLDS = [
  ['S', 8],
  ['A', 6],
  ['B', 4],
  ['C', 2],
  ['D', 1],
  ['E', 0],
];

export class QuestManager {
  constructor(eventManager) {
    this.eventManager = eventManager;
    this.questData = {}; // quests.jsonの生データ。Game#start()でloadData()経由で流し込む。

    this.activeQuests = new Map(); // id -> { acceptedAt }
    this.completedQuests = new Set();
  }

  loadData(questData) {
    this.questData = questData ?? {};
  }

  // 「はじめから」用。questData(定義)自体はそのまま、進行状況だけ初期化する。
  reset() {
    this.activeQuests.clear();
    this.completedQuests.clear();
  }

  getQuest(id) {
    return this.questData[id] ?? null;
  }

  // questData直下には"_comment"のようなドキュメント用キーが混在し得るため、
  // 実際のクエストオブジェクト(name/objectiveを持つもの)だけを対象にする。
  getAllQuestIds() {
    return Object.keys(this.questData).filter((id) => {
      const quest = this.questData[id];
      return quest && typeof quest === 'object' && !Array.isArray(quest) && 'objective' in quest;
    });
  }

  // --- ギルドランク -----------------------------------------------------

  getGuildRank() {
    const n = this.completedQuests.size;
    for (const [rank, threshold] of RANK_THRESHOLDS) {
      if (n >= threshold) return rank;
    }
    return 'E';
  }

  _rankValue(rank) {
    const idx = RANK_ORDER.indexOf(rank);
    return idx === -1 ? 0 : idx;
  }

  // --- 状態照会 -----------------------------------------------------

  isAccepted(id) {
    return this.activeQuests.has(id);
  }

  isCompleted(id) {
    return this.completedQuests.has(id);
  }

  // ランク条件・隠しクエスト条件(requiredCounter)を満たし、まだ受注/達成していないか
  isAvailable(id) {
    const quest = this.getQuest(id);
    if (!quest) return false;
    if (this.isAccepted(id) || this.isCompleted(id)) return false;

    const requiredRank = quest.requiredRank ?? 'E';
    if (this._rankValue(this.getGuildRank()) < this._rankValue(requiredRank)) return false;

    if (quest.requiredCounter) {
      const { name, gte = 0 } = quest.requiredCounter;
      if (this.eventManager.getCounter(name) < gte) return false;
    }
    return true;
  }

  getAvailableQuestIds() {
    return this.getAllQuestIds().filter((id) => this.isAvailable(id));
  }

  getActiveQuestIds() {
    return Array.from(this.activeQuests.keys());
  }

  getCompletedQuestIds() {
    return Array.from(this.completedQuests);
  }

  // --- 進行度 -----------------------------------------------------

  // { current, required, met } を返す。'battle'型は戦闘の勝敗でしか判定できないため
  // 常にmet:falseを返す(達成処理はBattleScene側がcompleteQuestを直接呼んで行う)。
  getObjectiveProgress(id) {
    const quest = this.getQuest(id);
    const obj = quest?.objective;
    if (!obj) return { current: 0, required: 0, met: true };

    if (obj.type === 'defeat') {
      const current = this.eventManager.getCounter(`defeated_${obj.enemyId}`);
      return { current: Math.min(current, obj.count), required: obj.count, met: current >= obj.count };
    }
    if (obj.type === 'battle') {
      return { current: 0, required: 1, met: false };
    }
    return { current: 0, required: 1, met: false };
  }

  // --- 受注/達成 -----------------------------------------------------

  acceptQuest(id) {
    if (!this.isAvailable(id)) return false;
    this.activeQuests.set(id, { acceptedAt: Date.now() });
    return true;
  }

  canComplete(id) {
    if (!this.isAccepted(id)) return false;
    const quest = this.getQuest(id);
    // 'battle'型は「勝利したこと」自体が達成条件であり、カウンターでは判定できない。
    // MapScene側はbattle型クエストをこの経路(報告フロー)に回さず必ずBattleSceneへの
    // 挑戦を開始するので、ここでは「受注中である」ことだけを条件にし、
    // 実際の可否判断(=本当に勝てたか)は呼び出し元(BattleScene#_handleBattleEnd、
    // victory時のみ)に委ねる。
    if (quest?.objective?.type === 'battle') return true;
    return this.getObjectiveProgress(id).met;
  }

  // 達成条件を満たしている('defeat'型はギルドでの報告、'battle'型は勝利直後)場合のみ完了させる。
  // 戻り値: { rewards, quest } または達成条件未達ならnull。
  // 金銭報酬はここで直接EventManagerへ加算する(唯一の情報源を保つため)。
  // 経験値報酬はPartyの操作が必要なため、呼び出し側(MapScene/BattleScene)が
  // 戻り値のrewards.expを見てgainExpAllを呼ぶ想定(QuestManagerはPartyを知らない=疎結合)。
  completeQuest(id) {
    if (!this.canComplete(id)) return null;
    const quest = this.getQuest(id);

    this.activeQuests.delete(id);
    this.completedQuests.add(id);

    const rewards = quest.rewards ?? {};
    if (rewards.gold) this.eventManager.incrementCounter('gold', rewards.gold);

    return { rewards, quest };
  }

  // --- セーブ/ロード -----------------------------------------------------

  serialize() {
    return {
      active: Array.from(this.activeQuests.keys()),
      completed: Array.from(this.completedQuests),
    };
  }

  deserialize(data = {}) {
    this.activeQuests = new Map((data.active ?? []).map((id) => [id, {}]));
    this.completedQuests = new Set(data.completed ?? []);
  }
}
