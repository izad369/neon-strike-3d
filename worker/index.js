// DESERT STRIKE 3D — Discord Interactions endpoint on Cloudflare Workers edge.
// This runs 24/7 for FREE (serverless): no process to keep awake, no cron needed.
// Slash commands (/ping /help /apk /ask) are answered straight from the edge.
//
// The full Node bot (scripts/discord-bot.mjs, Gateway + channel watching + LLM)
// keeps running on the dev node while it is alive; this Worker guarantees the
// commands NEVER die when the dev node sleeps.
//
// Routes:
//   GET  /bot/health   -> 200 {ok:true}
//   POST /bot/discord  -> Discord interactions endpoint (Ed25519 verified)
//   /signal/<code>/*   -> WebRTC signaling mailbox (SignalRoom Durable Object)
//   anything else      -> static assets (dist/), SPA fallback

// ---- P2P signaling mailbox (one Durable Object per room code) -------------
// Joiner flow:  POST /signal/<code>/join        -> {ok:true,id}
//               POST /signal/<code>/offer       -> {id, sdp}
//               GET  /signal/<code>/answer?id=  -> polls for the host answer
// Host flow:    POST /signal/<code>/host        -> claims the room
//               GET  /signal/<code>/offers      -> polls for joiner offers
//               POST /signal/<code>/answer      -> {id, sdp}
// Plain HTTPS only — reachable anywhere the game page itself is reachable.
export class SignalRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.roomCode = '';
    this.iph = '';
    this.lastAnnounce = 0;
    // v3.12 — WebSocket media relay state (in-memory only, lives with the DO)
    this.socks = null;   // Set<WebSocket>
    this.tags = null;    // Map<WebSocket, tag>   ('H' = host, 'Jxxxx' = joiner)
    this.byTag = null;   // Map<tag, WebSocket>  (latest socket wins on reconnect)
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);
    const now = Date.now();
    // v3.10 — the edge worker forwards the room code + hashed public IP of the
    // caller so this room can feed the same-WiFi discovery directory.
    this.roomCode = request.headers.get('x-ns3d-code') || this.roomCode;
    this.iph = request.headers.get('x-ns3d-iph') || this.iph;
    await this.sweep(now);

    // v3.9.1 — 90s was too tight: a background-throttled host tab (Chrome
    // intensive throttling = 1 timer/min) or a phone with the screen off let
    // the heartbeat go stale, so joiners got "Match not found" even though
    // the host lobby was alive. 4 min tolerates a couple of missed polls.
    const HOST_TTL = 240000;

    if (action === 'host') {
      const host = await this.ctx.storage.get('host');
      if (typeof host === 'number' && now - host < HOST_TTL) {
        return Response.json({ ok: false, taken: true });
      }
      // fresh room: wipe whatever is left from the previous occupant
      const old = [];
      for (const k of (await this.ctx.storage.list()).keys()) old.push(k);
      if (old.length) await this.ctx.storage.delete(old);
      await this.ctx.storage.put('host', now);
      return Response.json({ ok: true });
    }

    const host = await this.ctx.storage.get('host');
    const hostActive = typeof host === 'number' && now - host < HOST_TTL;

    if (action === 'heartbeat') {
      // lightweight host keep-alive — refresh the claim without a full re-claim
      if (!hostActive) return Response.json({ ok: false, reason: 'no-room' });
      await this.ctx.storage.put('host', now);
      return Response.json({ ok: true });
    }

    if (action === 'status') {
      // diagnostics only — timing + counters, no payloads
      let joiners = 0;
      for (const [, v] of await this.ctx.storage.list({ prefix: 'joiner:' })) {
        if (typeof v === 'number' && now - v < 300000) joiners++;
      }
      let relayJoiners = 0;
      if (this.byTag) for (const t of this.byTag.keys()) if (t !== 'H') relayJoiners++;
      return Response.json({ ok: true, hostActive, hostAgeMs: typeof host === 'number' ? now - host : null, joiners, relayJoiners, now });
    }

    // v3.12 — WebSocket media relay: when raw WebRTC dies (UDP-restricted
    // networks, dead public TURN), both peers ride this instead. The game's
    // own worker is the one origin BOTH sides provably reach.
    if (action === 'relay') {
      const up = (request.headers.get('upgrade') || '').toLowerCase();
      if (up !== 'websocket') return Response.json({ ok: false, reason: 'need-ws' }, { status: 426 });
      if (!this.socks) { this.socks = new Set(); this.tags = new Map(); this.byTag = new Map(); }
      if (this.socks.size >= 17) return Response.json({ ok: false, reason: 'room-full' }, { status: 429 });
      const pair = new WebSocketPair();
      const server = pair[1];
      server.accept();
      this.socks.add(server);
      server.addEventListener('message', (ev) => {
        try { this.relayMsg(server, String(ev.data || '')); } catch { /* never kill the socket over one bad frame */ }
      });
      const bye = () => { try { this.relayBye(server); } catch { /* */ } };
      server.addEventListener('close', bye);
      server.addEventListener('error', bye);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (action === 'join') {
      if (!hostActive) return Response.json({ ok: false, reason: 'no-room' });
      const id = 'J' + Math.random().toString(36).slice(2, 8);
      await this.ctx.storage.put('joiner:' + id, now);
      return Response.json({ ok: true, id });
    }

    if (action === 'offer' && request.method === 'POST') {
      const b = await request.json().catch(() => null);
      if (!b || !b.id || !b.sdp) return Response.json({ ok: false }, { status: 400 });
      if (!hostActive) return Response.json({ ok: false, reason: 'no-room' });
      const seq = ((await this.ctx.storage.get('seq')) || 0) + 1;
      await this.ctx.storage.put('seq', seq);
      await this.ctx.storage.put('o:' + seq, { id: String(b.id), sdp: String(b.sdp).slice(0, 20000), ts: now });
      return Response.json({ ok: true });
    }

    if (action === 'offers' && request.method === 'GET') {
      await this.ctx.storage.put('host', now); // polling = host heartbeat
      await this.announceNearby(now); // v3.10 — keep the same-WiFi directory fresh
      const after = Number(url.searchParams.get('after') || 0) || 0;
      const offers = [];
      for (const [k, v] of await this.ctx.storage.list({ prefix: 'o:' })) {
        if (!v || typeof v !== 'object') continue;
        const seq = Number(k.slice(2));
        if (seq > after && now - v.ts < 300000) offers.push({ seq, id: v.id, sdp: v.sdp });
      }
      offers.sort((a, b) => a.seq - b.seq);
      return Response.json({ ok: true, offers });
    }

    if (action === 'answer') {
      if (request.method === 'POST') {
        const b = await request.json().catch(() => null);
        if (!b || !b.id || !b.sdp) return Response.json({ ok: false }, { status: 400 });
        await this.ctx.storage.put('a:' + b.id, { sdp: String(b.sdp).slice(0, 20000), ts: now });
        return Response.json({ ok: true });
      }
      const id = url.searchParams.get('id') || '';
      const a = await this.ctx.storage.get('a:' + id);
      if (a && typeof a === 'object' && now - a.ts < 300000) {
        return Response.json({ ok: true, sdp: a.sdp });
      }
      return Response.json({ ok: false, waiting: hostActive });
    }

    return Response.json({ ok: false, reason: 'bad-action' }, { status: 404 });
  }

  // v3.12 — relay plumbing. First frame must be a hello; joiner frames always
  // go to the host; host frames go to one joiner (to:<id>) or all (*).
  relayMsg(server, raw) {
    if (raw.length > 16000) return;
    if (!this.tags) { this.tags = new Map(); this.byTag = new Map(); }
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const tag = this.tags.get(server);
    if (!tag) {
      if (m.t !== 'hi') { try { server.send('{"t":"denied"}'); server.close(1008, 'hello first'); } catch { /* */ } return; }
      let t = null;
      if (m.role === 'h') t = 'H';
      else if (m.role === 'j') {
        const id = String(m.id || '');
        if (/^J[A-Za-z0-9]{1,11}$/.test(id)) t = id;
      }
      if (!t) { try { server.send('{"t":"denied"}'); server.close(1008, 'bad hello'); } catch { /* */ } return; }
      const prev = this.byTag.get(t);
      if (prev && prev !== server) { // reconnect — the newest socket wins
        try { prev.close(4000, 'replaced'); } catch { /* */ }
        this.socks.delete(prev);
        this.tags.delete(prev);
      }
      this.tags.set(server, t);
      this.byTag.set(t, server);
      try { server.send('{"t":"ok"}'); } catch { /* */ }
      return;
    }
    if (m.t === 'ping') { try { server.send('{"t":"pong"}'); } catch { /* */ } return; }
    if (m.t !== 'm' || !m.d || typeof m.d !== 'object') return;
    const frame = JSON.stringify({ t: 'm', f: tag, d: m.d });
    if (tag === 'H') {
      const to = typeof m.to === 'string' && m.to !== '*' ? m.to : '';
      if (to) {
        const s = this.byTag.get(to);
        if (s) { try { s.send(frame); } catch { /* */ } }
      } else {
        for (const [t2, s] of this.byTag) {
          if (t2 !== 'H') { try { s.send(frame); } catch { /* */ } }
        }
      }
    } else {
      const s = this.byTag.get('H');
      if (s) { try { s.send(frame); } catch { /* */ } }
    }
  }

  relayBye(server) {
    if (!this.tags) return;
    const tag = this.tags.get(server);
    this.tags.delete(server);
    if (this.socks) this.socks.delete(server);
    if (tag && this.byTag.get(tag) === server) this.byTag.delete(tag);
    if (!tag) return;
    const note = JSON.stringify({ t: 'bye', f: tag });
    if (this.socks) for (const s of this.socks) { try { s.send(note); } catch { /* */ } }
  }

  // v3.10 — same-WiFi auto-discovery: every ~5 s the live host reports
  // (room code, player count) to the global Directory DO, tagged with the
  // salted hash of its public IP. Joiners querying /signal/nearby from the
  // SAME public IP (same router / same mobile line) then see the room listed
  // with zero setup. Best-effort: any directory failure is swallowed.
  async announceNearby(now) {
    if (!this.env || !this.env.DIRECTORY || !this.roomCode || !this.iph) return;
    if (now - this.lastAnnounce < 5000) return;
    this.lastAnnounce = now;
    try {
      let players = 1;
      for (const [, v] of await this.ctx.storage.list({ prefix: 'joiner:' })) {
        if (typeof v === 'number' && now - v < 300000) players++;
      }
      const dir = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('global'));
      await dir.fetch('https://dir/announce?ip=' + encodeURIComponent(this.iph) +
        '&code=' + encodeURIComponent(this.roomCode) + '&players=' + players);
    } catch { /* directory is optional */ }
  }

  async sweep(now) {
    for (const [k, v] of await this.ctx.storage.list()) {
      if (k === 'seq') continue; // plain counter, not a timestamp
      const ts = (v && typeof v === 'object') ? v.ts : v;
      if (typeof ts === 'number' && now - ts > 600000) await this.ctx.storage.delete(k);
    }
  }
}

