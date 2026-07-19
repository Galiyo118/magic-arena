# ⚔️ Magic Arena — 2D Top-Down Multiplayer PvP

A browser-based magic PvP arena built with **Phaser 3** + **Colyseus**.

## Quick Start

```bash
cd server
npm install
npm start
```

Then open **two browser tabs** to `http://localhost:3000` and start fighting!

## Controls

| Key         | Action                  |
|-------------|-------------------------|
| W/A/S/D     | Move                    |
| Mouse       | Aim                     |
| Left Click  | Shoot firebolt          |
| Space       | Dash (1.5s cooldown)    |

## Project Structure

```
magic-arena/
├── server/
│   ├── index.js     ← Colyseus server + Express static file server
│   ├── room.js      ← All game logic: physics, combat, map, collisions
│   └── package.json
└── client/
    ├── index.html   ← Loads Phaser + Colyseus from CDN
    ├── main.js      ← Phaser config
    └── scene.js     ← Rendering, input, server sync
```

## Architecture

- **Server-authoritative**: The server runs the game loop at 60fps, handles all collision/damage
- **Client is a dumb terminal**: Sends input (WASD + mouse angle), renders whatever the server says
- **No prediction/interpolation**: Kept simple on purpose for MVP

## Game Settings (edit in `server/room.js`)

| Setting            | Value   |
|--------------------|---------|
| Player speed       | 200 px/s |
| Dash speed         | 600 px/s |
| Dash cooldown      | 1.5s    |
| Projectile speed   | 500 px/s |
| Projectile damage  | 20 HP   |
| Shoot cooldown     | 300ms   |
| Player HP          | 100     |
| Respawn time       | 2s      |

## Map

Edit the `MAP` array in `room.js` to change the arena layout:
- `#` = wall (collidable)
- `.` = floor
