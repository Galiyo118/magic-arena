// ─── MENU / LOBBY SCENE ──────────────────────────────────────

class MenuScene extends Phaser.Scene {
  constructor() {
    super("MenuScene");
  }

  create() {
    this.socket = io({
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      timeout: 10000,
      upgrade: true,
    });
    this.selectedClass = "pyromancer";
    this.inLobby = false;
    this.roomCode = null;

    // Connection status
    this.socket.on("connect", () => {
      console.log("Socket connected:", this.socket.id);
      if (this.connStatus) this.connStatus.setText("CONNECTED").setColor("#4caf50");
    });
    this.socket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", reason);
      if (this.connStatus) this.connStatus.setText("DISCONNECTED - reconnecting...").setColor("#f44336");
    });
    this.socket.on("connect_error", (err) => {
      console.log("Connection error:", err.message);
      if (this.connStatus) this.connStatus.setText("CONNECTION ERROR").setColor("#f44336");
    });

    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;

    // ─── TITLE ───────────────────────────────────────────
    this.add.text(cx, 60, "MAGIC ARENA", {
      fontSize: "48px", fontFamily: "monospace", fill: "#ffd54f",
      stroke: "#000000", strokeThickness: 6,
    }).setOrigin(0.5);

    this.add.text(cx, 105, "A top-down wizarding duel", {
      fontSize: "14px", fontFamily: "monospace", fill: "#aaaaaa",
    }).setOrigin(0.5);

    // ─── NAME INPUT ──────────────────────────────────────
    this.add.text(cx - 140, 145, "NAME:", {
      fontSize: "16px", fontFamily: "monospace", fill: "#ffffff",
    });

    this.playerName = "Wizard";
    this.nameText = this.add.text(cx - 70, 145, this.playerName + "_", {
      fontSize: "16px", fontFamily: "monospace", fill: "#ffd54f",
      backgroundColor: "#1a1a2e", padding: { x: 8, y: 4 },
    });

    this.input.keyboard.on("keydown", (e) => {
      if (this.inLobby) return;
      if (e.key === "Backspace") {
        this.playerName = this.playerName.slice(0, -1);
      } else if (e.key.length === 1 && this.playerName.length < 12) {
        this.playerName += e.key;
      }
      this.nameText.setText(this.playerName + "_");
    });

    // ─── CLASS SELECTION ─────────────────────────────────
    this.add.text(cx, 195, "SELECT CLASS", {
      fontSize: "18px", fontFamily: "monospace", fill: "#ffffff",
    }).setOrigin(0.5);

    const classes = ["pyromancer", "frostweaver", "stormcaller", "hexblade", "alchemist"];
    const classColors = { pyromancer: "#e74c3c", frostweaver: "#5dade2", stormcaller: "#a569bd", hexblade: "#2ecc71", alchemist: "#a8e84e" };
    const classDesc = {
      pyromancer: "Fireball + Inferno Wave",
      frostweaver: "Ice Shard + Ice Wall",
      stormcaller: "Chain Bolt + Thunder Strike",
      hexblade: "Melee Slash + Shadow Bind",
      alchemist: "Acid Flask + Transmute Field",
    };

    this.classButtons = [];
    const btnWidth = 110;
    const totalBtnsW = classes.length * btnWidth;
    const startX = cx - totalBtnsW / 2 + btnWidth / 2;
    classes.forEach((cls, i) => {
      const bx = startX + i * btnWidth;
      const by = 235;

      const bg = this.add.rectangle(bx, by, 100, 50, 0x1a1a2e).setStrokeStyle(2, 0x555555).setInteractive({ useHandCursor: true });
      const label = this.add.text(bx, by - 8, cls.slice(0, 6).toUpperCase(), {
        fontSize: "11px", fontFamily: "monospace", fill: classColors[cls],
      }).setOrigin(0.5);
      const desc = this.add.text(bx, by + 10, cls.slice(0, 5), {
        fontSize: "9px", fontFamily: "monospace", fill: "#888888",
      }).setOrigin(0.5);

      bg.on("pointerdown", () => {
        this.selectedClass = cls;
        this.updateClassSelection();
        if (this.inLobby) this.socket.emit("changeClass", { className: cls });
      });

      this.classButtons.push({ bg, label, cls });
    });

    this.classDescText = this.add.text(cx, 275, classDesc["pyromancer"], {
      fontSize: "12px", fontFamily: "monospace", fill: "#aaaaaa",
    }).setOrigin(0.5);

    this.classDescMap = classDesc;
    this.updateClassSelection();

    // ─── BUTTONS ─────────────────────────────────────────
    // Create Room
    this.createBtn = this.makeButton(cx - 90, 320, "CREATE ROOM", () => {
      const name = this.playerName || "Wizard";
      this.socket.emit("createRoom", { name, className: this.selectedClass }, (res) => {
        if (res.code) this.enterLobby(res.code);
      });
    });

    // Join Room
    this.joinBtn = this.makeButton(cx + 90, 320, "JOIN ROOM", () => {
      this.showJoinInput();
    });

    // ─── JOIN CODE INPUT (hidden initially) ──────────────
    this.joinGroup = this.add.container(cx, 370).setVisible(false);
    const joinBg = this.add.rectangle(0, 0, 250, 40, 0x1a1a2e).setStrokeStyle(2, 0x4fc3f7);
    this.joinCodeText = this.add.text(-80, -8, "CODE: _", {
      fontSize: "16px", fontFamily: "monospace", fill: "#4fc3f7",
    });
    const goBtn = this.add.text(60, -8, "[JOIN]", {
      fontSize: "16px", fontFamily: "monospace", fill: "#4caf50",
    }).setInteractive({ useHandCursor: true });
    goBtn.on("pointerdown", () => this.submitJoinCode());
    this.joinGroup.add([joinBg, this.joinCodeText, goBtn]);

    this.joinCode = "";
    this.joiningMode = false;

    // ─── LOBBY PANEL (hidden) ────────────────────────────
    this.lobbyGroup = this.add.container(cx, cy + 40).setVisible(false);
    const lobbyBg = this.add.rectangle(0, 0, 380, 220, 0x111122, 0.95).setStrokeStyle(2, 0x4fc3f7);
    this.lobbyTitle = this.add.text(0, -95, "ROOM: ----", {
      fontSize: "22px", fontFamily: "monospace", fill: "#ffd54f",
    }).setOrigin(0.5);
    this.lobbyPlayers = this.add.text(0, -50, "", {
      fontSize: "14px", fontFamily: "monospace", fill: "#ffffff", lineSpacing: 8,
    }).setOrigin(0.5, 0);
    const startBg = this.add.rectangle(0, 85, 220, 44, 0x1a1a2e).setStrokeStyle(2, 0x4caf50).setInteractive({ useHandCursor: true });
    this.startBtnLabel = this.add.text(0, 85, "[ START GAME ]", {
      fontSize: "20px", fontFamily: "monospace", fill: "#4caf50",
    }).setOrigin(0.5);
    startBg.on("pointerover", () => startBg.setFillStyle(0x2a2a3e));
    startBg.on("pointerout", () => startBg.setFillStyle(0x1a1a2e));
    startBg.on("pointerdown", () => {
      this.socket.emit("startGame");
    });
    this.startBtn = startBg;
    this.lobbyGroup.add([lobbyBg, this.lobbyTitle, this.lobbyPlayers, startBg, this.startBtnLabel]);

    // ─── ERROR TEXT ──────────────────────────────────────
    this.errorText = this.add.text(cx, 410, "", {
      fontSize: "14px", fontFamily: "monospace", fill: "#f44336",
    }).setOrigin(0.5);

    // Connection status indicator
    this.connStatus = this.add.text(10, this.cameras.main.height - 15, "CONNECTING...", {
      fontSize: "10px", fontFamily: "monospace", fill: "#ffaa00",
    });

    // ─── SOCKET EVENTS ──────────────────────────────────
    this.socket.on("lobbyUpdate", (data) => {
      this.updateLobby(data);
    });

    this.socket.on("gameStart", (data) => {
      this.scene.start("GameScene", {
        socket: this.socket,
        map: data.map,
        mapName: data.mapName,
        tileSize: data.tileSize,
        killLimit: data.killLimit,
        myId: data.myId,
        players: data.players,
        className: this.selectedClass,
      });
    });

    // Controls hint
    this.add.text(cx, this.cameras.main.height - 30, "WASD move | Click shoot | Right-click special | Space dash | Shift sprint", {
      fontSize: "11px", fontFamily: "monospace", fill: "#555555",
    }).setOrigin(0.5);
  }

  makeButton(x, y, text, cb) {
    // Use a rectangle background + text for reliable click detection
    const bg = this.add.rectangle(x, y, text.length * 12 + 32, 40, 0x2c3e6d)
      .setInteractive({ useHandCursor: true });
    const label = this.add.text(x, y, text, {
      fontSize: "16px", fontFamily: "monospace", fill: "#ffffff",
    }).setOrigin(0.5);

    bg.on("pointerover", () => bg.setFillStyle(0x3d5a9e));
    bg.on("pointerout", () => bg.setFillStyle(0x2c3e6d));
    bg.on("pointerdown", cb);

    // Group them so we can hide/show both
    const container = this.add.container(0, 0, [bg, label]);
    container.setVisible = (v) => { bg.setVisible(v); label.setVisible(v); return container; };
    return container;
  }

  updateClassSelection() {
    this.classButtons.forEach(b => {
      if (b.cls === this.selectedClass) {
        b.bg.setStrokeStyle(3, 0xffd54f);
      } else {
        b.bg.setStrokeStyle(2, 0x555555);
      }
    });
    this.classDescText.setText(this.classDescMap[this.selectedClass] || "");
  }

  showJoinInput() {
    this.joiningMode = true;
    this.joinCode = "";
    this.joinGroup.setVisible(true);
    this.joinCodeText.setText("CODE: _");

    // Capture keyboard for code entry
    this.input.keyboard.off("keydown");
    this.input.keyboard.on("keydown", (e) => {
      if (e.key === "Enter") { this.submitJoinCode(); return; }
      if (e.key === "Backspace") { this.joinCode = this.joinCode.slice(0, -1); }
      else if (e.key.length === 1 && this.joinCode.length < 4) {
        this.joinCode += e.key.toUpperCase();
      }
      this.joinCodeText.setText("CODE: " + this.joinCode + "_");
    });
  }

  submitJoinCode() {
    if (this.joinCode.length < 4) return;
    const name = this.playerName || "Wizard";
    this.socket.emit("joinRoom", { code: this.joinCode, name, className: this.selectedClass }, (res) => {
      if (res.error) {
        this.errorText.setText(res.error);
        return;
      }
      this.enterLobby(res.code);
    });
  }

  enterLobby(code) {
    this.inLobby = true;
    this.roomCode = code;
    this.createBtn.setVisible(false);
    this.joinBtn.setVisible(false);
    this.joinGroup.setVisible(false);
    this.lobbyGroup.setVisible(true);
    this.lobbyTitle.setText("ROOM: " + code);
    this.errorText.setText("");

    // Re-enable keyboard for name (disabled)
    this.input.keyboard.off("keydown");
  }

  updateLobby(data) {
    const lines = data.players.map(p => {
      const cls = p.className.toUpperCase().padEnd(12);
      return `${p.name.padEnd(14)} ${cls}`;
    }).join("\n");
    this.lobbyPlayers.setText(lines);
  }
}
