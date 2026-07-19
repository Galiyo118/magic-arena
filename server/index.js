const express = require("express");
const http = require("http");
const compression = require("compression");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 5000,
  pingTimeout: 10000,
});
const PORT = 3000;

app.use(compression());
app.use(express.static(path.join(__dirname, "..", "client"), { maxAge: "1h" }));

// ─── GAME CONSTANTS ────────────────────────────────────────────
const TILE_SIZE = 64;
const MAP = [
  "##################",
  "#................#",
  "#..##......##....#",
  "#..##............#",
  "#............##..#",
  "#......##....##..#",
  "#................#",
  "#....##..........#",
  "#............##..#",
  "#..##............#",
  "#........##......#",
  "#................#",
  "##################",
];
const MAP_ROWS = MAP.length;
const MAP_COLS = MAP[0].length;

const PLAYER_RADIUS = 14;
const PLAYER_MAX_HP = 100;
const PROJECTILE_RADIUS = 5;
const RESPAWN_TIME = 3000;
const SPAWN_PROTECTION_TIME = 2000;
const SIPHON_HEAL = 25;
const PASSIVE_REGEN = 2; // HP per second
const KNOCKBACK_FORCE = 120;
const SPRINT_MULTIPLIER = 1.55;

// ─── CLASS DEFINITIONS (server-side) ───────────────────────────
// Fast, punchy stats — short cooldowns, fast projectiles, snappy dashes
const CLASSES = {
  pyromancer: {
    speed: 170, dashSpeed: 750, dashDuration: 120, dashCooldown: 800,
    basic: { speed: 700, damage: 15, cooldown: 180, radius: 5, lifetime: 1200, type: "fireball" },
    special: { cooldown: 3500, type: "inferno_wave", damage: 22, burnDmg: 5, burnTicks: 3 },
  },
  frostweaver: {
    speed: 165, dashSpeed: 700, dashDuration: 140, dashCooldown: 900,
    basic: { speed: 800, damage: 13, cooldown: 160, radius: 4, lifetime: 1400, type: "ice_shard" },
    special: { cooldown: 5000, type: "glacial_wall", wallHp: 40, wallDuration: 4000 },
  },
  stormcaller: {
    speed: 155, dashSpeed: 800, dashDuration: 80, dashCooldown: 1000,
    basic: { speed: 650, damage: 18, cooldown: 280, radius: 5, lifetime: 1200, type: "chain_bolt" },
    special: { cooldown: 4500, type: "thunder_strike", damage: 38, radius: 70, delay: 600 },
  },
  hexblade: {
    speed: 190, dashSpeed: 780, dashDuration: 100, dashCooldown: 700,
    basic: { speed: 0, damage: 18, cooldown: 200, radius: 55, lifetime: 120, type: "hex_slash" },
    special: { cooldown: 4000, type: "shadow_bind", speed: 650, rootDuration: 1000, lifetime: 1000 },
  },
  alchemist: {
    speed: 168, dashSpeed: 720, dashDuration: 130, dashCooldown: 850,
    basic: { speed: 550, damage: 12, cooldown: 250, radius: 5, lifetime: 1600, type: "acid_flask", puddleDmg: 8, puddleDuration: 2000 },
    special: { cooldown: 6000, type: "transmute_field", healAmount: 26, damage: 20, radius: 85, duration: 2500 },
  },
};

