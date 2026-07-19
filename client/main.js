const config = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: "#0a0a1a",
  pixelArt: true,
  scene: [MenuScene, GameScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);