// v3.10 — global room directory for "same Wi-Fi" auto-discovery.
// One DO ('global') keeps entries keyed by  <ipHash>:<CODE>  so rooms are only
// ever visible to devices behind the SAME public IP — i.e. players on the
// same router (or the same carrier CGNAT). Entries live 45 s; a frozen or
// backgrounded host simply stops announcing and drops off the list, exactly
// matching the room's real availability. No native code, no permissions.
export class Directory {
  constructor(ctx, env) { this.ctx = ctx; }

  async fetch(request) {
    const url = new URL(request.url);
    const ip = url.searchParams.get('ip') || '';
    const now = Date.now();
    if (url.pathname === '/announce') {
      const code = (url.searchParams.get('code') || '').toUpperCase();
      const players = Math.max(1, Math.min(16, Number(url.searchParams.get('players')) || 1));
      if (!/^[A-Z0-9]{4,8}$/.test(code) || !/^[0-9a-f]{1,40}$/.test(ip)) {
        return Response.json({ ok: false });
      }
      await this.ctx.storage.put(ip + ':' + code, { code, players, ts: now });
      return Response.json({ ok: true });
    }
    if (url.pathname === '/query') {
      if (!ip) return Response.json({ ok: true, rooms: [] });
      const rooms = [];
      const stale = [];
      for (const [k, v] of await this.ctx.storage.list({ prefix: ip + ':' })) {
        if (!v || typeof v !== 'object' || typeof v.ts !== 'number' || now - v.ts > 45000) {
          stale.push(k);
          continue;
        }
        rooms.push({ code: v.code, players: v.players, ageMs: now - v.ts });
      }
      if (stale.length) await this.ctx.storage.delete(stale);
      rooms.sort((a, b) => (b.players - a.players) || (a.ageMs - b.ageMs));
      return Response.json({ ok: true, rooms: rooms.slice(0, 6) });
    }
    return Response.json({ ok: false }, { status: 404 });
  }
}

