// NEON STRIKE 3D - P2P networking over PeerJS (host authoritative, works on static hosting)
import Peer, { DataConnection } from 'peerjs';
import { NET_PREFIX, makeRoomCode, ClientMsg, HostMsg } from './constants';

export interface HostHooks {
  onOpen(code: string): void;
  onPeerJoin(conn: DataConnection): void;
  onPeerLeave(conn: DataConnection): void;
  onMsg(conn: DataConnection, msg: ClientMsg): void;
  onError(err: string): void;
}

export interface ClientHooks {
  onOpen(): void;
  onMsg(msg: HostMsg): void;
  onError(err: string): void;
  onClosed(): void;
}

export class NetHost {
  peer: Peer | null = null;
  code = '';
  conns: DataConnection[] = [];
  private retried = false;

  constructor(private hooks: HostHooks) {}

  start() {
    this.code = makeRoomCode();
    const peer = new Peer(NET_PREFIX + this.code, { debug: 1 });
    this.peer = peer;
    peer.on('open', () => this.hooks.onOpen(this.code));
    peer.on('connection', conn => {
      this.conns.push(conn);
      conn.on('open', () => this.hooks.onPeerJoin(conn));
      conn.on('data', (d) => this.hooks.onMsg(conn, d as ClientMsg));
      conn.on('close', () => {
        this.conns = this.conns.filter(c => c !== conn);
        this.hooks.onPeerLeave(conn);
      });
      conn.on('error', () => {
        this.conns = this.conns.filter(c => c !== conn);
        this.hooks.onPeerLeave(conn);
      });
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && !this.retried) {
        this.retried = true;
        try { peer.destroy(); } catch { /* */ }
        this.start();
        return;
      }
      this.hooks.onError(peerErrorText(err));
    });
  }

  broadcast(msg: HostMsg, except?: DataConnection) {
    for (const c of this.conns) {
      if (c === except) continue;
      if (c.open) try { c.send(msg); } catch { /* ignore */ }
    }
  }

  send(conn: DataConnection, msg: HostMsg) {
    if (conn.open) try { conn.send(msg); } catch { /* ignore */ }
  }

  destroy() {
    this.conns.forEach(c => { try { c.close(); } catch { /* */ } });
    this.conns = [];
    try { this.peer?.destroy(); } catch { /* */ }
    this.peer = null;
  }
}

export class NetClient {
  peer: Peer | null = null;
  conn: DataConnection | null = null;

  constructor(private hooks: ClientHooks) {}

  connect(code: string) {
    const peer = new Peer({ debug: 1 });
    this.peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(NET_PREFIX + code.toUpperCase().trim(), { reliable: true });
      this.conn = conn;
      conn.on('open', () => this.hooks.onOpen());
      conn.on('data', (d) => this.hooks.onMsg(d as HostMsg));
      conn.on('close', () => this.hooks.onClosed());
      conn.on('error', (err) => this.hooks.onError(peerErrorText(err)));
    });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        this.hooks.onError('Match not found. Check the room code.');
      } else {
        this.hooks.onError(peerErrorText(err));
      }
    });
  }

  send(msg: ClientMsg) {
    if (this.conn?.open) try { this.conn.send(msg); } catch { /* ignore */ }
  }

  destroy() {
    try { this.conn?.close(); } catch { /* */ }
    try { this.peer?.destroy(); } catch { /* */ }
    this.conn = null; this.peer = null;
  }
}

function peerErrorText(err: { type?: string; message?: string }): string {
  switch (err.type) {
    case 'network': return 'Network error — check your internet connection.';
    case 'peer-unavailable': return 'Match not found. Check the room code.';
    case 'unavailable-id': return 'Room code taken, try again.';
    case 'browser-incompatible': return 'Your browser does not support WebRTC.';
    case 'disconnected': return 'Disconnected from signaling server.';
    default: return err.message || 'Connection error.';
  }
}
