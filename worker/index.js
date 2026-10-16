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
//   anything else      -> static assets (dist/), SPA fallback

const APP_PUBLIC_KEY = '8f16f09b4df7780805d4f0feb7543bdbd4dbc115ed18211a5c7d867691899a95';

const APK_URL = 'https://github.com/izad369/neon-strike-3d/releases/download/v3.8/DesertStrike3D-v3.8.apk';
const APK_LOCAL_URL = 'https://github.com/izad369/neon-strike-3d/releases/download/v3.8-local/DesertStrike3D-Local-v3.8.apk';
const APK_SLITHER_URL = 'https://github.com/izad369/neon-slither-izad/releases/download/v1.0/NeonSlither-1.0.apk';
const GAME_URL = 'https://neon-strike-3d.rezaei-reza1092.workers.dev/';
const GAME_MIRROR_URL = 'https://izad369.github.io/neon-strike-3d/';
const SLITHER_MIRROR_URL = 'https://izad369.github.io/neon-slither-izad/';

const HELP_TEXT = [
  '**DESERT STRIKE 3D** — command list',
  '\u2022 `/ping` \u2014 check I am alive',
  '\u2022 `/apk` \u2014 latest Android APK (v3.8)',
  '\u2022 `/apk local` / `/apk slither` \u2014 Local edition / Neon Slither',
  '\u2022 `/ask <question>` \u2014 ask about the game (edge edition)',
  '\u2022 `/help` \u2014 this list',
  '',
  'Play in your browser: <' + GAME_URL + '>',
  'Modes: Deathmatch, TDM, Survival, Gun Game, Duel, Battle Royale.',
].join('\n');

const APK_TEXT = [
  '\uD83D\uDD25 **DESERT STRIKE 3D v3.8** \u2014 Android APK:',
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
    '**Online multiplayer** is peer-to-peer (WebRTC via PeerJS) \u2014 no game server needed.',
    'Host: PLAY ONLINE \u2192 CREATE \u2192 share the 5-letter room code. Friends: PLAY ONLINE \u2192 JOIN + code.',
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