const SIGNAL_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};

// salted hash of the caller's public IP — we never store the IP itself, only
// this short digest, and equality of two digests is all the directory needs.
async function ipHash(request) {
  try {
    const ip = (request.headers.get('cf-connecting-ip') || 'unknown').trim();
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ns3d-dir-v1|' + ip));
    return Array.from(new Uint8Array(h)).slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return 'unknown'; }
}

function corsJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...SIGNAL_CORS, 'content-type': 'application/json' },
  });
}

async function handleSignal(request, url, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: SIGNAL_CORS });
  const dir = env && env.DIRECTORY ? env.DIRECTORY : null;

  // v3.11 — cheap liveness probe: the client pings this once per page load to
  // choose between REST signaling here and the public-MQTT relay (used when
  // this origin is SNI-filtered, e.g. workers.dev in Iran).
  if (url.pathname === '/signal/health') return corsJson({ ok: true, t: Date.now() });

  // v3.10 — same-WiFi auto-discovery: list live rooms announced by hosts that
  // share this caller's public IP. Everyone on one router sees each other's
  // rooms instantly — no code typing, no QR, no native APIs.
  if (url.pathname === '/signal/nearby' && request.method === 'GET') {
    if (!dir) return corsJson({ ok: false, reason: 'no-binding' }, 500);
    const stub = dir.get(dir.idFromName('global'));
    const r = await stub.fetch('https://dir/query?ip=' + encodeURIComponent(await ipHash(request)));
    const out = new Response(r.body, r);
    for (const [k, v] of Object.entries(SIGNAL_CORS)) out.headers.set(k, v);
    return out;
  }

  // v3.12 — the relay is a WebSocket upgrade: pass the original request (its
  // Upgrade header must survive) straight to the room DO.
  const mRelay = url.pathname.match(/^\/signal\/([A-Za-z0-9]{4,8})\/relay$/);
  if (mRelay) {
    const ns = env && env.ROOM;
    if (!ns) return corsJson({ ok: false, reason: 'no-binding' }, 500);
    const room = ns.get(ns.idFromName(mRelay[1].toUpperCase()));
    return room.fetch(new Request('https://room/relay', request));
  }

  const m = url.pathname.match(/^\/signal\/([A-Za-z0-9]{4,8})\/(host|join|offer|offers|answer|heartbeat|status)$/);
  if (!m) return corsJson({ ok: false, reason: 'bad-path' }, 404);
  const ns = env && env.ROOM;
  const room = ns ? ns.get(ns.idFromName(m[1].toUpperCase())) : null;
  if (!room) return corsJson({ ok: false, reason: 'no-binding' }, 500);
  const fwdHeaders = {
    'x-ns3d-code': m[1].toUpperCase(),
    'x-ns3d-iph': await ipHash(request),
  };
  const ct = request.headers.get('content-type');
  if (ct) fwdHeaders['content-type'] = ct;
  const resp = await room.fetch(new Request('https://room/' + m[2] + (url.search || ''), {
    method: request.method,
    headers: fwdHeaders,
    body: request.method === 'POST' ? await request.text() : undefined,
  }));
  const out = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(SIGNAL_CORS)) out.headers.set(k, v);
  return out;
}

