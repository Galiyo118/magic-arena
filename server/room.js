const colyseus = require("colyseus");
const { Schema, MapSchema, type } = require("@colyseus/schema");

// ─── MAP ───────────────────────────────────────────────────────
// # = wall, . = floor. Each cell is 64x64 pixels.
const TILE_SIZE = 64;
const MAP = [
  "################",
  "#..............#",
  "#..##....##....#",
  "#..##..........#",
  "#..........##..#",
  "#....##....##..#",
  "#..............#",
  "#....##........#",
  "#..........##..#",
  "#..##..........#",
  "#..............#",
  "################",
];
const MAP_ROWS = MAP.length;
const MAP_COLS = MAP[0].length;

// ─── GAME CONSTANTS ────────────────────────────────────────────
const PLAYER_SPEED = 200;       // pixels per second
const PLAYER_RADIUS = 16;
const PLAYER_MAX_HP = 100;
const DASH_SPEED = 600;         // pixels per second during dash
const DASH_DURATION = 150;      // ms
const DASH_COOLDOWN = 1500;     // ms
const PROJECTILE_SPEED = 500;   // pixels per second
const PROJECTILE_RADIUS = 6;
const PROJECTILE_DAMAGE = 20;
const PROJECTILE_LIFETIME = 2000; // ms before despawn
const SHOOT_COOLDOWN = 300;     // ms between shots
const RESPAWN_TIME = 2000;      // ms

// ─── SCHEMA DEFINITIONS ───────────────────────────────────────
// These are synced automatically to every client via Colyseus.

class Player extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.angle = 0;
    this.hp = PLAYER_MAX_HP;
    this.alive = true;
    this.color = 0x00ff00;
    this.kills = 0;
    this.deaths = 0;
    this.dashing = false;
  }
}
type("float32")(Player.prototype, "x");
type("float32")(Player.prototype, "y");
type("float32")(Player.prototype, "angle");
type("int16")(Player.prototype, "hp");
type("boolean")(Player.prototype, "alive");
type("int32")(Player.prototype, "color");
type("int16")(Player.prototype, "kills");
type("int16")(Player.prototype, "deaths");
type("boolean")(Player.prototype, "dashing");

class Projectile extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.ownerId = "";
    this.id = "";
  }
}
type("float32")(Projectile.prototype, "x");
type("float32")(Projectile.prototype, "y");
type("float32")(Projectile.prototype, "vx");
type("float32")(Projectile.prototype, "vy");
type("string")(Projectile.prototype, "ownerId");
type("string")(Projectile.prototype, "id");

class GameState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.projectiles = new MapSchema();
  }
}
type({ map: Player })(GameState.prototype, "players");
type({ map: Projectile })(GameState.prototype, "projectiles");

// ─── HELPERS ──────────────────────────────────────────────────

// Check if a circle collides with any wall tile
function collidesWithWall(cx, cy, radius) {
  // Check all tiles the circle might overlap
  const minCol = Math.max(0, Math.floor((cx - radius) / TILE_SIZE));
  const maxCol = Math.min(MAP_COLS - 1, Math.floor((cx + radius) / TILE_SIZE));
  const minRow = Math.max(0, Math.floor((cy - radius) / TILE_SIZE));
  const maxRow = Math.min(MAP_ROWS - 1, Math.floor((cy + radius) / TILE_SIZE));

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (MAP[row][col] === "#") {
        // Rectangle vs circle collision
        const rectX = col * TILE_SIZE;
        const rectY = row * TILE_SIZE;
        const closestX = Math.max(rectX, Math.min(cx, rectX + TILE_SIZE));
        const closestY = Math.max(rectY, Math.min(cy, rectY + TILE_SIZE));
        const dx = cx - closestX;
        const dy = cy - closestY;
        if (dx * dx + dy * dy < radius * radius) return true;
      }
    }
  }
  return false;
}

// Find a random floor tile to spawn on
function getSpawnPoint() {
  const floors = [];
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      if (MAP[row][col] === ".") {
        floors.push({ x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 });
      }
    }
  }
  return floors[Math.floor(Math.random() * floors.length)];
}

// Circle vs circle overlap check
function circlesOverlap(x1, y1, r1, x2, y2, r2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy < (r1 + r2) * (r1 + r2);
}

// Player colors to cycle through
const COLORS = [0x4fc3f7, 0xf06292, 0xaed581, 0xffd54f, 0xce93d8, 0xff8a65];
let colorIndex = 0;

// ─── GAME ROOM ────────────────────────────────────────────────

class ArenaRoom extends colyseus.Room {
  onCreate() {
    this.setState(new GameState());
    this.projectileCounter = 0;

    // Per-player server-side data (cooldowns, dash state, etc.)
    // Not synced to clients — only used for logic.
    this.playerData = {};

    // ── HANDLE INPUT MESSAGES FROM CLIENTS ──
    this.onMessage("input", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      const pData = this.playerData[client.sessionId];
      if (!player || !pData || !player.alive) return;

      // Store latest input
      pData.input = data; // { dx, dy, angle }
    });

