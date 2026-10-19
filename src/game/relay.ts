// DESERT STRIKE 3D — v3.12 emergency media relay.
//
// Some networks kill WebRTC UDP entirely (carrier CGNAT, UDP-filtering ISPs,
// VPN/TUN clients without UDP forwarding) and the "free public TURN" crutch
// died too: openrelay.metered.ca now resolves to 100::1, a blackhole. When the
// data channel refuses to open even though the signaling handshake completed,
// both peers fall back to a WebSocket relay served by the SAME worker that
// already serves the signaling mailbox (SignalRoom DO, /signal/<code>/relay).
//
// The game code cannot tell the difference: RelayConn / VConn duck-type the
// LanConn surface (open, onData, onOpen, onClose, send, close).
//
// Topology is host-authoritative (same as the WebRTC path):
//   joiner  ->  {t:'m', d}  ->  server stamps f=<joiner id>  ->  host
//   host    ->  {t:'m', to:'*'|<id>, d}  ->  server stamps f='H'  ->  joiner(s)

export interface PeerConn {
  open: boolean;
  onData(cb: (msg: unknown) => void): void;
  onOpen(cb: () => void): void;
  onClose(cb: () => void): void;
  send(msg: unknown): void;
  close(): void;
}

/** ws(s) URL of /signal/<code>/relay on the signaling origin (default = page origin) */
export function relayWsUrl(code: string, base: string): string {
  try {
    const u = new URL(base || location.origin);
    u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:';
    u.pathname = u.pathname.replace(/\/+$/, '') + '/signal/' + encodeURIComponent(code) + '/relay';
    return u.toString();
  } catch {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host +
      '/signal/' + encodeURIComponent(code) + '/relay';
  }
}

const HELLO_OK_MS = 8000;        // give up if the server never arms us after hi
const PING_EVERY_MS = 20000;     // keep NATs/edge proxies from idling the socket
const RETRY_AFTER_MS = 1200;
const INITIAL_TRIES = 3;         // dial attempts before we surface a failure
const MIDMATCH_RETRIES = 4;      // silent reconnects after the relay once worked
const QUEUE_CAP = 256;           // ~10-20 s of gameplay frames while resuming

type Frame = { t?: string; to?: string; d?: unknown };

// ---- joiner side (one socket, everything goes to the host) ----------------

export class RelayConn implements PeerConn {
  open = false;
  private url: string;
  private ws: WebSocket | null = null;
  private dataCb: ((msg: unknown) => void) | null = null;
  private openCbs: (() => void)[] = [];
  private closeCbs: (() => void)[] = [];
  private queue: unknown[] = [];
  private pinger: ReturnType<typeof setInterval> | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private dials = 0;
  private retries = 0;
  private openedOnce = false;
  private closedByGame = false;
  private failed = false;

  constructor(url: string, private hello: Record<string, unknown>) {
    this.url = url;
    this.dial();
  }

  private dial() {
    if (this.failed || this.closedByGame) return;
    this.dials++;
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { return this.lost(); }
    this.ws = ws;
    ws.onopen = () => {
      try { ws.send(JSON.stringify(this.hello)); } catch { return; /* close follows */ }
      if (this.helloTimer) clearTimeout(this.helloTimer);
      this.helloTimer = setTimeout(() => this.lost(), HELLO_OK_MS);
    };
    ws.onmessage = ev => {
      let m: Frame;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'ok') this.armed();
      else if (m.t === 'm') {
        if (this.open && m.d && typeof m.d === 'object') this.dataCb?.(m.d);
      } else if (m.t === 'pong') { /* keepalive */ }
      else if (m.t === 'bye') this.teardown(); // the host is really gone
    };
    ws.onclose = () => this.lost();
    ws.onerror = () => { /* close event follows */ };
  }

  private armed() {
    if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
    this.retries = 0;
    if (this.open) return;
    this.open = true;
    this.openedOnce = true;
    if (!this.pinger) {
      this.pinger = setInterval(() => {
        try { this.ws?.send('{"t":"ping"}'); } catch { /* */ }
      }, PING_EVERY_MS);
    }
    const q = this.queue; this.queue = [];
    for (const x of q) this.send(x);
    this.openCbs.forEach(f => { try { f(); } catch { /* */ } });
  }

  /** socket dropped (or never came up) — reconnect quietly when possible */
  private lost() {
    if (this.failed || this.closedByGame) return;
    if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
    this.stopPinger();
    const wasOpen = this.open;
    this.open = false;
    this.ws = null;
    if (wasOpen) {
      // mid-match drop: stay "open" for the game, refill the socket silently;
      // the 12 Hz snapshot sync heals the brief gap by itself
      if (this.retries >= MIDMATCH_RETRIES) return this.teardown();
      this.retries++;
    } else if (this.openedOnce) {
      return this.teardown();
    } else if (this.dials >= INITIAL_TRIES) {
      return this.teardown();
    }
    setTimeout(() => { if (!this.open) this.dial(); }, RETRY_AFTER_MS);
  }

  private teardown() {
    this.failed = true;
    this.open = false;
    this.stopPinger();
    if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
    this.closeCbs.forEach(f => { try { f(); } catch { /* */ } });
  }

  onData(cb: (msg: unknown) => void) { this.dataCb = cb; }
  onOpen(cb: () => void) { if (this.open) cb(); this.openCbs.push(cb); }
  onClose(cb: () => void) { this.closeCbs.push(cb); }

  send(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.open) {
      try { this.ws.send(JSON.stringify({ t: 'm', to: 'H', d: msg })); } catch { this.queue.push(msg); }
    } else {
      if (this.queue.length < QUEUE_CAP) this.queue.push(msg);
    }
  }

  close() {
    this.closedByGame = true;
    this.open = false;
    this.stopPinger();
    if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
    try { this.ws?.close(); } catch { /* */ }
    this.ws = null;
  }

  private stopPinger() {
    if (this.pinger) { clearInterval(this.pinger); this.pinger = null; }
  }
}