const APP_PUBLIC_KEY = '8f16f09b4df7780805d4f0feb7543bdbd4dbc115ed18211a5c7d867691899a95';

const APK_URL = 'https://github.com/izad369/neon-strike-3d/releases/download/v4.0/DesertStrike3D-v4.0.apk';
const APK_LOCAL_URL = 'https://github.com/izad369/neon-strike-3d/releases/download/v4.0-local/DesertStrike3D-Local-v4.0.apk';
const APK_SLITHER_URL = 'https://github.com/izad369/neon-slither-izad/releases/download/v1.0/NeonSlither-1.0.apk';
const GAME_URL = 'https://neon-strike-3d.rezaei-reza1092.workers.dev/';
const GAME_MIRROR_URL = 'https://izad369.github.io/neon-strike-3d/';
const SLITHER_MIRROR_URL = 'https://izad369.github.io/neon-slither-izad/';

const HELP_TEXT = [
  '**DESERT STRIKE 3D** — command list',
  '\u2022 `/ping` \u2014 check I am alive',
  '\u2022 `/apk` \u2014 latest Android APK (v4.0)',
  '\u2022 `/apk local` / `/apk slither` \u2014 Local edition / Neon Slither',
  '\u2022 `/ask <question>` \u2014 ask about the game (edge edition)',
  '\u2022 `/help` \u2014 this list',
  '',
  'Play in your browser: <' + GAME_URL + '>',
  'Modes: Deathmatch, TDM, Survival, Gun Game, Duel, Battle Royale.',
].join('\n');