// ─── HELPERS ──────────────────────────────────────────────────
function collidesWithWall(cx, cy, radius, walls) {
  const minCol = Math.max(0, Math.floor((cx - radius) / TILE_SIZE));
  const maxCol = Math.min(MAP_COLS - 1, Math.floor((cx + radius) / TILE_SIZE));
  const minRow = Math.max(0, Math.floor((cy - radius) / TILE_SIZE));
  const maxRow = Math.min(MAP_ROWS - 1, Math.floor((cy + radius) / TILE_SIZE));
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (MAP[row][col] === "#") {
        const rx = col * TILE_SIZE, ry = row * TILE_SIZE;
        const clx = Math.max(rx, Math.min(cx, rx + TILE_SIZE));
        const cly = Math.max(ry, Math.min(cy, ry + TILE_SIZE));
        const dx = cx - clx, dy = cy - cly;
        if (dx * dx + dy * dy < radius * radius) return true;
      }
    }
  }
  // Check ice walls
  if (walls) {
    for (const w of walls) {
      const clx = Math.max(w.x, Math.min(cx, w.x + w.width));
      const cly = Math.max(w.y, Math.min(cy, w.y + w.height));
      const dx = cx - clx, dy = cy - cly;
      if (dx * dx + dy * dy < radius * radius) return true;
    }
  }
  return false;
}

function getSpawnPoint() {
  const floors = [];
  for (let r = 0; r < MAP_ROWS; r++)
    for (let c = 0; c < MAP_COLS; c++)
      if (MAP[r][c] === ".") floors.push({ x: c * TILE_SIZE + TILE_SIZE / 2, y: r * TILE_SIZE + TILE_SIZE / 2 });
  return floors[Math.floor(Math.random() * floors.length)];
}

function overlap(x1, y1, r1, x2, y2, r2) {
  const dx = x1 - x2, dy = y1 - y2;
  return dx * dx + dy * dy < (r1 + r2) * (r1 + r2);
}

function genCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

const COLORS = [0x4fc3f7, 0xf06292, 0xaed581, 0xffd54f, 0xce93d8, 0xff8a65, 0xe57373, 0x81c784];

// ─── ROOMS ───────────────────────────────────────────────────
const rooms = {};

function createRoom(code) {
  rooms[code] = {
    code,
    players: {},
    projectiles: {},
    effects: [],
    iceWalls: [],
    puddles: [],
    projCounter: 0,
    effectCounter: 0,
    started: false,
    interval: null,
    colorIdx: 0,
  };
  return rooms[code];
}

function startGame(room) {
  if (room.started) return;
  room.started = true;

  // Spawn all players
  for (const p of Object.values(room.players)) {
    const spawn = getSpawnPoint();
    p.x = spawn.x; p.y = spawn.y;
    p.hp = PLAYER_MAX_HP; p.alive = true;
    p.kills = 0; p.deaths = 0;
  }

  // Broadcast game start (send only serializable player data)
  const playerData = {};
  for (const [id, p] of Object.entries(room.players)) {
    playerData[id] = {
      x: p.x, y: p.y, angle: p.aimAngle || 0, hp: p.hp, alive: p.alive,
      color: p.color, kills: p.kills, deaths: p.deaths, dashing: false,
      className: p.className, name: p.name,
    };
  }
  for (const p of Object.values(room.players)) {
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) sock.emit("gameStart", { map: MAP, tileSize: TILE_SIZE, myId: p.id, players: playerData });
  }

  // Game loop at 60fps
  room.interval = setInterval(() => updateRoom(room), 1000 / 60);
}

