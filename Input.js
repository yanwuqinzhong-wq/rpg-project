// Input.js
// キーボード入力の状態を保持するだけのシンプルなクラス。
// シーン側は isDown('ArrowUp') や wasPressed('z') のように参照する。

export class Input {
  constructor() {
    this.keysDown = new Set();
    this.keysPressed = new Set(); // このフレームで押された(1フレームのみ)

    window.addEventListener('keydown', (e) => {
      if (!this.keysDown.has(e.key)) {
        this.keysPressed.add(e.key);
      }
      this.keysDown.add(e.key);
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.key);
    });
  }

  isDown(key) {
    return this.keysDown.has(key);
  }

  // 呼び出し側が毎フレーム末尾でclearFrame()を呼ぶ想定
  wasPressed(key) {
    return this.keysPressed.has(key);
  }

  clearFrame() {
    this.keysPressed.clear();
  }
}