const APK_TEXT = [
  '\uD83D\uDD25 **DESERT STRIKE 3D v4.0** \u2014 Android APK:',
  APK_URL,
  '',
  '\uD83C\uDFEA **LOCAL edition** (offline only, separate app):',
  APK_LOCAL_URL,
  '',
  '\uD83D\uDC0D **NEON SLITHER** Android APK (with Local 2P):',
  APK_SLITHER_URL,
  '',
  'Install: download \u2192 allow "install unknown apps" \u2192 open the APK.',
  'Same signing key as v2.0\u2013v3.7 \u2014 installs directly over them.',
  'v3.8: NEW — LAN multiplayer over Wi-Fi with ZERO internet (QR / copy-paste invites) \u2022 v3.7: Gun Game = one gun + graphics quality (weak-GPU auto-LOW) \u2022 v3.6: Android 5+ (minSdk 21) + separate LOCAL edition \u2022 v3.5: joystick fix + ROT flip \u2022 v3.4: sticky START.',
  'Site blocked? Mirror: ' + GAME_MIRROR_URL,
].join('\n');

// Tiny on-edge knowledge base for /ask (the big LLM brain lives on the dev node)
function askAnswer(q) {
  const s = (q || '').toLowerCase();
  const has = (...ws) => ws.some(w => s.includes(w));
  if (has('hello', 'hi ', 'hey', 'salam')) return 'Hey! Soldier ready. Try `/help` to see what I can do. \uD83C\uDFAE';
  if (has('apk', 'install', 'android', 'download')) return APK_TEXT;
  if (has('multiplayer', 'online', 'friend', 'room', 'p2p', 'server', 'wifi', 'wi-fi', 'lan')) return [
    '**Online multiplayer** is peer-to-peer (WebRTC). Signaling runs on this game server itself \u2014 no third-party service.',
    'Host: PLAY ONLINE \u2192 CREATE \u2192 share the 5-letter room code. Friends: PLAY ONLINE \u2192 JOIN + code.',
    '**NEW v3.10 — same-line auto-find:** on the join screen, rooms hosted on the SAME Wi-Fi / line appear automatically — just tap to join, no code typing.',
    '**NEW v3.8 \u2014 LAN mode with ZERO internet:** PLAY ONLINE \u2192 Host on Wi-Fi (LAN) / Join on Wi-Fi (LAN).',
    'Same Wi-Fi only: host shows a QR code (or copy-paste code), friend scans, sends the answer back, done.',
    'The host\u2019s phone/browser is the authority; snapshots sync at 12 Hz.',
    'Multiplayer is humans-only \u2014 zero bots, ever.',
  ].join('\n');
  if (has('mode', 'battle royale', 'duel', 'gun game', 'survival')) return [
    '**6 game modes:** DM (free-for-all) \u2022 TDM (squads, no FF) \u2022 Survival (waves) \u2022 Gun Game (13-gun ladder) \u2022 Duel (strict 1v1, first to 3) \u2022 **Battle Royale** (plane drop, 130 ground loots, limited ammo, SWAP pickup, shrinking zone, climbable towers).',
  ].join('\n');
  if (has('weapon', 'gun', 'knife', 'loadout', 'swap')) return [
    '**Loadout = knife + primary + backup (3 slots).** Tap a slot in the top-right bar to switch.',
    '17 weapons incl. AWM, Kar98K, AK-47, Deagle, Vector\u2026 knives boost your move speed.',
    'In Battle Royale every gun must be looted \u2014 walk over it, press **E / SWAP**.',
  ].join('\n');
  if (has('update', 'new', 'changelog', 'version', 'v3')) return [
    '**v3.0 highlights:** bots can no longer see behind their backs (FOV + line-of-sight), sniper scope no longer shows the gun model, enemy nameplates hidden, knife speed boost, 3-slot weapon bar, BR structures + weapon swapping, limited BR ammo, friendly fire OFF, no bots in multiplayer, forced landscape with fixed joystick mapping.',
  ].join('\n');
  return [
    '\u26A0 **My big AI brain is resting** (it runs on the dev node, which sleeps sometimes).',
    'I\u2019m still always awake here on Cloudflare for: `/ping` `/apk` `/help` and game questions about **modes, weapons, multiplayer, install, updates** \u2014 just ask one of those!',
  ].join('\n');
}