function updateRoom(room) {
  const now = Date.now();
  const dt = 1 / 60;

  // ── Update ice walls ──
  for (let i = room.iceWalls.length - 1; i >= 0; i--) {
    if (now >= room.iceWalls[i].expires) {
      room.iceWalls.splice(i, 1);
    }
  }

  // ── Update puddles ──
  for (let i = room.puddles.length - 1; i >= 0; i--) {
    const puddle = room.puddles[i];
    if (now >= puddle.expires) { room.puddles.splice(i, 1); continue; }
    // Damage players standing in puddle
    if (now - puddle.lastTick > 500) {
      puddle.lastTick = now;
      for (const p of Object.values(room.players)) {
        if (!p.alive || p.id === puddle.ownerId) continue;
        if (overlap(p.x, p.y, PLAYER_RADIUS, puddle.x, puddle.y, puddle.radius)) {
          applyDamage(room, p, puddle.ownerId, puddle.dmg);
        }
      }
    }
  }

  // ── Process timers ──
  for (const p of Object.values(room.players)) {
    // Dash end
    if (p.isDashing && now >= p.dashEnd) {
      p.isDashing = false; p.dashing = false;
    }
    // Burn ticks
    if (p.burning && now >= p.burnNextTick) {
      p.hp -= p.burnDmg;
      p.burnTicksLeft--;
      if (p.burnTicksLeft <= 0) { p.burning = false; }
      else { p.burnNextTick = now + 500; }
      if (p.hp <= 0 && p.alive) killPlayer(room, p, p.burnSource);
    }
    // Root end
    if (p.rooted && now >= p.rootEnd) { p.rooted = false; }
  }

  // ── Push players out of ice walls ──
  for (const p of Object.values(room.players)) {
    if (!p.alive) continue;
    for (const w of room.iceWalls) {
      const clx = Math.max(w.x, Math.min(p.x, w.x + w.width));
      const cly = Math.max(w.y, Math.min(p.y, w.y + w.height));
      const dx = p.x - clx, dy = p.y - cly;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < PLAYER_RADIUS) {
        if (dist === 0) { p.y -= PLAYER_RADIUS + 2; }
        else {
          const push = (PLAYER_RADIUS - dist + 2) / dist;
          p.x += dx * push;
          p.y += dy * push;
        }
      }
    }
  }

  // ── Passive HP regen ──
  for (const p of Object.values(room.players)) {
    if (!p.alive || p.burning) continue;
    if (p.hp < PLAYER_MAX_HP) {
      p.hp = Math.min(PLAYER_MAX_HP, p.hp + PASSIVE_REGEN * dt);
    }
  }

  // ── Spawn protection decay ──
  for (const p of Object.values(room.players)) {
    if (p.spawnProtection && now >= p.spawnProtectionEnd) {
      p.spawnProtection = false;
    }
  }

  // ── Apply knockback velocity ──
  for (const p of Object.values(room.players)) {
    if (!p.alive) continue;
    if (p.kbVx || p.kbVy) {
      const decay = 0.85;
      const nx = p.x + p.kbVx * dt;
      const ny = p.y + p.kbVy * dt;
      if (!collidesWithWall(nx, p.y, PLAYER_RADIUS, room.iceWalls)) p.x = nx;
      if (!collidesWithWall(p.x, ny, PLAYER_RADIUS, room.iceWalls)) p.y = ny;
      p.kbVx *= decay;
      p.kbVy *= decay;
      if (Math.abs(p.kbVx) < 5) p.kbVx = 0;
      if (Math.abs(p.kbVy) < 5) p.kbVy = 0;
    }
  }

  // ── Update players ──
  for (const p of Object.values(room.players)) {
    if (!p.alive || !p.input) continue;
    const cls = CLASSES[p.className];
    p.aimAngle = p.input.angle;

    if (!p.rooted) {
      let dx = p.input.dx || 0, dy = p.input.dy || 0;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) { dx /= len; dy /= len; }
      const sprinting = p.input.sprint && !p.isDashing;
      let speed = p.isDashing ? cls.dashSpeed : cls.speed;
      if (sprinting) speed *= SPRINT_MULTIPLIER;
      const nx = p.x + dx * speed * dt;
      const ny = p.y + dy * speed * dt;
      if (!collidesWithWall(nx, p.y, PLAYER_RADIUS, room.iceWalls)) p.x = nx;
      if (!collidesWithWall(p.x, ny, PLAYER_RADIUS, room.iceWalls)) p.y = ny;
      // Update movement angle based on actual movement direction
      if (len > 0) p.moveAngle = Math.atan2(dy, dx);
    }
  }

  // ── Update projectiles ──
  const delProj = [];
  for (const [id, proj] of Object.entries(room.projectiles)) {
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    if (now - proj.born > proj.lifetime) { delProj.push(id); continue; }
    if (collidesWithWall(proj.x, proj.y, PROJECTILE_RADIUS, room.iceWalls)) {
      // Acid flask creates puddle on wall hit
      if (proj.type === "acid_flask") {
        room.puddles.push({ x: proj.x, y: proj.y, radius: 40, dmg: proj.puddleDmg, ownerId: proj.ownerId, expires: now + proj.puddleDuration, lastTick: now });
      }
      delProj.push(id);
      continue;
    }
    for (const p of Object.values(room.players)) {
      if (p.id === proj.ownerId || !p.alive) continue;
      if (overlap(proj.x, proj.y, PROJECTILE_RADIUS, p.x, p.y, PLAYER_RADIUS)) {
        applyDamage(room, p, proj.ownerId, proj.damage);
        // Acid flask puddle on player hit
        if (proj.type === "acid_flask") {
          room.puddles.push({ x: proj.x, y: proj.y, radius: 40, dmg: proj.puddleDmg, ownerId: proj.ownerId, expires: now + proj.puddleDuration, lastTick: now });
        }
        // Shadow bind roots
        if (proj.type === "shadow_bind") {
          p.rooted = true;
          p.rootEnd = now + proj.rootDuration;
        }
        // Ice shard slows
        if (proj.type === "ice_shard") {
          p.slowed = true;
          p.slowEnd = now + 1000;
        }
        delProj.push(id);
        break;
      }
    }
  }
  for (const id of delProj) delete room.projectiles[id];

  // ── Process effects ──
  for (let i = room.effects.length - 1; i >= 0; i--) {
    const eff = room.effects[i];
    if (eff.type === "thunder_strike" && !eff.triggered && now >= eff.triggerAt) {
      eff.triggered = true;
      for (const p of Object.values(room.players)) {
        if (p.id === eff.ownerId || !p.alive) continue;
        if (overlap(p.x, p.y, PLAYER_RADIUS, eff.x, eff.y, eff.radius)) {
          applyDamage(room, p, eff.ownerId, eff.damage);
        }
      }
    }
    if (eff.type === "transmute_field") {
      // Phase 1: heal allies, Phase 2: damage enemies
      if (!eff.phase2 && now >= eff.phase2At) {
        eff.phase2 = true;
      }
      if (!eff.phase2 && now - eff.lastTick > 500) {
        eff.lastTick = now;
        const owner = room.players[eff.ownerId];
        if (owner && owner.alive) {
          owner.hp = Math.min(PLAYER_MAX_HP, owner.hp + 4);
        }
      }
      if (eff.phase2 && now - eff.lastTick > 500) {
        eff.lastTick = now;
        for (const p of Object.values(room.players)) {
          if (p.id === eff.ownerId || !p.alive) continue;
          if (overlap(p.x, p.y, PLAYER_RADIUS, eff.x, eff.y, eff.radius)) {
            applyDamage(room, p, eff.ownerId, 5);
          }
        }
      }
    }
    if (now >= eff.expires) {
      room.effects.splice(i, 1);
    }
  }

  // ── Broadcast state ──
  const state = {
    players: {},
    projectiles: room.projectiles,
    effects: room.effects,
    iceWalls: room.iceWalls,
    puddles: room.puddles,
  };
  for (const [id, p] of Object.entries(room.players)) {
    state.players[id] = {
      x: p.x, y: p.y, angle: p.aimAngle || 0, hp: Math.round(p.hp), alive: p.alive,
      color: p.color, kills: p.kills, deaths: p.deaths, dashing: p.dashing,
      className: p.className, rooted: p.rooted, burning: p.burning,
      name: p.name, spawnProtection: p.spawnProtection || false,
      sprinting: p.input ? p.input.sprint : false,
    };
  }
  for (const p of Object.values(room.players)) {
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) sock.emit("state", state);
  }
}

