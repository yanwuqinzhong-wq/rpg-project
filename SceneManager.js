// SceneManager.js
// 現在アクティブなシーン(Title/Map/Battle/Dialogueなど)を保持し、切り替えを管理する。
// 各シーンは update(dt) と render(ctx) を実装する共通インターフェースを持つ想定。

export class SceneManager {
  constructor(game) {
    this.game = game;
    this.currentScene = null;
    this.previousScene = null; // 会話シーンなどから戻る時に使用
  }

  changeScene(newScene, { keepPrevious = false } = {}) {
    if (this.currentScene && this.currentScene.onExit) {
      this.currentScene.onExit();
    }

    if (keepPrevious) {
      this.previousScene = this.currentScene;
    } else {
      this.previousScene = null;
    }

    this.currentScene = newScene;

    if (this.currentScene.onEnter) {
      this.currentScene.onEnter();
    }
  }

  returnToPrevious() {
    if (this.previousScene) {
      this.changeScene(this.previousScene);
    }
  }

  update(deltaTime) {
    if (this.currentScene && this.currentScene.update) {
      this.currentScene.update(deltaTime);
    }
  }

  render(ctx) {
    if (this.currentScene && this.currentScene.render) {
      this.currentScene.render(ctx);
    }
  }
}
