// DESERT STRIKE 3D - all CSS (injected from JS so the game is fully self-contained)
export function injectStyles() {
  const css = `
@import url('https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Rajdhani:wght@500;600;700&display=swap');

.ns-root, .ns-root *, .ns-menu, .ns-menu *, .ns-scroll-nav, .ns-scroll-nav * { box-sizing: border-box; margin: 0; padding: 0; }
.ns-root {
  position: fixed; inset: 0; overflow: hidden; background: #171410;
  font-family: 'Rajdhani', 'Segoe UI', Arial, sans-serif; color: #efe8d4;
  user-select: none; -webkit-user-select: none;
}
.ns-root canvas { display: block; }
.ns-hidden { display: none !important; }
.ns-ops { font-family: 'Black Ops One', 'Orbitron', sans-serif; }

/* ---------- HUD ---------- */
/* z-index 20: ABOVE the touch layer (15) so tap-to-equip slots receive touches;
   root stays pointer-events:none so only real widgets (slots) capture */
.ns-hud { position: absolute; inset: 0; pointer-events: none; z-index: 20; }
.ns-crosshair { position: absolute; left: 50%; top: 50%; width: 26px; height: 26px; transform: translate(-50%, -50%); }
.ns-crosshair::before, .ns-crosshair::after {
  content: ''; position: absolute; background: #e8dcb0; box-shadow: 0 0 3px rgba(0,0,0,0.8);
}
.ns-crosshair::before { left: 50%; top: 0; width: 2px; height: 100%; transform: translateX(-50%); }
.ns-crosshair::after { top: 50%; left: 0; height: 2px; width: 100%; transform: translateY(-50%); }
.ns-crosshair-dot { position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; border-radius: 50%;
  background: #fff; transform: translate(-50%, -50%); box-shadow: 0 0 3px rgba(0,0,0,0.8); }

.ns-hp-wrap { position: absolute; left: 24px; bottom: 24px; width: 240px; }
.ns-hp-label { font-family: 'Black Ops One', sans-serif; font-size: 12px; letter-spacing: 2px; color: #cdb27a; margin-bottom: 5px; display: flex; justify-content: space-between; }
.ns-hp-right { display: flex; gap: 8px; align-items: baseline; }
.ns-armor-chip { color: #9fc2d8; font-size: 11px; letter-spacing: 1px; background: rgba(38,48,58,0.8); border: 1px solid #5a7488; padding: 1px 7px; border-radius: 3px; }
.ns-zone-warn { position: absolute; left: 50%; top: 64px; transform: translateX(-50%); display: none;
  font-family: 'Black Ops One', sans-serif; font-size: 15px; letter-spacing: 3px; color: #ffb26b;
  background: rgba(48,22,8,0.85); border: 1px solid #d2691e; padding: 7px 16px; border-radius: 6px; }
.ns-zone-warn.show { display: block; animation: ns-blink 0.9s infinite; }
.ns-hp-bar { height: 14px; background: rgba(30,26,18,0.8); border: 1px solid #6b5d43; border-radius: 3px; overflow: hidden; }
.ns-hp-fill { height: 100%; width: 100%; background: linear-gradient(90deg, #c9b26b, #8a9a55); transition: width 0.15s; }
.ns-hp-fill.low { background: linear-gradient(90deg, #d24a35, #e07b39); }
.ns-ammo { position: absolute; right: 28px; bottom: 20px; text-align: right; }
.ns-ammo-num { font-family: 'Black Ops One', sans-serif; font-size: 40px; font-weight: 400; color: #f2ecd8; text-shadow: 0 2px 4px rgba(0,0,0,0.7); line-height: 1; }
.ns-ammo-num.empty { color: #d24a35; text-shadow: 0 0 10px rgba(210,74,53,0.6); }
.ns-ammo-sub { font-size: 14px; letter-spacing: 2px; color: #a08f6f; }
.ns-ammo-sub .rel { color: #e6c35c; animation: ns-blink 0.6s infinite; }
.ns-ammo-res { font-family: 'Black Ops One', sans-serif; font-size: 16px; color: #a08f6f; margin-left: 8px; }
@keyframes ns-blink { 50% { opacity: 0.25; } }

/* 3-slot weapon bar (top-right, tap to equip) */
.ns-slots { position: absolute; top: 64px; right: 24px; display: flex; flex-direction: column; gap: 5px;
  pointer-events: auto; z-index: 12; }
.ns-slot { display: flex; align-items: center; gap: 9px; padding: 5px 12px 5px 6px; min-width: 168px;
  background: rgba(28,24,16,0.78); border: 1px solid #55492f; border-radius: 6px; cursor: pointer;
  transition: border-color .12s, background .12s; }
.ns-slot:hover { border-color: #b3a077; }
.ns-slot.active { border-color: #d6b96a; background: rgba(214,185,106,0.14); box-shadow: 0 0 10px rgba(214,185,106,0.18); }
.ns-slot.empty { opacity: 0.42; cursor: default; }
.ns-slot-key { font-family: 'Black Ops One', sans-serif; font-size: 11px; color: #171410; background: #b3a077;
  border-radius: 4px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; flex: none; }
.ns-slot.active .ns-slot-key { background: #e6cfa0; }
.ns-slot-name { font-size: 14px; font-weight: 700; letter-spacing: 1px; color: #e2d7ba; white-space: nowrap; }

/* contextual ground-weapon swap prompt (BR) */
.ns-swaphint { position: absolute; left: 50%; top: 58%; transform: translateX(-50%); z-index: 12;
  font-size: 16px; font-weight: 700; letter-spacing: 1px; color: #e6cfa0;
  background: rgba(28,24,16,0.85); border: 1px solid #d6b96a; border-radius: 6px; padding: 7px 16px; }
.ns-swaphint b { color: #e6c35c; }

.ns-timer { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); text-align: center; }
.ns-timer-time { font-family: 'Black Ops One', sans-serif; font-size: 25px; font-weight: 400; color: #f2ecd8; text-shadow: 0 2px 4px rgba(0,0,0,0.7); }
.ns-timer-mode { font-size: 12px; letter-spacing: 3px; color: #cdb27a; text-transform: uppercase; }
.ns-kd { position: absolute; top: 14px; left: 24px; font-family: 'Black Ops One', sans-serif; font-size: 14px; color: #e2d7ba;
  background: rgba(30,26,18,0.72); border: 1px solid #6b5d43; padding: 6px 12px; border-radius: 4px; }
.ns-kd b { color: #9fb86e; }
.ns-room { position: absolute; top: 14px; right: 24px; font-size: 13px; letter-spacing: 2px; color: #cdb27a;
  background: rgba(30,26,18,0.72); border: 1px solid #6b5d43; padding: 6px 12px; border-radius: 4px; }

.ns-feed { position: absolute; top: 64px; left: 24px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.ns-feed-item { background: rgba(28,24,16,0.85); border: 1px solid #6b5d43; border-left: 3px solid #cdb27a;
  padding: 4px 10px; font-size: 14px; font-weight: 600; border-radius: 3px; animation: ns-feed-in 0.18s ease-out; }
.ns-feed-item b { color: #e6c35c; }
.ns-feed-item .vic { color: #d8836e; }
.ns-feed-item.hs { border-left-color: #e08a2e; }
@keyframes ns-feed-in { from { transform: translateX(-30px); opacity: 0; } }

.ns-hitmarker { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%) rotate(45deg); width: 22px; height: 22px; opacity: 0; }
.ns-hitmarker span { position: absolute; background: #fff; box-shadow: 0 0 4px #fff; }
.ns-hitmarker span:nth-child(1) { left: 0; top: 0; width: 7px; height: 2px; }
.ns-hitmarker span:nth-child(2) { right: 0; top: 0; width: 7px; height: 2px; }
.ns-hitmarker span:nth-child(3) { left: 0; bottom: 0; width: 7px; height: 2px; }
.ns-hitmarker span:nth-child(4) { right: 0; bottom: 0; width: 7px; height: 2px; }
.ns-hitmarker.show { animation: ns-hm 0.22s ease-out; }
.ns-hitmarker.hs span { background: #e08a2e; box-shadow: 0 0 5px #e08a2e; }
@keyframes ns-hm { 0% { opacity: 1; transform: translate(-50%,-50%) rotate(45deg) scale(1.35); } 100% { opacity: 0; transform: translate(-50%,-50%) rotate(45deg) scale(0.9); } }

.ns-vignette { position: absolute; inset: 0; opacity: 0; transition: opacity 0.25s;
  background: radial-gradient(ellipse at center, transparent 55%, rgba(140,20,10,0.55) 100%); }
.ns-scoreboard { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: 420px;
  background: rgba(26,22,15,0.94); border: 1px solid #6b5d43; border-radius: 8px; padding: 18px 22px; }
.ns-scoreboard h3 { font-family: 'Black Ops One', sans-serif; letter-spacing: 4px; color: #cdb27a; text-align: center; margin-bottom: 12px; font-size: 16px; }
.ns-sb-row { display: grid; grid-template-columns: 1fr 60px 60px; padding: 5px 10px; font-size: 15px; font-weight: 600; border-radius: 3px; }
.ns-sb-row.head { color: #a08f6f; font-size: 12px; letter-spacing: 2px; }
.ns-sb-row.me { background: rgba(214,185,106,0.12); border: 1px solid rgba(214,185,106,0.35); }
.ns-sb-row:nth-child(even):not(.head) { background: rgba(255,255,255,0.03); }
.ns-respawn { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); text-align: center; }
.ns-respawn h2 { font-family: 'Black Ops One', sans-serif; font-size: 34px; color: #d24a35; text-shadow: 0 0 18px rgba(210,74,53,0.7); letter-spacing: 4px; }
.ns-respawn p { font-size: 18px; color: #e2d7ba; margin-top: 8px; }
.ns-hint { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); font-size: 13px; color: #7d7154; letter-spacing: 1px; }

/* center toast (weapon switch / wave banner) */
.ns-toast { position: absolute; left: 50%; top: 58%; transform: translateX(-50%); text-align: center;
  font-family: 'Black Ops One', sans-serif; font-size: 24px; letter-spacing: 5px; color: #e6cfa0;
  text-shadow: 0 2px 6px rgba(0,0,0,0.8); pointer-events: none; }
.ns-toast.pop { animation: ns-toast-pop 1.4s ease-out forwards; }
@keyframes ns-toast-pop { 0% { opacity: 0; transform: translateX(-50%) scale(1.25); } 12% { opacity: 1; transform: translateX(-50%) scale(1); } 75% { opacity: 1; } 100% { opacity: 0; } }

/* crouch indicator */
.ns-crouch-ind { position: absolute; left: 24px; bottom: 130px; display: none; font-size: 12px; letter-spacing: 3px;
  color: #cdb27a; background: rgba(30,26,18,0.72); border: 1px solid #6b5d43; padding: 4px 10px; border-radius: 4px; }
.ns-crouch-ind.show { display: block; animation: ns-blink 2s infinite; }

/* ADS scope overlay (sniper fully aimed): circular mask + hair cross */
.ns-scope { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
.ns-scope-mask { position: absolute; inset: 0;
  background: radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 27.5vmin, rgba(8,6,3,0.55) 30vmin, rgba(5,4,2,0.97) 34vmin); }
.ns-scope-line { position: absolute; background: rgba(20,16,8,0.85); }
.ns-scope-line.h { left: 0; right: 0; top: 50%; height: 1.5px; transform: translateY(-50%); }
.ns-scope-line.v { top: 0; bottom: 0; left: 50%; width: 1.5px; transform: translateX(-50%); }
.ns-hud.scoped .ns-crosshair { display: none; }
.ns-hud.scoped .ns-scope-line { background: rgba(10,8,4,0.9); box-shadow: 0 0 2px rgba(230,195,92,0.5); }

/* ---------- Menus ---------- */
/* The menu layer is attached to <body>, OUTSIDE .ns-root, so it NEVER follows
   the forced-landscape rotation: on a portrait phone the menu stays upright
   (portrait layout) while the game keeps rendering rotated landscape. */
.ns-menu { position: fixed; inset: 0; z-index: 900; display: flex; align-items: center; justify-content: center;
  padding: 12px; overflow-y: auto;
  font-family: 'Rajdhani', 'Segoe UI', Arial, sans-serif; color: #efe8d4;
  background: radial-gradient(ellipse at 30% 20%, rgba(214,185,106,0.10), transparent 55%),
              radial-gradient(ellipse at 75% 80%, rgba(125,143,78,0.10), transparent 50%),
              rgba(18,15,10,0.94); }
/* max-height:100% (not 92vh!) — vh units ignore the forced-landscape root
   rotation, which made the menu unscrollable on portrait phones.
   margin:auto (not flex centering alone) keeps the TOP reachable when the
   panel is taller than the screen. */
.ns-menu-inner { width: min(520px, 92vw); max-height: 100%; overflow-y: auto; margin: auto;
  -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
  padding: 26px 28px 34px; text-align: center; }
/* touch devices: root blocks touch-action during play — menus must pan vertically */
.ns-menu, .ns-menu-inner { touch-action: pan-y; }
/* reserve room beside the panel for the scroll arrows (only while they show) */
.ns-menu.ns-nav-reserve { padding-right: 78px; }
.ns-title { font-family: 'Black Ops One', sans-serif; font-weight: 400; font-size: 50px; letter-spacing: 5px; line-height: 1;
  background: linear-gradient(90deg, #e6cfa0, #cdb27a 45%, #9fb86e); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,0.65)); }
.ns-subtitle { font-size: 15px; letter-spacing: 6px; color: #a08f6f; margin: 8px 0 26px; text-transform: uppercase; }
.ns-btn { display: block; width: 100%; margin: 10px 0; padding: 13px 18px; font-family: 'Black Ops One', sans-serif; font-size: 14px;
  font-weight: 400; letter-spacing: 2px; color: #efe8d4; background: rgba(38,32,22,0.92); border: 1px solid #6b5d43;
  border-radius: 6px; cursor: pointer; transition: all 0.15s; text-transform: uppercase; touch-action: manipulation; }
.ns-btn:hover { border-color: #d6b96a; color: #e6cfa0; box-shadow: 0 0 14px rgba(214,185,106,0.25); transform: translateY(-1px); }
.ns-btn:disabled { opacity: 0.45; cursor: wait; }
.ns-btn.primary { background: linear-gradient(90deg, rgba(214,185,106,0.16), rgba(125,143,78,0.16)); border-color: #b3a077; }
/* Primary CTAs (Start Match / Create Match) must NEVER be clipped by a tall panel:
   sticky pins them fully visible & tappable at the bottom of the panel scroll area
   in every orientation. On portrait phones the offline panel is taller than the
   screen and Start Match used to sit half off-screen at y>100% -> taps landed
   nowhere -> the game looked frozen on the menu. Opaque bg keeps it readable
   while panel content scrolls underneath. */
.ns-btn.ns-cta { position: sticky; bottom: 10px; z-index: 6;
  background: linear-gradient(90deg, #2b2517, #26301a); box-shadow: 0 6px 20px rgba(0,0,0,0.6); }
/* same guarantee for CTAs that live inside a row wrapper (sticky needs the
   scrolling parent; the row is the direct child of the panel scroller) */
.ns-row.ns-cta-row { position: sticky; bottom: 10px; z-index: 6; }
.ns-row.ns-cta-row .ns-btn { background: linear-gradient(90deg, #2b2517, #26301a); box-shadow: 0 6px 20px rgba(0,0,0,0.6); }
.ns-btn.danger:hover { border-color: #d24a35; color: #d24a35; box-shadow: 0 0 14px rgba(210,74,53,0.3); }
.ns-btn.small { font-size: 12px; padding: 9px 12px; }
.ns-field { margin: 14px 0; text-align: left; }
.ns-field label { display: block; font-size: 12px; letter-spacing: 2px; color: #a08f6f; margin-bottom: 6px; text-transform: uppercase; }
.ns-input { width: 100%; padding: 11px 14px; background: rgba(30,26,18,0.9); border: 1px solid #6b5d43; border-radius: 5px;
  color: #f2ecd8; font-family: 'Rajdhani', sans-serif; font-size: 17px; font-weight: 600; letter-spacing: 1px; outline: none; }
.ns-input:focus { border-color: #d6b96a; box-shadow: 0 0 10px rgba(214,185,106,0.2); }
.ns-row { display: flex; gap: 10px; }
.ns-row > * { flex: 1; }
.ns-seg { display: flex; gap: 6px; }
.ns-seg button { flex: 1; padding: 9px 6px; background: rgba(30,26,18,0.9); border: 1px solid #6b5d43; color: #b3a37f;
  font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 14px; letter-spacing: 1px; border-radius: 5px; cursor: pointer; text-transform: uppercase; }
.ns-seg button.on { border-color: #d6b96a; color: #e6cfa0; background: rgba(214,185,106,0.10); box-shadow: 0 0 8px rgba(214,185,106,0.15) inset; }
.ns-panel-title { font-family: 'Black Ops One', sans-serif; font-size: 21px; letter-spacing: 4px; color: #f2ecd8; margin-bottom: 4px; }
.ns-back { margin-top: 18px; }
.ns-status { min-height: 20px; font-size: 14px; color: #e6c35c; margin-top: 10px; }
.ns-status.err { color: #d8836e; }
.ns-code-box { font-family: 'Black Ops One', sans-serif; font-size: 42px; letter-spacing: 10px; color: #cdb27a;
  text-shadow: 0 2px 3px rgba(0,0,0,0.6); background: rgba(30,26,18,0.9); border: 1px dashed #b3a077; border-radius: 8px; padding: 14px 10px 10px; margin: 12px 0; }
.ns-code-hint { font-size: 13px; color: #a08f6f; margin-bottom: 14px; line-height: 1.5; }
/* ---- v3.10 same-WiFi auto-discovery (online panel) ---- */
.ns-nearby-list { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 4px; }
.ns-nearby-list .ns-btn { margin: 0; border-color: #7d8f4e; }
.ns-nearby-list .ns-btn:hover { border-color: #d6b96a; }
.ns-nearby-none { font-size: 13px; color: #9db38a; line-height: 1.45; padding: 2px 0 4px; }
/* ---- LAN (Wi-Fi) panels ---- */
.ns-code-area { width: 100%; padding: 9px 12px; background: rgba(30,26,18,0.92); border: 1px solid #6b5d43; border-radius: 5px;
  color: #cdb27a; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.5;
  resize: none; word-break: break-all; user-select: text; -webkit-user-select: text; touch-action: manipulation; }
.ns-code-area:focus { border-color: #d6b96a; outline: none; }
.ns-qr { display: block; width: min(280px, 68vw); height: auto; background: #f3e9cf; border: 3px solid #d6b96a;
  border-radius: 8px; margin: 10px auto 4px; }
.ns-lan-or { text-align: center; color: #8f815f; font-size: 13px; margin: 8px 0 4px; }
.ns-scan-zone { margin: 8px 0 4px; }
.ns-scan-video { display: block; width: min(280px, 68vw); aspect-ratio: 4 / 3; object-fit: cover; background: #000;
  border: 2px solid #6b5d43; border-radius: 8px; margin: 0 auto; }
.ns-scan-hint { text-align: center; font-size: 13px; color: #b3a37f; margin: 6px 0; }
.ns-help { text-align: left; font-size: 15px; line-height: 1.75; color: #ddd2b4; background: rgba(30,26,18,0.6);
  border: 1px solid #55492f; border-radius: 6px; padding: 16px 20px; margin-top: 8px; }
.ns-help b { color: #cdb27a; }
.ns-help .k { display: inline-block; min-width: 26px; text-align: center; background: #3a3223; border: 1px solid #6b5d43;
  border-bottom-width: 3px; border-radius: 4px; padding: 0 7px; font-weight: 700; color: #f2ecd8; font-size: 13px; }
/* career & stats screen */
.ns-career-name { color: #cdb27a; font-weight: 700; letter-spacing: 3px; }
.ns-career-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 12px 0 4px; }
.ns-career-cell { background: rgba(30,26,18,0.75); border: 1px solid #55492f; border-radius: 6px; padding: 8px 4px; text-align: center; }
.ns-career-cell span { display: block; font-size: 10px; letter-spacing: 1px; color: #a08f6f; text-transform: uppercase; }
.ns-career-cell b { display: block; font-size: 17px; color: #f2ecd8; margin-top: 2px; }
.ns-career-hint { font-size: 12px; color: #a08f6f; margin: 8px 0 10px; line-height: 1.5; }
.ns-career-list { text-align: left; }
.ns-career-list .ns-sb-row small { display: block; font-size: 10px; color: #93866a; letter-spacing: 0.5px; }
.ns-career-empty { font-size: 14px; color: #a08f6f; padding: 14px 6px; text-align: center; }
.ns-res-win { color: #9fb86e; font-weight: 700; }
.ns-res-lose { color: #d8836e; font-weight: 700; }
.ns-end-title { font-family: 'Black Ops One', sans-serif; font-size: 40px; letter-spacing: 5px; margin-bottom: 2px; }
.ns-end-title.win { color: #9fb86e; text-shadow: 0 0 20px rgba(159,184,110,0.5); }
.ns-end-title.lose { color: #e08a2e; text-shadow: 0 0 20px rgba(224,138,46,0.45); }
.ns-end-sub { color: #a08f6f; letter-spacing: 3px; font-size: 13px; margin-bottom: 18px; text-transform: uppercase; }
.ns-lobby-tag { font-size: 14px; color: #b3a37f; margin-top: 8px; min-height: 20px; }
.ns-foot { margin-top: 22px; font-size: 11px; letter-spacing: 2px; color: #6b5f45; }

/* side scroll arrows (up/down) — hold to scroll the active menu panel */
.ns-scroll-nav { position: fixed; right: 10px; top: 50%; transform: translateY(-50%); z-index: 910;
  display: flex; flex-direction: column; gap: 12px; }
.ns-scroll-btn { width: 58px; height: 76px; border-radius: 12px; font-size: 24px; line-height: 1;
  color: #e6cfa0; background: rgba(38,32,22,0.92); border: 1px solid #b3a077; cursor: pointer;
  font-family: 'Rajdhani', sans-serif; font-weight: 700;
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent; transition: all 0.12s; }
.ns-scroll-btn:active { background: rgba(214,185,106,0.28); box-shadow: 0 0 14px rgba(214,185,106,0.4); }
.ns-scroll-btn.ns-disabled { opacity: 0.3; }
.ns-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 5;
  font-family: 'Black Ops One', sans-serif; letter-spacing: 4px; color: #cdb27a; font-size: 18px; }

/* mobile note */
.ns-mobile-note { display: none; }
@media (pointer: coarse) {
  .ns-mobile-note { display: block; margin-top: 14px; font-size: 13px; color: #e6a94d; }
}
.ns-mobile-note.ok { color: #9fb86e; }

/* ---------- Touch controls (mobile) ---------- */
.ns-touch { position: absolute; inset: 0; z-index: 15; }
.ns-touch-zone { position: absolute; touch-action: none; }
.ns-zone-move { left: 0; bottom: 0; width: 45%; height: 75%; }
.ns-zone-look { right: 0; bottom: 0; width: 55%; height: 100%; }
.ns-joy { position: absolute; width: 124px; height: 124px; margin: -62px 0 0 -62px; border-radius: 50%;
  border: 2px solid rgba(214,185,106,0.4); background: rgba(30,26,18,0.35); display: none; pointer-events: none; }
.ns-joy-knob { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%;
  background: rgba(214,185,106,0.22); border: 2px solid rgba(214,185,106,0.75); box-shadow: 0 0 12px rgba(214,185,106,0.3); }
.ns-tbtn { position: absolute; display: flex; align-items: center; justify-content: center; border-radius: 50%;
  font-family: 'Black Ops One', sans-serif; font-weight: 400; letter-spacing: 1px; color: #e2d7ba;
  background: rgba(30,26,18,0.5); border: 2px solid rgba(107,93,67,0.9);
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.ns-tbtn.on { border-color: #d6b96a; color: #e6cfa0; box-shadow: 0 0 14px rgba(214,185,106,0.3); background: rgba(214,185,106,0.12); }
.ns-tbtn.fire { right: 24px; bottom: 92px; width: 96px; height: 96px; font-size: 15px;
  color: #f0d5cc; border-color: rgba(210,74,53,0.85); background: rgba(46,18,12,0.45); }
.ns-tbtn.fire.on { border-color: #d24a35; color: #e8a08e; box-shadow: 0 0 16px rgba(210,74,53,0.45); background: rgba(210,74,53,0.16); }
.ns-tbtn.jump { right: 138px; bottom: 30px; width: 66px; height: 66px; font-size: 12px; }
.ns-tbtn.reload { right: 34px; bottom: 204px; width: 58px; height: 58px; font-size: 11px; }
.ns-tbtn.crouch { right: 108px; bottom: 116px; width: 60px; height: 60px; font-size: 11px; }
.ns-tbtn.crouch.on { border-color: #9fb86e; color: #c9d8a4; }
.ns-tbtn.aim { right: 176px; bottom: 116px; width: 60px; height: 60px; font-size: 11px; }
.ns-tbtn.aim.on { border-color: #e6c35c; color: #f0e0ac; box-shadow: 0 0 16px rgba(230,195,92,0.45); background: rgba(230,195,92,0.14); }
.ns-tbtn.swap { left: 24px; bottom: 216px; width: 88px; height: 56px; border-radius: 10px; font-size: 13px;
  border-color: #9fb86e; color: #cfe0a4; background: rgba(52,64,32,0.55); }
.ns-tbtn.sb { left: 22px; top: 66px; width: 52px; height: 40px; border-radius: 8px; font-size: 10px; }
.ns-tbtn.rot { left: 22px; top: 12px; width: 46px; height: 46px; font-size: 10px; }
.ns-tbtn.rot.on { border-color: #9fb86e; color: #cfe0a4; }
.ns-tbtn.pause { left: 50%; margin-left: 86px; top: 12px; width: 46px; height: 46px; font-size: 13px; letter-spacing: 2px; }

/* forced landscape: render the game rotated 90° on portrait phones.
   The whole game runs in landscape even when the device is not rotated.
   Direction follows how the phone is physically held (no inverted controls). */
.ns-root.ns-forced-landscape {
  width: 100vh; height: 100vw;
  transform-origin: left top;
  transform: rotate(90deg) translateY(-100%);
}
.ns-root.ns-forced-landscape-flip {
  width: 100vh; height: 100vw;
  transform-origin: left top;
  transform: translateY(100vh) rotate(-90deg);
}

/* HUD adjustments while touch controls are active */
.ns-touch-mode .ns-root-canvas, .ns-touch-mode canvas { touch-action: none; }
.ns-root.ns-touch-mode { touch-action: none; overscroll-behavior: none; -webkit-touch-callout: none; }
.ns-root.ns-touch-mode .ns-ammo { right: 140px; bottom: 24px; }
.ns-root.ns-touch-mode .ns-hp-wrap { bottom: 200px; width: 190px; left: 20px; }
.ns-root.ns-touch-mode .ns-crouch-ind { bottom: auto; top: 66px; }
.ns-root.ns-touch-mode .ns-hint { display: none; }
.ns-root.ns-touch-mode .ns-slots { top: 64px; right: 18px; }
.ns-slot { min-width: 150px; touch-action: none; -webkit-tap-highlight-color: transparent; }
.ns-root.ns-touch-mode .ns-feed { top: 64px; left: 84px; max-width: 52vw; }
@media (max-width: 760px) {
  .ns-menu-inner { padding: 22px 18px; }
  .ns-title { font-size: 36px; letter-spacing: 3px; }
  .ns-ammo-num { font-size: 30px; }
  .ns-timer-time { font-size: 19px; }
  .ns-scoreboard { min-width: 0; width: 92vw; }
  .ns-kd { font-size: 12px; padding: 5px 8px; }
}
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
