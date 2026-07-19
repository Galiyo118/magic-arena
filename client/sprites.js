// ─── PIXEL ART SPRITE GENERATOR ──────────────────────────────
// Generates Enter the Gungeon-style pixel art at runtime

const SPRITE_SCALE = 2;

const CLASS_PALETTES = {
  pyromancer:  { body: "#c0392b", accent: "#e74c3c", hat: "#e67e22", outline: "#2c1810", skin: "#f5cba7" },
  frostweaver: { body: "#2980b9", accent: "#5dade2", hat: "#85c1e9", outline: "#1a3a4a", skin: "#d5f4e6" },
  stormcaller: { body: "#7d3c98", accent: "#a569bd", hat: "#d2b4de", outline: "#2a1536", skin: "#f0e0ff" },
  hexblade:    { body: "#1abc9c", accent: "#2ecc71", hat: "#16a085", outline: "#0a3d2a", skin: "#d1f2eb" },
  alchemist:   { body: "#839b25", accent: "#a8e84e", hat: "#c4e84e", outline: "#2d3a0a", skin: "#f9f3c0" },
};

const PROJ_COLORS = {
  fireball:     { core: "#ffffff", mid: "#ffab00", outer: "#ff6f00" },
  ice_shard:    { core: "#ffffff", mid: "#aed6f1", outer: "#5dade2" },
  chain_bolt:   { core: "#ffffff", mid: "#d7bde2", outer: "#8e44ad" },
  hex_slash:    { core: "#ffffff", mid: "#82e0aa", outer: "#1abc9c" },
  acid_flask:   { core: "#f9e79f", mid: "#a8e84e", outer: "#6d8b15" },
  shadow_bind:  { core: "#ffffff", mid: "#1abc9c", outer: "#0a3d2a" },
};

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { canvas: c, ctx };
}

function addTex(scene, key, canvas) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
}

function generateSprites(scene) {
  for (const [cls, pal] of Object.entries(CLASS_PALETTES)) {
    generatePlayerSprite(scene, cls, pal);
    generatePlayerDashSprite(scene, cls, pal);
  }
  for (const [type, colors] of Object.entries(PROJ_COLORS)) {
    generateProjectileSprite(scene, type, colors);
  }
  generateWallTile(scene);
  generateFloorTile(scene);
  generateParticleSprite(scene);
}

function generatePlayerSprite(scene, className, pal) {
  const w = 16, h = 20;
  const { canvas, ctx } = makeCanvas(w * SPRITE_SCALE, h * SPRITE_SCALE);

  const px = (x, y, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x * SPRITE_SCALE, y * SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE);
  };

  // Body (robe)
  for (let y = 10; y < 18; y++)
    for (let x = 5; x < 11; x++) px(x, y, pal.body);
  // Body outline
  for (let y = 10; y < 18; y++) { px(4, y, pal.outline); px(11, y, pal.outline); }
  for (let x = 4; x < 12; x++) px(x, 18, pal.outline);
  // Feet
  px(5, 18, pal.outline); px(6, 18, pal.outline);
  px(9, 18, pal.outline); px(10, 18, pal.outline);
  px(5, 19, pal.outline); px(10, 19, pal.outline);
  // Head
  for (let y = 5; y < 10; y++)
    for (let x = 5; x < 11; x++) px(x, y, pal.skin);
  for (let y = 4; y < 10; y++) { px(4, y, pal.outline); px(11, y, pal.outline); }
  for (let x = 5; x < 11; x++) px(x, 4, pal.outline);
  // Eyes
  px(6, 7, pal.outline); px(9, 7, pal.outline);

  // Hats per class
  if (className === "pyromancer") {
    for (let x = 4; x < 12; x++) px(x, 3, pal.hat);
    for (let x = 5; x < 11; x++) px(x, 2, pal.hat);
    for (let x = 6; x < 10; x++) px(x, 1, pal.hat);
    px(7, 0, pal.hat); px(8, 0, pal.hat);
    px(3, 3, pal.outline); px(12, 3, pal.outline);
  } else if (className === "frostweaver") {
    for (let x = 3; x < 13; x++) px(x, 3, pal.hat);
    for (let x = 4; x < 12; x++) px(x, 2, pal.hat);
    for (let x = 5; x < 11; x++) px(x, 1, pal.hat);
    px(3, 4, pal.hat); px(12, 4, pal.hat);
  } else if (className === "stormcaller") {
    for (let x = 4; x < 12; x++) px(x, 3, pal.hat);
    for (let x = 5; x < 11; x++) px(x, 2, pal.hat);
    for (let x = 6; x < 10; x++) px(x, 1, pal.hat);
    px(7, 0, pal.accent); px(8, 0, pal.accent);
  } else if (className === "hexblade") {
    for (let x = 4; x < 12; x++) px(x, 3, pal.hat);
    for (let x = 5; x < 11; x++) px(x, 2, pal.hat);
    px(4, 1, pal.hat); px(11, 1, pal.hat);
    px(3, 0, pal.hat); px(12, 0, pal.hat);
  } else if (className === "alchemist") {
    for (let x = 4; x < 12; x++) px(x, 3, pal.hat);
    for (let x = 5; x < 11; x++) { px(x, 2, pal.hat); px(x, 1, pal.hat); }
    px(5, 6, pal.accent); px(6, 6, pal.accent);
    px(9, 6, pal.accent); px(10, 6, pal.accent);
  }

  // Arms
  px(3, 11, pal.body); px(3, 12, pal.body); px(3, 13, pal.skin);
  px(12, 11, pal.body); px(12, 12, pal.body); px(12, 13, pal.skin);
  // Accent stripe
  for (let y = 12; y < 17; y++) { px(7, y, pal.accent); px(8, y, pal.accent); }

  addTex(scene, `player_${className}`, canvas);
}