function applyDamage(room, player, attackerId, dmg) {
  // Spawn protection blocks all damage
  if (player.spawnProtection) return;

  player.hp -= dmg;

  // Knockback
  const attacker = room.players[attackerId];
  if (attacker) {
    const dx = player.x - attacker.x;
    const dy = player.y - attacker.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    player.kbVx = (dx / dist) * KNOCKBACK_FORCE;
    player.kbVy = (dy / dist) * KNOCKBACK_FORCE;
  }

  // Broadcast hit effect with damage amount for floating numbers
  for (const p of Object.values(room.players)) {
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) sock.emit("hit", { x: player.x, y: player.y, targetId: player.id, dmg });
  }
  if (player.hp <= 0 && player.alive) killPlayer(room, player, attackerId);
}

function killPlayer(room, player, killerId) {
  player.alive = false;
  player.deaths++;
  player.respawnAt = Date.now() + RESPAWN_TIME;
  player.waitingClassChange = true;
  const killer = room.players[killerId];
  if (killer) {
    killer.kills++;
    // Siphon: heal killer on kill
    killer.hp = Math.min(PLAYER_MAX_HP, killer.hp + SIPHON_HEAL);
  }

  // Broadcast kill with respawn time
  for (const p of Object.values(room.players)) {
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) sock.emit("kill", { killerId, victimId: player.id, respawnTime: RESPAWN_TIME });
  }

  setTimeout(() => {
    if (!room.players[player.id]) return; // player left
    const spawn = getSpawnPoint();
    player.x = spawn.x; player.y = spawn.y;
    player.hp = PLAYER_MAX_HP; player.alive = true;
    player.burning = false; player.rooted = false;
    player.kbVx = 0; player.kbVy = 0;
    player.spawnProtection = true;
    player.spawnProtectionEnd = Date.now() + SPAWN_PROTECTION_TIME;
    player.waitingClassChange = false;
  }, RESPAWN_TIME);
}

