# NEON STRIKE 3D

A fast, neon-styled 3D first-person shooter that runs entirely in your browser.
Play **offline** against AI bots, or **host / join peer-to-peer online matches** with friends — no game server required.

![Mode](https://img.shields.io/badge/modes-offline_%2B_online_P2P-00f0ff) ![Engine](https://img.shields.io/badge/engine-Three.js-8b5cf6) ![Deploy](https://img.shields.io/badge/deploy-Cloudflare_Pages-ff2bd6)

## Features

- **3D neon arena** — 80×80 symmetric map with cover walls, crates, pillars and a central platform, rendered with Three.js
- **Mobile-ready touch controls** — dynamic left joystick, drag-to-aim, FIRE / JUMP / RELOAD buttons, tap-to-shoot, auto fullscreen & landscape prompt (works on Android & iOS, phones and tablets)
- **Offline deathmatch** — 3 / 5 / 8 AI bots with patrol → hunt → combat behavior, three difficulty levels
- **Online P2P multiplayer** — create a match, share the 5-letter room code, friends join straight from their browser (WebRTC via PeerJS, host-authoritative netcode, 12 Hz snapshots with interpolation)
- **Full FPS kit** — hitscan rifle with recoil, spread, reload, headshots (2× damage), health regeneration, respawn system
- **Game feel** — procedural WebAudio SFX (no audio files), muzzle flashes, tracers, impact sparks, hitmarkers, kill feed, scoreboard (TAB)
- **Zero backend** — every mode works from static files; perfect for Cloudflare Pages, GitHub Pages, Netlify or itch.io

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| `SHIFT` | Sprint |
| `SPACE` | Jump |
| Mouse | Aim |
| Left click (hold) | Shoot |
| `R` | Reload |
| `TAB` | Scoreboard |
| `ESC` | Pause / release mouse |

### Mobile (touch)

Touch controls turn on automatically on phones/tablets (you can force them with `?touch=1` in the URL, or switch Auto/On/Off in the pause menu).

| Touch input | Action |
|---|---|
| Left-side stick (appears where your thumb lands) | Move — push fully forward to sprint |
| Drag on the right side | Aim |
| **FIRE** button (hold) | Shoot (auto) |
| Quick tap on the right side | Single shot |
| **JUMP** / **RLD** buttons | Jump / Reload |
| **II** button | Pause |
| **LIST** button | Scoreboard |

Holding the phone in landscape is recommended — the game asks to rotate if held in portrait and pauses the match on rotation. On Android the game also requests fullscreen + landscape lock when a match starts. Mobile devices get a lighter render preset (pixel-ratio cap, antialiasing off) for smooth framerates.

Match rules: 5-minute deathmatch, first to 25 kills wins. Headshots deal double damage. Health regenerates after 5 s out of combat.

## Run locally

```bash
bun install        # or npm install
bun run dev        # http://localhost:3000
```

## Deploy to Cloudflare Pages

The repo ships a **prebuilt, self-contained** `dist/index.html` (the entire game in one file, already committed). You do **not** need any build step on Cloudflare — this is the most reliable setup and avoids all npm/Next.js build errors.

### Option A — Git integration (auto-deploys on every push)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → select this repo
2. In **Build settings** enter exactly:
   - Framework preset: **None**
   - Build command: **(leave empty)**
   - Build output directory: **`dist`**
3. **Save and Deploy** — done. Every future `git push` redeploys automatically.

> ⚠️ Do **not** pick the "Next.js" framework preset. The Next.js part of this repo is only a dev host — `@cloudflare/next-on-pages` does not support Next 16, and there is no `package-lock.json` (only `bun.lock`), so any npm-based build will fail. The deployable game is the static `dist/` folder.

### Option B — Drag & drop (no Git at all)

1. **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. Drag `dist/index.html` in and deploy — done.

### Rebuilding `dist/` after changing game code

```bash
npm install            # or bun install
npm run build:standalone   # -> dist/index.html + dist/neon-strike.html
```

Then commit the updated `dist/` files (or drag-drop them).

## Tech stack

- [Three.js](https://threejs.org) — rendering, physics helpers, raycasting
- [PeerJS](https://peerjs.com) — WebRTC data channels for P2P multiplayer
- Vanilla TypeScript game modules (framework-agnostic; the Next.js page is just a thin host)
- Next.js 16 + App Router — dev/preview host and static export
- WebAudio API — all sounds synthesized at runtime

## Project structure

```
src/game/
  constants.ts    # tuning, protocol, difficulty presets
  audio.ts        # procedural SFX engine
  world.ts        # scene, neon arena, collision, raycasts
  effects.ts      # tracers, sparks, muzzle flash
  viewmodel.ts    # first-person rifle + recoil/sway
  player.ts       # local controls, physics, shooting
  bot.ts          # bot AI (patrol / hunt / combat)
  remote.ts       # remote entity interpolation
  avatar.ts       # character mesh factory
  hud.ts          # injected CSS
  hudbar.ts       # HUD DOM overlay
  menus.ts        # menu system
  touch.ts        # mobile touch controls (joystick, aim, buttons)
  net.ts          # PeerJS host/client
  main.ts         # orchestrator (offline / host / client)
  standalone.ts   # single-file build entry
scripts/
  build-standalone.mjs  # esbuild -> dist/neon-strike.html
```

## Notes

- Online mode uses PeerJS's free public signaling + Google STUN; the game data itself flows peer-to-peer. The host acts as the authority — keep the host tab open until the match ends.
- Mobile browsers are fully supported for both offline and online play (WebRTC data channels work on modern Android Chrome and iOS Safari).
