// DESERT STRIKE 3D — shared WebRTC handshake helpers.
// Used by BOTH signaling transports (net.ts REST mailbox + mqtt.ts public
// relay) so the ICE setup can never drift between them.
export const DATA_CHANNEL = 'ns3d';

// Public STUN so peers behind different NATs can find each other.
// Cloudflare STUN lives on the same edge as the game itself (reachable
// wherever the page loads); Google STUN stays as a backup.
// v3.9.2 — added free public TURN relay (metered.ca OpenRelay) so peers on
// UDP-restricted networks (mobile carriers, censoring ISPs) can still
// connect: TURN/TCP 443 traverses almost every firewall. One side relaying
// is enough for the pair to connect.
export const NS_ICE: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
    {
      urls: [
        'turn:openrelay.metered.ca:80?transport=udp',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

/** resolve after ICE gathering finishes (or timeout — keep the handshake snappy) */
export function gatherComplete(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(res => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', on); clearTimeout(t); res(); };
    const on = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', on);
  });
}
