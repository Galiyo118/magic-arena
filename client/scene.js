// ─── GAME SCENE ──────────────────────────────────────────────

const TRAIL_COLORS = {
  fireball: 0xff6f00, ice_shard: 0x5dade2, chain_bolt: 0x8e44ad,
  acid_flask: 0xa8e84e, shadow_bind: 0x1abc9c,
};
const FLASH_COLORS = {
  fireball: 0xffab00, ice_shard: 0xaed6f1, chain_bolt: 0xd7bde2,
  acid_flask: 0xc4e84e, shadow_bind: 0x82e0aa,
};

class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
  }

  init(data) {
    this.socket = data.socket;
    this.mapData = data.map;
    this.mapName = data.mapName || "";
    this.tileSize = data.tileSize;
    this.myId = data.myId;
    this.myClass = data.className;
    this.serverPlayers = data.players;
    this.killLimit = data.killLimit || 10;
  }

  create() {
    generateSprites(this);
    SFX.init();

    this.playerSprites = {};
    this.projectileSprites = {};
    this.effectSprites = {};
    this.lerpPlayers = {};
    this.trails = []; // projectile trail particles
    this.floatingTexts = []; // damage numbers

    // ─── INPUT ───────────────────────────────────────────
    this.keys = this.input.keyboard.addKeys({
      w: Phaser.Input.Keyboard.KeyCodes.W,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      shift: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      tab: Phaser.Input.Keyboard.KeyCodes.TAB,
      m: Phaser.Input.Keyboard.KeyCodes.M,
    });
    this.input.keyboard.addCapture("TAB");
    this.spaceJustPressed = false;
    this.holdingFire = false;
    this.lastFireTime = 0;
    this.isDead = false;
    this.deathClassPicker = null;

    // Auto-fire on hold
    this.input.on("pointerdown", (pointer) => {
      SFX.resume();
      if (pointer.leftButtonDown()) this.holdingFire = true;
      if (pointer.rightButtonDown()) {
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const me = this.lerpPlayers[this.myId];
        if (!me) return;
        const angle = Math.atan2(worldPoint.y - me.y, worldPoint.x - me.x);
        this.socket.emit("special", { angle });
        this.lastSpecialTime = Date.now();
        SFX.special();
      }
    });
    this.input.on("pointerup", (pointer) => {
      if (pointer.leftButtonReleased()) this.holdingFire = false;
    });

    this.game.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // ─── DRAW MAP ────────────────────────────────────────
    this.drawMap();

    // ─── HUD ─────────────────────────────────────────────
    this.hud = this.add.text(10, 10, "", {
      fontSize: "14px", fill: "#ffffff", fontFamily: "monospace",
      backgroundColor: "#000000aa", padding: { x: 8, y: 4 },
    }).setScrollFactor(0).setDepth(200);

    this.classHud = this.add.text(10, 38, "", {
      fontSize: "11px", fill: "#aaaaaa", fontFamily: "monospace",
      backgroundColor: "#000000aa", padding: { x: 8, y: 4 },
    }).setScrollFactor(0).setDepth(200);

    // Cooldown bars with labels
    const barX = 70, barW = 140;
    this.add.text(10, 59, "BASIC", { fontSize: "8px", fill: "#4fc3f7", fontFamily: "monospace" }).setScrollFactor(0).setDepth(200);
    this.cdBarBg = this.add.rectangle(barX, 62, barW, 6, 0x333333).setOrigin(0, 0).setScrollFactor(0).setDepth(200);
    this.cdBarFill = this.add.rectangle(barX, 62, barW, 6, 0x4fc3f7).setOrigin(0, 0).setScrollFactor(0).setDepth(200);
    this.add.text(10, 71, "SPEC", { fontSize: "8px", fill: "#ff6f00", fontFamily: "monospace" }).setScrollFactor(0).setDepth(200);
    this.cdSpecBg = this.add.rectangle(barX, 74, barW, 6, 0x333333).setOrigin(0, 0).setScrollFactor(0).setDepth(200);
    this.cdSpecFill = this.add.rectangle(barX, 74, barW, 6, 0xff6f00).setOrigin(0, 0).setScrollFactor(0).setDepth(200);
    this.add.text(10, 83, "DASH", { fontSize: "8px", fill: "#4caf50", fontFamily: "monospace" }).setScrollFactor(0).setDepth(200);
    this.cdDashBg = this.add.rectangle(barX, 86, barW, 6, 0x333333).setOrigin(0, 0).setScrollFactor(0).setDepth(200);
    this.cdDashFill = this.add.rectangle(barX, 86, barW, 6, 0x4caf50).setOrigin(0, 0).setScrollFactor(0).setDepth(200);

    // Client-side cooldown durations per class
    this.classCooldowns = {
      pyromancer:  { basic: 180, special: 3500, dash: 800 },
      frostweaver: { basic: 160, special: 5000, dash: 900 },
      stormcaller: { basic: 280, special: 4500, dash: 1000 },
      hexblade:    { basic: 200, special: 4000, dash: 700 },
      alchemist:   { basic: 250, special: 6000, dash: 850 },
    };

    // Kill feed
    this.killFeed = [];
    this.killFeedText = this.add.text(this.cameras.main.width - 10, 10, "", {
      fontSize: "11px", fill: "#ff6666", fontFamily: "monospace",
      backgroundColor: "#000000aa", padding: { x: 6, y: 3 },
    }).setScrollFactor(0).setDepth(200).setOrigin(1, 0);

    // Mute indicator
    this.muteText = this.add.text(this.cameras.main.width - 10, this.cameras.main.height - 20, "", {
      fontSize: "10px", fill: "#888888", fontFamily: "monospace",
    }).setScrollFactor(0).setDepth(200).setOrigin(1, 0);

    // Tab scoreboard (hidden until Tab held)
    const sbX = this.cameras.main.width / 2;
    this.scoreboardBg = this.add.rectangle(sbX, 200, 420, 240, 0x000000, 0.85)
      .setStrokeStyle(2, 0x4fc3f7).setScrollFactor(0).setDepth(400).setVisible(false);
    this.scoreboardText = this.add.text(sbX, 200, "", {
      fontSize: "13px", fontFamily: "monospace", fill: "#ffffff", lineSpacing: 8, align: "left",
    }).setOrigin(0.5).setScrollFactor(0).setDepth(401).setVisible(false);

    // Track cooldowns locally
    this.lastShootTime = 0;
    this.lastSpecialTime = 0;
    this.lastDashTime = 0;

    // ─── SOCKET EVENTS ──────────────────────────────────
    // Clear old listeners first so a rematch does not stack duplicates
    ["state", "hit", "kill", "slashEffect", "muzzleFlash", "matchOver", "gameStart"].forEach(e => this.socket.off(e));
    this.matchEnded = false;
    this.socket.on("state", (state) => this.onState(state));
    this.socket.on("hit", (data) => this.onHit(data));
    this.socket.on("kill", (data) => this.onKill(data));
    this.socket.on("slashEffect", (data) => this.onSlashEffect(data));
    this.socket.on("muzzleFlash", (data) => this.onMuzzleFlash(data));
    this.socket.on("matchOver", (data) => this.onMatchOver(data));
    this.socket.on("gameStart", (data) => {
      // Rematch: restart the scene with fresh match data
      this.scene.restart({
        socket: this.socket,
        map: data.map,
        mapName: data.mapName,
        tileSize: data.tileSize,
        killLimit: data.killLimit,
        myId: data.myId,
        players: data.players,
        className: this.myClass,
      });
    });

    // Init lerp
    for (const [id, p] of Object.entries(this.serverPlayers)) {
      this.lerpPlayers[id] = { x: p.x, y: p.y, tx: p.x, ty: p.y, angle: p.angle, tAngle: p.angle };
    }
  }

  // ─── MAP ───────────────────────────────────────────────

  drawMap() {
    const rows = this.mapData.length;
    const cols = this.mapData[0].length;
    const totalW = cols * this.tileSize;
    const totalH = rows * this.tileSize;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tex = this.mapData[r][c] === "#" ? "wall_tile" : "floor_tile";
        const depth = this.mapData[r][c] === "#" ? 0 : -2;
        this.add.image(c * this.tileSize + this.tileSize / 2, r * this.tileSize + this.tileSize / 2, tex).setDepth(depth);
      }
    }
    this.cameras.main.setBounds(0, 0, totalW, totalH);
  }

  // ─── STATE UPDATE ──────────────────────────────────────

  onState(state) {
    if (this.matchEnded) return;
    // ── Players ──
    const seenIds = new Set();
    for (const [id, p] of Object.entries(state.players)) {
      seenIds.add(id);
      if (!this.lerpPlayers[id]) {
        this.lerpPlayers[id] = { x: p.x, y: p.y, tx: p.x, ty: p.y, angle: p.angle, tAngle: p.angle };
      }
      const lp = this.lerpPlayers[id];
      lp.tx = p.x; lp.ty = p.y; lp.tAngle = p.angle;
      if (id === this.myId) { lp.x = p.x; lp.y = p.y; lp.angle = p.angle; }

      if (!this.playerSprites[id]) this.createPlayerSprite(id, p);
      this.updatePlayerVisual(id, p, lp);
    }
    for (const id of Object.keys(this.playerSprites)) {
      if (!seenIds.has(id)) {
        this.playerSprites[id].container.destroy();
        delete this.playerSprites[id];
        delete this.lerpPlayers[id];
      }
    }

    // ── Projectiles ──
    const seenProj = new Set();
    for (const [id, proj] of Object.entries(state.projectiles)) {
      seenProj.add(id);
      if (!this.projectileSprites[id]) this.createProjectileSprite(id, proj);
      const spr = this.projectileSprites[id];
      if (spr) {
        spr.setPosition(proj.x, proj.y);
        // Spawn trail particle
        this.spawnTrail(proj.x, proj.y, proj.type);
      }
    }
    for (const id of Object.keys(this.projectileSprites)) {
      if (!seenProj.has(id)) {
        // Projectile removed — small burst where it was
        const spr = this.projectileSprites[id];
        if (spr) {
          this.spawnParticles(spr.x, spr.y, 0xffffff, 4);
          spr.destroy();
        }
        delete this.projectileSprites[id];
      }
    }

    // ── Effects ──
    for (const id of Object.keys(this.effectSprites)) {
      this.effectSprites[id].destroy();
      delete this.effectSprites[id];
    }
    for (const eff of state.effects) this.drawEffect(eff);

    // ── Ice walls ──
    if (this.iceWallGfx) this.iceWallGfx.destroy();
    this.iceWallGfx = this.add.graphics().setDepth(1);
    for (const w of state.iceWalls) {
      this.iceWallGfx.fillStyle(0x85c1e9, 0.7);
      this.iceWallGfx.fillRect(w.x, w.y, w.width, w.height);
      this.iceWallGfx.lineStyle(2, 0xaed6f1, 1);
      this.iceWallGfx.strokeRect(w.x, w.y, w.width, w.height);
    }

    // ── Puddles ──
    if (this.puddleGfx) this.puddleGfx.destroy();
    this.puddleGfx = this.add.graphics().setDepth(-1);
    for (const p of state.puddles) {
      this.puddleGfx.fillStyle(0xa8e84e, 0.3);
      this.puddleGfx.fillCircle(p.x, p.y, p.radius);
      this.puddleGfx.lineStyle(1, 0x6d8b15, 0.5);
      this.puddleGfx.strokeCircle(p.x, p.y, p.radius);
    }

    // ── Camera ──
    const me = this.lerpPlayers[this.myId];
    if (me) this.cameras.main.centerOn(me.x, me.y);

    // ── HUD ──
    const myData = state.players[this.myId];

    // Tab scoreboard content
    if (this.keys.tab.isDown) {
      const rows = Object.entries(state.players)
        .map(([id, p]) => ({ id, name: p.name || id.slice(0, 6), className: p.className, kills: p.kills, deaths: p.deaths }))
        .sort((x, y) => y.kills - x.kills);
      const lines = ["NAME           CLASS         K   D", ""];
      for (const r of rows) {
        const marker = r.id === this.myId ? "> " : "  ";
        lines.push(`${marker}${r.name.padEnd(13)}${r.className.padEnd(13)}${String(r.kills).padStart(2)}  ${String(r.deaths).padStart(2)}`);
      }
      this.scoreboardText.setText(lines.join("\n"));
    }

    if (myData) {
      const sprintLabel = myData.sprinting ? " [SPRINT]" : "";
      const shieldLabel = myData.spawnProtection ? " [SHIELD]" : "";
      this.hud.setText(`HP: ${myData.hp}  K: ${myData.kills}/${this.killLimit}  D: ${myData.deaths}  ${myData.alive ? "" : "DEAD"}${sprintLabel}${shieldLabel}`);
      this.classHud.setText(`${myData.className.toUpperCase()}${this.mapName ? " @ " + this.mapName.toUpperCase() : ""}  |  LClick: Shoot  RClick: Special  Space: Dash  Shift: Sprint  Tab: Scores  M: Mute`);

      // Show/hide class picker on death
      if (!myData.alive && !this.isDead) {
        this.isDead = true;
        this.showDeathClassPicker();
      } else if (myData.alive && this.isDead) {
        this.isDead = false;
        this.hideDeathClassPicker();
      }
    }
  }

  // ─── PLAYER SPRITES ────────────────────────────────────

  createPlayerSprite(id, p) {
    const container = this.add.container(p.x, p.y).setDepth(10);
    const sprite = this.add.image(0, 0, `player_${p.className}`).setOrigin(0.5);

    const arrow = this.add.graphics();
    arrow.fillStyle(0xffffff, 0.8);
    arrow.fillTriangle(22, 0, 14, -5, 14, 5);
    container.add(arrow);
    container.add(sprite);

    const isMe = id === this.myId;
    const label = isMe ? "YOU" : (p.name || id.slice(0, 6));
    const nameTag = this.add.text(0, -26, label, {
      fontSize: "10px", fill: isMe ? "#ffd54f" : "#ffffff",
      fontFamily: "monospace", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5);
    container.add(nameTag);

    const hpBg = this.add.rectangle(0, 22, 32, 4, 0x333333);
    const hpBar = this.add.rectangle(0, 22, 32, 4, 0x4caf50);
    container.add(hpBg);
    container.add(hpBar);

    this.playerSprites[id] = { container, sprite, arrow, nameTag, hpBg, hpBar, className: p.className };
  }

  updatePlayerVisual(id, p, lp) {
    const spr = this.playerSprites[id];
    if (!spr) return;

    spr.container.setPosition(lp.x, lp.y);
    // Body stays upright — only the arrow/gun rotates with aim
    spr.arrow.setRotation(lp.angle);

    const pct = Math.max(0, p.hp / 100);
    spr.hpBar.setDisplaySize(32 * pct, 4);
    if (pct > 0.5) spr.hpBar.setFillStyle(0x4caf50);
    else if (pct > 0.25) spr.hpBar.setFillStyle(0xffc107);
    else spr.hpBar.setFillStyle(0xf44336);

    spr.container.setAlpha(p.alive ? 1 : 0.12);

    if (p.dashing) {
      spr.sprite.setTexture(`player_${p.className}_dash`);
      this.spawnAfterimage(lp.x, lp.y, 0, p.className);
    } else {
      spr.sprite.setTexture(`player_${p.className}`);
    }

    // Sprint visual — slight bob / speed lines
    if (p.sprinting && p.alive) {
      if (Math.random() < 0.3) {
        const trail = this.add.rectangle(lp.x + (Math.random()-0.5)*8, lp.y + (Math.random()-0.5)*8, 2, 6, 0xffffff, 0.3).setDepth(3);
        this.tweens.add({ targets: trail, alpha: 0, duration: 100, onComplete: () => trail.destroy() });
      }
    }

    // Spawn protection bubble
    if (p.spawnProtection) {
      if (!spr.shieldGfx) { spr.shieldGfx = this.add.graphics(); spr.container.add(spr.shieldGfx); }
      spr.shieldGfx.clear();
      const pulse = 0.3 + Math.sin(Date.now() * 0.01) * 0.15;
      spr.shieldGfx.lineStyle(3, 0x4fc3f7, pulse + 0.3);
      spr.shieldGfx.strokeCircle(0, 0, 24);
      spr.shieldGfx.fillStyle(0x4fc3f7, pulse * 0.3);
      spr.shieldGfx.fillCircle(0, 0, 24);
    } else if (spr.shieldGfx) { spr.shieldGfx.clear(); }

    // Root indicator
    if (p.rooted) {
      if (!spr.rootCircle) { spr.rootCircle = this.add.graphics(); spr.container.add(spr.rootCircle); }
      spr.rootCircle.clear();
      spr.rootCircle.lineStyle(2, 0x1abc9c, 0.8);
      spr.rootCircle.strokeCircle(0, 0, 20);
    } else if (spr.rootCircle) { spr.rootCircle.clear(); }

    // Burn indicator
    if (p.burning) {
      if (!spr.burnGfx) { spr.burnGfx = this.add.graphics(); spr.container.add(spr.burnGfx); }
      spr.burnGfx.clear();
      spr.burnGfx.lineStyle(2, 0xe74c3c, 0.6 + Math.sin(Date.now() * 0.02) * 0.3);
      spr.burnGfx.strokeCircle(0, 0, 18);
    } else if (spr.burnGfx) { spr.burnGfx.clear(); }
  }

  createProjectileSprite(id, proj) {
    const texKey = `proj_${proj.type}`;
    let spr;
    if (this.textures.exists(texKey)) {
      spr = this.add.image(proj.x, proj.y, texKey).setDepth(5);
    } else {
      spr = this.add.circle(proj.x, proj.y, 5, 0xff6f00).setDepth(5);
    }
    this.projectileSprites[id] = spr;
  }

  // ─── EFFECTS ───────────────────────────────────────────

  drawEffect(eff) {
    const gfx = this.add.graphics().setDepth(8);
    const eid = `eff_${Math.random()}`;

    if (eff.type === "thunder_strike") {
      const alpha = eff.triggered ? 0.7 : 0.2 + Math.sin(Date.now() * 0.015) * 0.2;
      gfx.lineStyle(3, 0xa569bd, alpha);
      gfx.strokeCircle(eff.x, eff.y, eff.radius);
      if (eff.triggered) {
        gfx.fillStyle(0xd7bde2, 0.5);
        gfx.fillCircle(eff.x, eff.y, eff.radius);
        // Lightning lines
        gfx.lineStyle(2, 0xffffff, 0.8);
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * eff.radius;
          gfx.lineBetween(eff.x, eff.y, eff.x + Math.cos(a) * r, eff.y + Math.sin(a) * r);
        }
      }
    }

    if (eff.type === "inferno_wave") {
      gfx.fillStyle(0xe74c3c, 0.5);
      gfx.slice(eff.x, eff.y, 120, eff.angle - Math.PI / 3, eff.angle + Math.PI / 3, false);
      gfx.fillPath();
      gfx.fillStyle(0xffab00, 0.3);
      gfx.slice(eff.x, eff.y, 80, eff.angle - Math.PI / 4, eff.angle + Math.PI / 4, false);
      gfx.fillPath();
    }

    if (eff.type === "transmute_field") {
      const color = eff.phase2 ? 0xe74c3c : 0x4caf50;
      const pulse = 0.2 + Math.sin(Date.now() * 0.008) * 0.15;
      gfx.fillStyle(color, pulse);
      gfx.fillCircle(eff.x, eff.y, eff.radius);
      gfx.lineStyle(2, color, 0.6);
      gfx.strokeCircle(eff.x, eff.y, eff.radius);
      // Inner ring
      gfx.lineStyle(1, 0xffffff, 0.2);
      gfx.strokeCircle(eff.x, eff.y, eff.radius * 0.5);
    }

    this.effectSprites[eid] = gfx;
  }

  // ─── HIT / KILL / FLASH EVENTS ────────────────────────

  onHit(data) {
    if (data.targetId === this.myId) {
      this.cameras.main.shake(60, 0.012);
      // Red flash on screen edge
      this.cameras.main.flash(80, 255, 0, 0, false, null, null, 0.15);
    }
    SFX.hit();
    this.spawnParticles(data.x, data.y, 0xff4400, 8);
    // Floating damage number
    this.spawnDmgNumber(data.x, data.y, data.dmg);
  }

  onKill(data) {
    if (data.victimId === this.myId) {
      this.cameras.main.shake(250, 0.02);
      this.cameras.main.flash(300, 255, 0, 0, false, null, null, 0.3);
      SFX.death();
    }
    if (data.killerId === this.myId && data.victimId !== this.myId) {
      SFX.kill();
      // Siphon heal feedback
      this.spawnHealNumber(this.lerpPlayers[this.myId]?.x || 0, this.lerpPlayers[this.myId]?.y || 0);
    }
    const victim = this.lerpPlayers[data.victimId];
    if (victim) {
      this.spawnParticles(victim.x, victim.y, 0xff0000, 16);
      this.spawnParticles(victim.x, victim.y, 0xffaa00, 10);
      this.spawnParticles(victim.x, victim.y, 0xffffff, 6);
    }
    this.killFeed.push({ text: `KILL!`, time: Date.now() });
    if (this.killFeed.length > 5) this.killFeed.shift();
    this.updateKillFeed();
  }

  onSlashEffect(data) {
    const gfx = this.add.graphics().setDepth(15);
    // Multiple arc layers for slash feel
    gfx.fillStyle(0x2ecc71, 0.5);
    gfx.slice(data.x, data.y, data.radius, data.angle - Math.PI / 2, data.angle + Math.PI / 2, false);
    gfx.fillPath();
    gfx.lineStyle(3, 0x82e0aa, 0.9);
    gfx.slice(data.x, data.y, data.radius, data.angle - Math.PI / 2, data.angle + Math.PI / 2, false);
    gfx.strokePath();
    // Inner arc
    gfx.lineStyle(2, 0xffffff, 0.5);
    gfx.slice(data.x, data.y, data.radius * 0.6, data.angle - Math.PI / 3, data.angle + Math.PI / 3, false);
    gfx.strokePath();

    this.spawnParticles(
      data.x + Math.cos(data.angle) * 30,
      data.y + Math.sin(data.angle) * 30,
      0x2ecc71, 5
    );

    this.tweens.add({ targets: gfx, alpha: 0, duration: 150, onComplete: () => gfx.destroy() });
  }

  onMuzzleFlash(data) {
    const color = FLASH_COLORS[data.type] || 0xffffff;
    if (data.shooterId === this.myId) SFX.shoot(data.type);
    const gfx = this.add.graphics().setDepth(12);
    // Bright flash circle
    gfx.fillStyle(0xffffff, 0.8);
    gfx.fillCircle(data.x, data.y, 8);
    gfx.fillStyle(color, 0.5);
    gfx.fillCircle(data.x, data.y, 14);

    this.tweens.add({ targets: gfx, alpha: 0, duration: 80, onComplete: () => gfx.destroy() });

    // Tiny recoil shake if it's us
    if (data.shooterId === this.myId) {
      this.cameras.main.shake(30, 0.003);
    }
  }

  // ─── VISUAL FX ─────────────────────────────────────────

  spawnTrail(x, y, type) {
    const color = TRAIL_COLORS[type] || 0xffffff;
    const size = 2 + Math.random() * 2;
    const trail = this.add.rectangle(x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 6, size, size, color, 0.6).setDepth(4);
    this.tweens.add({
      targets: trail, alpha: 0, scaleX: 0, scaleY: 0,
      duration: 120 + Math.random() * 80,
      onComplete: () => trail.destroy(),
    });
  }

  spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const size = 3 + Math.random() * 3;
      const px = this.add.rectangle(x, y, size, size, color).setDepth(20);
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 140;
      this.tweens.add({
        targets: px,
        x: x + Math.cos(angle) * speed * 0.25,
        y: y + Math.sin(angle) * speed * 0.25,
        alpha: 0, scaleX: 0, scaleY: 0,
        duration: 150 + Math.random() * 120,
        onComplete: () => px.destroy(),
      });
    }
  }

  spawnDmgNumber(x, y, dmg) {
    const txt = this.add.text(x, y - 10, `-${dmg}`, {
      fontSize: "16px", fontFamily: "monospace", fill: "#ff4444",
      stroke: "#000000", strokeThickness: 3, fontStyle: "bold",
    }).setOrigin(0.5).setDepth(50);

    this.tweens.add({
      targets: txt,
      y: y - 50,
      alpha: 0,
      duration: 600,
      ease: "Power2",
      onComplete: () => txt.destroy(),
    });
  }

  spawnAfterimage(x, y, angle, className) {
    const img = this.add.image(x, y, `player_${className}`).setOrigin(0.5).setRotation(angle).setAlpha(0.35).setDepth(3);
    this.tweens.add({
      targets: img, alpha: 0, duration: 180,
      onComplete: () => img.destroy(),
    });
  }

  spawnHealNumber(x, y) {
    const txt = this.add.text(x, y - 10, `+25 HP`, {
      fontSize: "16px", fontFamily: "monospace", fill: "#4caf50",
      stroke: "#000000", strokeThickness: 3, fontStyle: "bold",
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({
      targets: txt, y: y - 50, alpha: 0, duration: 800, ease: "Power2",
      onComplete: () => txt.destroy(),
    });
  }

  showDeathClassPicker() {
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;

    this.deathClassPicker = this.add.container(cx, cy - 60).setScrollFactor(0).setDepth(300);

    const bg = this.add.rectangle(0, 0, 500, 100, 0x000000, 0.85).setStrokeStyle(2, 0xff4444);
    this.deathClassPicker.add(bg);

    const title = this.add.text(0, -35, "CHOOSE CLASS FOR RESPAWN", {
      fontSize: "14px", fontFamily: "monospace", fill: "#ff6666",
    }).setOrigin(0.5);
    this.deathClassPicker.add(title);

    const classes = ["pyromancer", "frostweaver", "stormcaller", "hexblade", "alchemist"];
    const colors = { pyromancer: "#e74c3c", frostweaver: "#5dade2", stormcaller: "#a569bd", hexblade: "#2ecc71", alchemist: "#a8e84e" };
    const startX = -200;
    classes.forEach((cls, i) => {
      const bx = startX + i * 100;
      const btnBg = this.add.rectangle(bx, 10, 90, 36, 0x1a1a2e).setStrokeStyle(2, cls === this.myClass ? 0xffd54f : 0x555555).setInteractive({ useHandCursor: true });
      const label = this.add.text(bx, 10, cls.slice(0, 6).toUpperCase(), {
        fontSize: "10px", fontFamily: "monospace", fill: colors[cls],
      }).setOrigin(0.5);

      btnBg.on("pointerdown", () => {
        this.myClass = cls;
        this.socket.emit("changeClassDead", { className: cls });
        // Update selection highlight
        this.deathClassPicker.each(child => {
          if (child.type === "Rectangle" && child !== bg) {
            child.setStrokeStyle(2, 0x555555);
          }
        });
        btnBg.setStrokeStyle(2, 0xffd54f);
      });

      this.deathClassPicker.add(btnBg);
      this.deathClassPicker.add(label);
    });
  }

  hideDeathClassPicker() {
    if (this.deathClassPicker) {
      this.deathClassPicker.destroy();
      this.deathClassPicker = null;
    }
  }

  // ─── MATCH OVER ──────────────────────────────────

  onMatchOver(data) {
    this.matchEnded = true;
    this.holdingFire = false;
    this.hideDeathClassPicker();

    if (data.winnerId === this.myId) SFX.victory();
    else SFX.defeat();

    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;

    const overlay = this.add.container(cx, cy).setScrollFactor(0).setDepth(500);
    const bg = this.add.rectangle(0, 0, 520, 380, 0x000000, 0.9).setStrokeStyle(3, 0xffd54f);
    overlay.add(bg);

    const iWon = data.winnerId === this.myId;
    const title = this.add.text(0, -150, iWon ? "VICTORY!" : `${data.winnerName} WINS!`, {
      fontSize: "36px", fontFamily: "monospace", fill: iWon ? "#ffd54f" : "#ff6666",
      stroke: "#000000", strokeThickness: 5,
    }).setOrigin(0.5);
    overlay.add(title);

    // Scoreboard
    const header = this.add.text(0, -100, "NAME            CLASS        K   D", {
      fontSize: "14px", fontFamily: "monospace", fill: "#aaaaaa",
    }).setOrigin(0.5, 0);
    overlay.add(header);

    const lines = data.scores.map((s, i) => {
      const marker = s.id === this.myId ? "> " : "  ";
      return `${marker}${s.name.padEnd(14)}${s.className.padEnd(13)}${String(s.kills).padStart(2)}  ${String(s.deaths).padStart(2)}`;
    }).join("\n");
    const board = this.add.text(0, -75, lines, {
      fontSize: "14px", fontFamily: "monospace", fill: "#ffffff", lineSpacing: 6,
    }).setOrigin(0.5, 0);
    overlay.add(board);

    // Rematch button (any player can press it, same as lobby start)
    const btnBg = this.add.rectangle(0, 130, 220, 46, 0x1a1a2e).setStrokeStyle(2, 0x4caf50).setInteractive({ useHandCursor: true });
    const btnLabel = this.add.text(0, 130, "[ REMATCH ]", {
      fontSize: "20px", fontFamily: "monospace", fill: "#4caf50",
    }).setOrigin(0.5);
    btnBg.on("pointerover", () => btnBg.setFillStyle(0x2a2a3e));
    btnBg.on("pointerout", () => btnBg.setFillStyle(0x1a1a2e));
    btnBg.on("pointerdown", () => {
      btnLabel.setText("WAITING...");
      this.socket.emit("startGame");
    });
    overlay.add(btnBg);
    overlay.add(btnLabel);

    this.matchOverOverlay = overlay;
  }

  updateKillFeed() {
    const now = Date.now();
    this.killFeed = this.killFeed.filter(k => now - k.time < 4000);
    this.killFeedText.setText(this.killFeed.map(k => k.text).join("\n"));
  }

  // ─── GAME LOOP ─────────────────────────────────────────

  update(time, delta) {
    if (!this.socket) return;
    if (this.matchEnded) return;

    // ── Interpolate remote players ──
    const lerpFactor = 0.3;
    for (const [id, lp] of Object.entries(this.lerpPlayers)) {
      if (id === this.myId) continue;
      lp.x += (lp.tx - lp.x) * lerpFactor;
      lp.y += (lp.ty - lp.y) * lerpFactor;
      let da = lp.tAngle - lp.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      lp.angle += da * lerpFactor;
    }

    // ── Input ──
    let dx = 0, dy = 0;
    if (this.keys.w.isDown) dy = -1;
    if (this.keys.s.isDown) dy = 1;
    if (this.keys.a.isDown) dx = -1;
    if (this.keys.d.isDown) dx = 1;

    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const me = this.lerpPlayers[this.myId];
    const angle = me ? Math.atan2(worldPoint.y - me.y, worldPoint.x - me.x) : 0;

    const sprint = this.keys.shift.isDown;
    this.socket.emit("input", { dx, dy, angle, sprint });

    // Auto-fire: shoot continuously while holding left click
    if (this.holdingFire) {
      this.socket.emit("shoot", { angle });
      this.lastShootTime = Date.now();
    }

    // Dash
    if (this.keys.space.isDown && !this.spaceJustPressed) {
      this.socket.emit("dash");
      this.lastDashTime = Date.now();
      this.spaceJustPressed = true;
      SFX.dash();
    }
    if (this.keys.space.isUp) this.spaceJustPressed = false;

    // Mute toggle
    if (Phaser.Input.Keyboard.JustDown(this.keys.m)) {
      const muted = SFX.toggleMute();
      this.muteText.setText(muted ? "MUTED (M)" : "");
    }

    // Tab scoreboard
    this.scoreboardBg.setVisible(this.keys.tab.isDown);
    this.scoreboardText.setVisible(this.keys.tab.isDown);

    // ── Cooldown bars ──
    const now = Date.now();
    const cds = this.classCooldowns[this.myClass] || { basic: 200, special: 4000, dash: 800 };
    const barW = 140;
    const basicPct = Math.min(1, (now - this.lastShootTime) / cds.basic);
    const specPct = Math.min(1, (now - this.lastSpecialTime) / cds.special);
    const dashPct = Math.min(1, (now - this.lastDashTime) / cds.dash);
    this.cdBarFill.setDisplaySize(barW * basicPct, 6);
    this.cdSpecFill.setDisplaySize(barW * specPct, 6);
    this.cdDashFill.setDisplaySize(barW * dashPct, 6);

    this.updateKillFeed();
  }
}