function generatePlayerDashSprite(scene, className, pal) {
  const w = 16, h = 20;
  const { canvas, ctx } = makeCanvas(w * SPRITE_SCALE, h * SPRITE_SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.85;
  for (let y = 0; y < h; y++)
    for (let x = 4; x < 12; x++)
      ctx.fillRect(x * SPRITE_SCALE, y * SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE);
  addTex(scene, `player_${className}_dash`, canvas);
}

function generateProjectileSprite(scene, type, colors) {
  const size = 12;
  const { canvas, ctx } = makeCanvas(size * SPRITE_SCALE, size * SPRITE_SCALE);
  const cx = size / 2, cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2);
      if (d < 6) { ctx.fillStyle = colors.outer; ctx.fillRect(x * SPRITE_SCALE, y * SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE); }
      if (d < 4) { ctx.fillStyle = colors.mid; ctx.fillRect(x * SPRITE_SCALE, y * SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE); }
      if (d < 2) { ctx.fillStyle = colors.core; ctx.fillRect(x * SPRITE_SCALE, y * SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE); }
    }
  }
  addTex(scene, `proj_${type}`, canvas);
}

function generateWallTile(scene) {
  const s = 64;
  const { canvas, ctx } = makeCanvas(s, s);
  ctx.fillStyle = "#2c3e6d";
  ctx.fillRect(0, 0, s, s);
  // Brick pattern
  ctx.fillStyle = "#354d7a";
  for (let row = 0; row < 4; row++) {
    const y = row * 16;
    const off = (row % 2) * 16;
    for (let col = 0; col < 4; col++) {
      ctx.fillRect(off + col * 32 + 1, y + 1, 14, 14);
    }
  }
  ctx.strokeStyle = "#4a6fa5";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, s - 2, s - 2);
  addTex(scene, "wall_tile", canvas);
}

function generateFloorTile(scene) {
  const s = 64;
  const { canvas, ctx } = makeCanvas(s, s);
  ctx.fillStyle = "#16213e";
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = "#1a2744";
  for (let x = 0; x < s; x += 16)
    for (let y = 0; y < s; y += 16)
      ctx.fillRect(x, y, 2, 2);
  addTex(scene, "floor_tile", canvas);
}

function generateParticleSprite(scene) {
  const { canvas, ctx } = makeCanvas(4, 4);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 4, 4);
  addTex(scene, "particle", canvas);
}
