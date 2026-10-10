// DESERT STRIKE 3D - local WiFi multiplayer transport (Android app Kotlin bridge)
// Host side: Kotlin WebSocket server + NSD discovery. Client side: plain WebSocket.
// In a normal browser (no AndroidBridge) LAN features are simply unavailable.
import { ClientMsg, HostMsg } from './constants';

export interface LanConn {
  peer: string;
  open: boolean;
  send(msg: unknown): void;
  close(): void;
  /** bridge connection id */
  __id: string;
}

export interface LanHostHooks {
  onOpen(code: string): void;
  onPeerJoin(conn: LanConn): void;
  onPeerLeave(conn: LanConn): void;
  onMsg(conn: LanConn, msg: ClientMsg): void;
  onError(err: string): void;
}

interface AndroidBridge {
  vibrate(ms: number): void;
  lanHostStart(): string;
  lanHostStop(): void;
  lanSendTo(id: string, msg: string): void;
  lanBroadcast(msg: string): void;
  lanDrop(id: string): void;
  lanDiscover(): string;
  lanStopDiscover(): void;
}

export function androidBridge(): AndroidBridge | null {
  const b = (window as unknown as { AndroidBridge?: AndroidBridge }).AndroidBridge;
  return b && typeof b.lanHostStart === 'function' ? b : null;
}
/** true only inside the Android app (Kotlin bridge present) */
export function hasLan(): boolean { return !!androidBridge(); }

// ---------- Kotlin -> JS event pipe ----------
export type LanEvt =
  | { t: 'open'; port: number }
  | { t: 'join'; id: string }
  | { t: 'data'; id: string; msg: string }
  | { t: 'leave'; id: string }
  | { t: 'found'; name: string; host: string; port: number }
  | { t: 'discover-done' }
  | { t: 'error'; err: string };

const listeners = new Set<(e: LanEvt) => void>();
function installEventHook() {
  const w = window as unknown as { __LAN_EVENT__?: (json: string) => void };
  if (w.__LAN_EVENT__) return;
  w.__LAN_EVENT__ = (json: string) => {
    try {
      const e = JSON.parse(json) as LanEvt;
      listeners.forEach(fn => { try { fn(e); } catch { /* */ } });
    } catch { /* bad json from bridge — ignore */ }
  };
}
export function onLanEvent(fn: (e: LanEvt) => void): () => void {
  installEventHook();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ---------- host (Kotlin WS server behind the scenes) ----------
export class LanHost {
  code = 'WIFI';
  conns: LanConn[] = [];
  private off: (() => void) | null = null;
  private byId = new Map<string, LanConn>();

  constructor(private hooks: LanHostHooks) {}

  start() {
    const b = androidBridge();
    if (!b) { this.hooks.onError('Local WiFi mode needs the Android app.'); return; }
    this.off = onLanEvent(e => {
      switch (e.t) {
        case 'open':
          this.code = 'WIFI';
          this.hooks.onOpen(this.code);
          break;
        case 'join': {
          const id = String(e.id);
          const conn: LanConn = {
            peer: 'lan-' + id,
            open: true,
            __id: id,
            send: (m) => { try { b.lanSendTo(id, typeof m === 'string' ? m : JSON.stringify(m)); } catch { /* */ } },
            close: () => { try { b.lanDrop(id); } catch { /* */ } },
          };
          this.byId.set(id, conn);
          this.conns.push(conn);
          this.hooks.onPeerJoin(conn);
          break;
        }
        case 'data': {
          const conn = this.byId.get(String(e.id));
          if (!conn) return;
          try {
            const msg = (typeof e.msg === 'string' ? JSON.parse(e.msg) : e.msg) as ClientMsg;
            this.hooks.onMsg(conn, msg);
          } catch { /* malformed — ignore */ }
          break;
        }
        case 'leave': {
          const id = String(e.id);
          const conn = this.byId.get(id);
          if (conn) {
            conn.open = false;
            this.conns = this.conns.filter(c => c !== conn);
            this.byId.delete(id);
            this.hooks.onPeerLeave(conn);
          }
          break;
        }
        case 'error':
          this.hooks.onError(String(e.err ?? 'LAN error'));
          break;
        default:
          break;
      }
    });
    let res: { ok: boolean; port?: number; err?: string };
    try { res = JSON.parse(b.lanHostStart()); } catch { res = { ok: false, err: 'Bridge error.' }; }
    if (!res.ok) {
      this.hooks.onError(res.err || 'Could not start the local server.');
      this.off?.(); this.off = null;
    }
  }

  broadcast(msg: HostMsg, except?: LanConn) {
    const b = androidBridge(); if (!b) return;
    const raw = JSON.stringify(msg);
    for (const c of this.conns) {
      if (c === except) continue;
      try { b.lanSendTo(c.__id, raw); } catch { /* */ }
    }
  }

  send(conn: LanConn, msg: HostMsg) {
    const b = androidBridge(); if (!b) return;
    try { b.lanSendTo(conn.__id, JSON.stringify(msg)); } catch { /* */ }
  }

  destroy() {
    this.off?.(); this.off = null;
    this.conns = [];
    this.byId.clear();
    try { androidBridge()?.lanHostStop(); } catch { /* */ }
  }
}

// ---------- client (direct WebSocket to the host phone) ----------
export class LanClient {
  private ws: WebSocket | null = null;

  constructor(private hooks: { onOpen(): void; onMsg(msg: HostMsg): void; onError(err: string): void; onClosed(): void }) {}

  connect(url: string) {
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { this.hooks.onError('Invalid host address.'); return; }
    this.ws = ws;
    ws.onopen = () => this.hooks.onOpen();
    ws.onmessage = (ev) => {
      try { this.hooks.onMsg(JSON.parse(String(ev.data)) as HostMsg); } catch { /* */ }
    };
    ws.onerror = () => { /* close event follows with the real signal */ };
    ws.onclose = () => this.hooks.onClosed();
  }

  get open(): boolean { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  send(msg: ClientMsg) {
    if (this.open) try { this.ws!.send(JSON.stringify(msg)); } catch { /* */ }
  }

  destroy() {
    try { this.ws?.close(); } catch { /* */ }
    this.ws = null;
  }
}

// ---------- NSD discovery helper ----------
export function lanScan(
  onFound: (h: { name: string; url: string }) => void,
  onDone: () => void,
): () => void {
  const b = androidBridge();
  if (!b) { onDone(); return () => { /* */ }; }
  const seen = new Set<string>();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    off();
    try { b.lanStopDiscover(); } catch { /* */ }
    onDone();
  };
  const off = onLanEvent(e => {
    if (done) return;
    if (e.t === 'found') {
      const host = String(e.host);
      const port = String(e.port);
      const name = String(e.name ?? 'Player');
      const key = host + ':' + port;
      if (host && port && !seen.has(key)) {
        seen.add(key);
        onFound({ name, url: 'ws://' + key });
      }
    } else if (e.t === 'discover-done') {
      finish();
    }
  });
  const timer = setTimeout(finish, 7000); // hard cap: NSD may never report done on some devices
  try { b.lanDiscover(); } catch { finish(); }
  return finish;
}