// ---- host side (one shared socket demuxed into a virtual conn per joiner) --

export interface RelayHostHooks {
  onPeer(conn: PeerConn): void;
  onPeerLeave(conn: PeerConn): void;
  onMsg(conn: PeerConn, msg: unknown): void;
}

/** host-side virtual connection for one joiner */
class VConn implements PeerConn {
  open = true;
  private dataCb: ((msg: unknown) => void) | null = null;
  private closeCbs: (() => void)[] = [];

  constructor(public tag: string, private side: RelayHostSide) { }

  onData(cb: (msg: unknown) => void) { this.dataCb = cb; }
  onOpen(cb: () => void) { cb(); } // the path is proven the moment a frame arrives
  onClose(cb: () => void) { this.closeCbs.push(cb); }
  send(msg: unknown) { this.side.sendTo(this.tag, msg); }
  close() { this.side.dropConn(this.tag); }

  /** server reported this peer's socket is gone */
  kill() {
    if (!this.open) return;
    this.open = false;
    this.closeCbs.forEach(f => { try { f(); } catch { /* */ } });
  }
  deliver(msg: unknown) { if (this.open && msg && typeof msg === 'object') this.dataCb?.(msg); }
}

export class RelayHostSide {
  private url: string;
  private ws: WebSocket | null = null;
  private vconns = new Map<string, VConn>();
  private queue: string[] = [];
  private pinger: ReturnType<typeof setInterval> | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private dials = 0;
  private retries = 0;
  private openedOnce = false;
  private closedByGame = false;
  private failed = false;

  constructor(url: string, private hooks: RelayHostHooks) {
    this.url = url;
    this.dial();
  }

  private dial() {
    if (this.failed || this.closedByGame) return;
    this.dials++;
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { return this.lost(); }
    this.ws = ws;
    ws.onopen = () => {
      try { ws.send(JSON.stringify({ t: 'hi', role: 'h' })); } catch { return; }
      if (this.helloTimer) clearTimeout(this.helloTimer);
      this.helloTimer = setTimeout(() => this.lost(), HELLO_OK_MS);
    };
    ws.onmessage = ev => {
      let m: Frame & { f?: string };
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'ok') this.armed();
      else if (m.t === 'm' && m.f) this.deliver(m.f, m.d);
      else if (m.t === 'bye' && m.f) this.peerGone(m.f);
      else if (m.t === 'pong') { /* keepalive */ }
    };
    ws.onclose = () => this.lost();
    ws.onerror = () => { /* close event follows */ };
  }

  private armed() {
    if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
    this.retries = 0;
    if (!this.openedOnce) {
      this.openedOnce = true;
      this.pinger = setInterval(() => {
        try { this.ws?.send('{"t":"ping"}'); } catch { /* */ }
      }, PING_EVERY_MS);
    }
    const q = this.queue; this.queue = [];
    for (const x of q) { try { this.ws?.send(x); } catch { this.queue.push(x); } }
  }

  private deliver(tag: string, d: unknown) {
    let vc = this.vconns.get(tag);
    if (!vc) {
      vc = new VConn(tag, this);
      this.vconns.set(tag, vc);
      this.hooks.onPeer(vc);
    }
    vc.deliver(d);
  }

  private peerGone(tag: string) {
    const vc = this.vconns.get(tag);
    if (!vc) return;
    this.vconns.delete(tag);
    vc.kill();
    this.hooks.onPeerLeave(vc);
  }

  private lost() {
    if (this.failed || this.closedByGame) return;
    if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
    this.stopPinger();
    this.ws = null;
    const wasUp = this.openedOnce;
    if (wasUp) {
      if (this.retries >= MIDMATCH_RETRIES) return this.teardown();
      this.retries++;
    } else if (this.dials >= INITIAL_TRIES) {
      return this.teardown();
    }
    setTimeout(() => { if (!this.ws) this.dial(); }, RETRY_AFTER_MS);
  }

  private teardown() {
    this.failed = true;
    this.stopPinger();
    if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
    // the lobby keeps working over WebRTC if any peers are there; relay peers drop
    for (const [, vc] of this.vconns) vc.kill();
    this.vconns.clear();
  }

  sendTo(tag: string, msg: unknown) {
    const frame = JSON.stringify({ t: 'm', to: tag, d: msg });
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.openedOnce) {
      try { this.ws.send(frame); } catch { if (this.queue.length < QUEUE_CAP) this.queue.push(frame); }
    } else if (this.queue.length < QUEUE_CAP) {
      this.queue.push(frame);
    }
  }

  dropConn(tag: string) {
    this.peerGone(tag);
  }

  close() {
    this.closedByGame = true;
    this.stopPinger();
    if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
    for (const [, vc] of this.vconns) vc.kill();
    this.vconns.clear();
    try { this.ws?.close(); } catch { /* */ }
    this.ws = null;
  }

  private stopPinger() {
    if (this.pinger) { clearInterval(this.pinger); this.pinger = null; }
  }
}