// Privacy policy page (plain HTML, served at /privacy)
const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy — DESERT STRIKE 3D</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#15130f;color:#e2d7ba;
       max-width:760px;margin:0 auto;padding:28px 20px 60px;line-height:1.65}
  h1{font-size:26px;letter-spacing:1px;color:#e6cfa0;margin:0 0 4px}
  h2{font-size:18px;color:#e6cfa0;margin:28px 0 8px}
  p,li{font-size:15px}
  .sub{color:#b3a077;font-size:14px;margin-bottom:22px}
  b{color:#f0e6cc}
</style>
</head>
<body>
<h1>DESERT STRIKE 3D</h1>
<div class="sub">Privacy Policy — last updated: October 2026</div>

<h2>1. Overview</h2>
<p>DESERT STRIKE 3D is an offline-first browser and Android shooter. It is published as an
independent hobby project by a solo developer. This policy applies to the web version and to
the Android APK build of the game, including the LOCAL edition.</p>

<h2>2. No accounts, no personal data</h2>
<p>The game has <b>no sign-in, no registration and no user accounts</b>. We do not collect,
store or transmit your name, email address, phone number, location or contacts. There is no
advertising SDK, no analytics tracker and no third-party data collection built into the game.</p>

<h2>3. Data stored on your device only</h2>
<p>The following settings are saved <b>locally on your device</b> (browser localStorage /
Android WebView storage) and never leave it:</p>
<ul>
  <li>Your chosen in-game player name (a nickname you type yourself).</li>
  <li>Graphics, touch-control, sensitivity and volume preferences.</li>
  <li>Local career statistics (match results, kills/deaths) shown on the Career screen.</li>
</ul>
<p>Clearing your browser data or uninstalling the app removes all of it permanently.</p>

<h2>4. Online multiplayer</h2>
<p>Online matches are <b>peer-to-peer</b> (WebRTC). When you host or join a room, your browser
exchanges connection data with the other players in that room only, for the sole purpose of
syncing match gameplay (positions, health, score). There is no game server that stores match
data. Room codes are temporary and expire when the match ends. Voice, chat and personal
messages are not part of the game.</p>

<h2>5. Discord bot</h2>
<p>The optional Discord bot answers slash commands. It does not read or store message history
of users and keeps no profiles. Commands like /apk only return public download links.</p>

<h2>6. Permissions (Android APK)</h2>
<p>The Android build requests <b>no special permissions</b>. It may use the network connection
only when you play an online match or download nothing else. The game contains no in-app
purchases and no ads.</p>

<h2>7. Children</h2>
<p>The game contains stylized blocky combat with no blood or gore. It is not directed at
children under 13, and we knowingly collect no data from anyone — including children.</p>

<h2>8. Changes &amp; contact</h2>
<p>If this policy changes, the updated date above will change with it. Questions or data
concerns? Contact the developer through the support email listed on the store listing, or via
the GitHub project: <b>https://github.com/izad369/neon-strike-3d</b></p>
</body>
</html>`;

async function verifySignature(request, body) {
  const sig = request.headers.get('x-signature-ed25519') || '';
  const ts = request.headers.get('x-signature-timestamp') || '';
  if (!/^[0-9a-f]{128}$/i.test(sig) || !ts) return false;
  try {
    const keyBytes = Uint8Array.from(APP_PUBLIC_KEY.match(/.{2}/g), h => parseInt(h, 16));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify']);
    const sigBytes = Uint8Array.from(sig.match(/.{2}/g), h => parseInt(h, 16));
    const data = new TextEncoder().encode(ts + body);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, data);
  } catch { return false; }
}

function cmdResponse(content) {
  return Response.json({ type: 4, data: { content } });
}

export async function handleInteraction(body) {
  const t = body.type;
  if (t === 1) return Response.json({ type: 1 }); // PING
  if (t === 2) {
    const name = body.data?.name;
    if (name === 'ping') return cmdResponse('\uD83C\uDFD3 Pong! Always-on edition (Cloudflare edge) \u2014 uptime 24/7.');
    if (name === 'help') return cmdResponse(HELP_TEXT);
    if (name === 'apk') return cmdResponse(APK_TEXT);
    if (name === 'ask') {
      const q = body.data?.options?.find(o => o.name === 'question')?.value || '';
      return cmdResponse(askAnswer(q));
    }
    return cmdResponse('Unknown command \u2014 try `/help`.');
  }
  return Response.json({ type: 5 }); // defer anything else
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/signal/')) {
      return handleSignal(request, url, env);
    }
    if (url.pathname === '/bot/health') {
      return Response.json({ ok: true, bot: 'DesertStrike3D', mode: 'cloudflare-edge', ts: Date.now() });
    }
    // Discord Domain Connection verification (profile website link).
    // Discord fetches this exact URL and must see the challenge token as plain text.
    if (url.pathname === '/.well-known/discord') {
      return new Response('dh=4d7044daf1e72a009e541bd119abb799f675fabb', {
        status: 200,
        headers: {
          'content-type': 'text/plain;charset=UTF-8',
          'cache-control': 'public, max-age=300',
        },
      });
    }
    if (url.pathname === '/bot/discord' && request.method === 'POST') {
      const body = await request.text();
      if (!(await verifySignature(request, body))) {
        return new Response('invalid signature', { status: 401 });
      }
      let parsed;
      try { parsed = JSON.parse(body); } catch { return new Response('bad json', { status: 400 }); }
      return handleInteraction(parsed);
    }
    // short link: latest Android APK (always points at the newest release asset)
    if (url.pathname === '/apk' && request.method === 'GET') {
      return Response.redirect(APK_URL, 302);
    }
    if (url.pathname === '/apk-local' && request.method === 'GET') {
      return Response.redirect(APK_LOCAL_URL, 302);
    }
    if (url.pathname === '/apk-slither' && request.method === 'GET') {
      return Response.redirect(APK_SLITHER_URL, 302);
    }
    if (url.pathname === '/mirror' && request.method === 'GET') {
      return Response.redirect(GAME_MIRROR_URL, 302);
    }
    // Privacy policy (required by Aptoide Connect / Google Play-style listings)
    if (url.pathname === '/privacy' && request.method === 'GET') {
      return new Response(PRIVACY_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html;charset=UTF-8', 'cache-control': 'public, max-age=3600' },
      });
    }
    // everything else: serve the game (assets binding, SPA fallback)
    return env.ASSETS ? env.ASSETS.fetch(request) : fetch(request);
  },
};