// ─── SOCKET HANDLERS ─────────────────────────────────────────
io.on("connection", (socket) => {
  let currentRoom = null;
  let playerId = null;

  socket.on("createRoom", (data, cb) => {
    const code = genCode();
    const room = createRoom(code);
    playerId = socket.id;
    room.players[playerId] = {
      id: playerId, socketId: socket.id, name: data.name || "Player",
      className: data.className || "pyromancer",
      x: 0, y: 0, aimAngle: 0, moveAngle: 0, hp: PLAYER_MAX_HP, alive: false,
      color: COLORS[room.colorIdx++ % COLORS.length],
      kills: 0, deaths: 0, dashing: false, isDashing: false,
      input: null, lastShot: 0, lastDash: 0, lastSpecial: 0,
      burning: false, rooted: false,
      kbVx: 0, kbVy: 0,
      spawnProtection: false, spawnProtectionEnd: 0,
      waitingClassChange: false, respawnAt: 0,
    };
    currentRoom = room;
    socket.join(code);
    cb({ code, playerId });
    broadcastLobby(room);
  });

  socket.on("joinRoom", (data, cb) => {
    const code = (data.code || "").toUpperCase();
    const room = rooms[code];
    if (!room) return cb({ error: "Room not found" });
    if (room.started) return cb({ error: "Game already started" });
    if (Object.keys(room.players).length >= 8) return cb({ error: "Room full" });

    playerId = socket.id;
    room.players[playerId] = {
      id: playerId, socketId: socket.id, name: data.name || "Player",
      className: data.className || "pyromancer",
      x: 0, y: 0, aimAngle: 0, moveAngle: 0, hp: PLAYER_MAX_HP, alive: false,
      color: COLORS[room.colorIdx++ % COLORS.length],
      kills: 0, deaths: 0, dashing: false, isDashing: false,
      input: null, lastShot: 0, lastDash: 0, lastSpecial: 0,
      burning: false, rooted: false,
      kbVx: 0, kbVy: 0,
      spawnProtection: false, spawnProtectionEnd: 0,
      waitingClassChange: false, respawnAt: 0,
    };
    currentRoom = room;
    socket.join(code);
    cb({ code, playerId });
    broadcastLobby(room);
  });

  socket.on("changeClass", (data) => {
    if (!currentRoom || !playerId) return;
    const p = currentRoom.players[playerId];
    if (p && CLASSES[data.className]) {
      p.className = data.className;
      broadcastLobby(currentRoom);
    }
  });

  socket.on("changeClassDead", (data) => {
    if (!currentRoom || !playerId) return;
    const p = currentRoom.players[playerId];
    if (p && !p.alive && CLASSES[data.className]) {
      p.className = data.className;
    }
  });

  socket.on("startGame", () => {
    if (!currentRoom) return;
    startGame(currentRoom);
  });

  socket.on("input", (data) => {
    if (!currentRoom || !playerId) return;
    const p = currentRoom.players[playerId];
    if (p) p.input = data;
  });

  socket.on("shoot", (data) => {
    if (!currentRoom || !playerId) return;
    const p = currentRoom.players[playerId];
    if (!p || !p.alive || p.spawnProtection) return;
    const cls = CLASSES[p.className];
    const now = Date.now();
    if (now - p.lastShot < cls.basic.cooldown) return;
    p.lastShot = now;

    const angle = data.angle;
    const basic = cls.basic;

    if (basic.type === "hex_slash") {
      // Melee arc — damage all in front
      for (const other of Object.values(currentRoom.players)) {
        if (other.id === p.id || !other.alive) continue;
        const dx = other.x - p.x, dy = other.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > basic.radius + PLAYER_RADIUS) continue;
        const aToOther = Math.atan2(dy, dx);
        let diff = aToOther - angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < Math.PI / 2) {
          applyDamage(currentRoom, other, p.id, basic.damage);
        }
      }
      // Broadcast slash effect
      for (const op of Object.values(currentRoom.players)) {
        const sock = io.sockets.sockets.get(op.socketId);
        if (sock) sock.emit("slashEffect", { x: p.x, y: p.y, angle, radius: basic.radius, ownerId: p.id });
      }
      return;
    }

    const pid = `pr_${currentRoom.projCounter++}`;
    const proj = {
      x: p.x + Math.cos(angle) * (PLAYER_RADIUS + PROJECTILE_RADIUS + 4),
      y: p.y + Math.sin(angle) * (PLAYER_RADIUS + PROJECTILE_RADIUS + 4),
      vx: Math.cos(angle) * basic.speed,
      vy: Math.sin(angle) * basic.speed,
      ownerId: p.id, id: pid, born: now, damage: basic.damage,
      lifetime: basic.lifetime, type: basic.type,
      puddleDmg: basic.puddleDmg || 0, puddleDuration: basic.puddleDuration || 0,
      rootDuration: 0,
    };
    currentRoom.projectiles[pid] = proj;

    // Broadcast muzzle flash
    for (const op of Object.values(currentRoom.players)) {
      const sock = io.sockets.sockets.get(op.socketId);
      if (sock) sock.emit("muzzleFlash", { x: proj.x, y: proj.y, angle, type: basic.type, shooterId: p.id });
    }
  });

  socket.on("special", (data) => {
    if (!currentRoom || !playerId) return;
    const p = currentRoom.players[playerId];
    if (!p || !p.alive || p.spawnProtection) return;
    const cls = CLASSES[p.className];
    const now = Date.now();
    if (now - p.lastSpecial < cls.special.cooldown) return;
    p.lastSpecial = now;

    const angle = data.angle;
    const spec = cls.special;

    if (spec.type === "inferno_wave") {
      // Cone damage + burn
      for (const other of Object.values(currentRoom.players)) {
        if (other.id === p.id || !other.alive) continue;
        const dx = other.x - p.x, dy = other.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 120) continue;
        const a = Math.atan2(dy, dx);
        let diff = a - angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < Math.PI / 3) {
          applyDamage(currentRoom, other, p.id, spec.damage);
          other.burning = true; other.burnDmg = spec.burnDmg;
          other.burnTicksLeft = spec.burnTicks; other.burnNextTick = now + 500;
          other.burnSource = p.id;
        }
      }
      broadcastEffect(currentRoom, { type: "inferno_wave", x: p.x, y: p.y, angle, ownerId: p.id, expires: now + 400 });
    }

    if (spec.type === "glacial_wall") {
      const wallW = 160, wallH = 20;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const wx = p.x + cos * 80 - wallW / 2;
      const wy = p.y + sin * 80 - wallH / 2;
      currentRoom.iceWalls.push({ x: wx, y: wy, width: wallW, height: wallH, hp: spec.wallHp, expires: now + spec.wallDuration });
    }

    if (spec.type === "thunder_strike") {
      const tx = p.x + Math.cos(angle) * 150;
      const ty = p.y + Math.sin(angle) * 150;
      broadcastEffect(currentRoom, {
        type: "thunder_strike", x: tx, y: ty, radius: spec.radius,
        ownerId: p.id, damage: spec.damage, triggerAt: now + spec.delay,
        triggered: false, expires: now + spec.delay + 300,
      });
    }

    if (spec.type === "shadow_bind") {
      const pid = `pr_${currentRoom.projCounter++}`;
      currentRoom.projectiles[pid] = {
        x: p.x + Math.cos(angle) * 20, y: p.y + Math.sin(angle) * 20,
        vx: Math.cos(angle) * spec.speed, vy: Math.sin(angle) * spec.speed,
        ownerId: p.id, id: pid, born: now, damage: 0,
        lifetime: spec.lifetime, type: "shadow_bind",
        rootDuration: spec.rootDuration, puddleDmg: 0, puddleDuration: 0,
      };
    }

    if (spec.type === "transmute_field") {
      broadcastEffect(currentRoom, {
        type: "transmute_field", x: p.x + Math.cos(angle) * 60, y: p.y + Math.sin(angle) * 60,
        radius: spec.radius, ownerId: p.id, damage: spec.damage,
        healAmount: spec.healAmount, phase2: false, phase2At: now + 1500,
        lastTick: now, expires: now + spec.duration,
      });
    }
  });

  socket.on("dash", () => {
    if (!currentRoom || !playerId) return;
    const p = currentRoom.players[playerId];
    if (!p || !p.alive || p.isDashing || p.rooted) return;
    const cls = CLASSES[p.className];
    const now = Date.now();
    if (now - p.lastDash < cls.dashCooldown) return;
    p.lastDash = now;
    p.isDashing = true; p.dashing = true;
    p.dashEnd = now + cls.dashDuration;
  });

  socket.on("disconnect", () => {
    if (currentRoom && playerId) {
      delete currentRoom.players[playerId];
      if (Object.keys(currentRoom.players).length === 0) {
        if (currentRoom.interval) clearInterval(currentRoom.interval);
        delete rooms[currentRoom.code];
      } else {
        broadcastLobby(currentRoom);
      }
    }
  });
});

function broadcastEffect(room, eff) {
  room.effects.push(eff);
}

function broadcastLobby(room) {
  const lobbyData = {
    code: room.code,
    players: Object.values(room.players).map(p => ({ id: p.id, name: p.name, className: p.className, color: p.color })),
  };
  for (const p of Object.values(room.players)) {
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) sock.emit("lobbyUpdate", lobbyData);
  }
}

server.listen(PORT, () => {
  console.log(`Magic Arena running on http://localhost:${PORT}`);
});
