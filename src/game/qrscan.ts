// DESERT STRIKE 3D — camera QR scanning (jsQR, Apache-2.0)
import jsQR from 'jsqr';

export class QrScanner {
  private stream: MediaStream | null = null;
  private raf = 0;
  private running = false;
  private video: HTMLVideoElement | null = null;

  static supported(): boolean {
    return !!(navigator.mediaDevices?.getUserMedia);
  }

  /** start the rear camera; first decoded QR payload stops the scanner */
  async start(video: HTMLVideoElement, onText: (t: string) => void, onErr: (msg: string) => void) {
    this.stop();
    if (!QrScanner.supported()) {
      onErr('Camera not available here — paste the code instead.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      const name = (e as Error)?.name || '';
      onErr(name === 'NotAllowedError'
        ? 'Camera permission denied — paste the code instead.'
        : 'Camera unavailable — paste the code instead.');
      return;
    }
    this.video = video;
    video.srcObject = this.stream;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    try { await video.play(); } catch { /* autoplay policies — frame loop still runs */ }
    this.running = true;
    const scanCanvas = document.createElement('canvas');
    const ctx = scanCanvas.getContext('2d', { willReadFrequently: true });
    let lastTry = 0;
    const tick = (now: number) => {
      if (!this.running) return;
      // throttle decode to ~10 fps — plenty for QR, saves battery
      if (now - lastTry > 100 && ctx && video.readyState >= 2 && video.videoWidth > 0) {
        lastTry = now;
        scanCanvas.width = video.videoWidth;
        scanCanvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const img = ctx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
        const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (found && found.data) {
          this.stop();
          onText(found.data);
          return;
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.video) { try { this.video.srcObject = null; } catch { /* */ } this.video = null; }
  }
}