    this.onMessage("shoot", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      const pData = this.playerData[client.sessionId];
      if (!player || !pData || !player.alive) return;

      const now = Date.now();
      if (now - pData.lastShot < SHOOT_COOLDOWN) return;
      pData.lastShot = now;

      // Create projectile flying toward the mouse angle
      const angle = data.angle;
      const id = `p_${this.projectileCounter++}`;
      const proj = new Projectile();
      // Spawn slightly in front of player
      proj.x = player.x + Math.cos(angle) * (PLAYER_RADIUS + PROJECTILE_RADIUS + 4);
      proj.y = player.y + Math.sin(angle) * (PLAYER_RADIUS + PROJECTILE_RADIUS + 4);
      proj.vx = Math.cos(angle) * PROJECTILE_SPEED;
      proj.vy = Math.sin(angle) * PROJECTILE_SPEED;
      proj.ownerId = client.sessionId;
      proj.id = id;

      this.state.projectiles.set(id, proj);

      // Auto-remove after lifetime
      pData.projectileTimers.push(
        this.clock.setTimeout(() => {
          this.state.projectiles.delete(id);
        }, PROJECTILE_LIFETIME)
      );
    });

    this.onMessage("dash", (client) => {
      const player = this.state.players.get(client.sessionId);
      const pData = this.playerData[client.sessionId];
      if (!player || !pData || !player.alive) return;

      const now = Date.now();
      if (now - pData.lastDash < DASH_COOLDOWN) return;
      if (pData.isDashing) return;

      pData.lastDash = now;
      pData.isDashing = true;
      player.dashing = true;

      this.clock.setTimeout(() => {
        pData.isDashing = false;
        player.dashing = false;
      }, DASH_DURATION);
    });

    // ── SERVER GAME LOOP (60 fps) ──
    this.setSimulationInterval((deltaMs) => this.update(deltaMs), 1000 / 60);
  }

  update(deltaMs) {
    const dt = deltaMs / 1000; // delta in seconds

    // ── UPDATE PLAYERS ──
    this.state.players.forEach((player, sessionId) => {
      const pData = this.playerData[sessionId];
      if (!player.alive || !pData || !pData.input) return;

      const input = pData.input;
      player.angle = input.angle;

      // Compute movement
      let dx = input.dx || 0;
      let dy = input.dy || 0;

      // Normalize diagonal movement
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
      }

      const speed = pData.isDashing ? DASH_SPEED : PLAYER_SPEED;
      let newX = player.x + dx * speed * dt;
      let newY = player.y + dy * speed * dt;

      // Wall collision — try each axis separately so you slide along walls
      if (!collidesWithWall(newX, player.y, PLAYER_RADIUS)) {
        player.x = newX;
      }
      if (!collidesWithWall(player.x, newY, PLAYER_RADIUS)) {
        player.y = newY;
      }
    });

    // ── UPDATE PROJECTILES ──
    const toDelete = [];
    this.state.projectiles.forEach((proj, id) => {
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;

      // Wall collision → destroy
      if (collidesWithWall(proj.x, proj.y, PROJECTILE_RADIUS)) {
        toDelete.push(id);
        return;
      }

      // Hit players
      this.state.players.forEach((player, sessionId) => {
        if (sessionId === proj.ownerId) return; // can't hit yourself
        if (!player.alive) return;
        if (circlesOverlap(proj.x, proj.y, PROJECTILE_RADIUS, player.x, player.y, PLAYER_RADIUS)) {
          player.hp -= PROJECTILE_DAMAGE;
          toDelete.push(id);

          if (player.hp <= 0) {
            player.alive = false;
            player.deaths++;

            // Credit the killer
            const killer = this.state.players.get(proj.ownerId);
            if (killer) killer.kills++;

            // Respawn after delay
            this.clock.setTimeout(() => {
              const spawn = getSpawnPoint();
              player.x = spawn.x;
              player.y = spawn.y;
              player.hp = PLAYER_MAX_HP;
              player.alive = true;
            }, RESPAWN_TIME);
          }
        }
      });
    });

    // Clean up destroyed projectiles
    for (const id of toDelete) {
      this.state.projectiles.delete(id);
    }
  }

  onJoin(client) {
    console.log(`${client.sessionId} joined`);
    const spawn = getSpawnPoint();
    const player = new Player();
    player.x = spawn.x;
    player.y = spawn.y;
    player.color = COLORS[colorIndex % COLORS.length];
    colorIndex++;

    this.state.players.set(client.sessionId, player);
    this.playerData[client.sessionId] = {
      input: null,
      lastShot: 0,
      lastDash: 0,
      isDashing: false,
      projectileTimers: [],
    };

    // Tell the client the map layout and their session ID
    client.send("init", { map: MAP, tileSize: TILE_SIZE, sessionId: client.sessionId });
  }

  onLeave(client) {
    console.log(`${client.sessionId} left`);
    this.state.players.delete(client.sessionId);
    // Clean up timers
    const pData = this.playerData[client.sessionId];
    if (pData) {
      pData.projectileTimers.forEach((t) => t.clear());
    }
    delete this.playerData[client.sessionId];
  }
}

module.exports = { ArenaRoom, MAP, TILE_SIZE };
