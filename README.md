# NEON STRIKE 3D

A fast, neon-styled 3D first-person shooter that runs entirely in your browser.
Play **offline** against AI bots, or **host / join peer-to-peer online matches** with friends — no game server required.

![Mode](https://img.shields.io/badge/modes-offline_%2B_online_P2P-00f0ff) ![Engine](https://img.shields.io/badge/engine-Three.js-8b5cf6) ![Deploy](https://img.shields.io/badge/deploy-Cloudflare_Pages-ff2bd6)

## Features

- **3D neon arena** — 80×80 symmetric map with cover walls, crates, pillars and a central platform, rendered with Three.js
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

Match rules: 5-minute deathmatch, first to 25 kills wins. Headshots deal double damage. Health regenerates after 5 s out of combat.

## Run locally

```bash
bun install        # or npm install
bun run dev        # http://localhost:3000
```

## Deploy to Cloudflare Pages

### Option A — single file (fastest)

Build one self-contained HTML file and drag-drop it:

```bash
npm run build:standalone     # -> dist/neon-strike.html
```

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. Drag `dist/neon-strike.html` in, deploy — done.

### Option B — full static site from this repo

```bash
npm run build:static         # -> out/  (fully static Next.js export)
```

- **Upload assets**: drag the `out/` folder to Cloudflare Pages, or
- **Git integration**: connect this repo on Cloudflare Pages with
  - Build command: `npm run build:static`
  - Build output directory: `out`

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
  net.ts          # PeerJS host/client
  main.ts         # orchestrator (offline / host / client)
  standalone.ts   # single-file build entry
scripts/
  build-standalone.mjs  # esbuild -> dist/neon-strike.html
```

## Notes

- Online mode uses PeerJS's free public signaling + Google STUN; the game data itself flows peer-to-peer. The host acts as the authority — keep the host tab open until the match ends.
- Mobile is not supported (keyboard + mouse required).
