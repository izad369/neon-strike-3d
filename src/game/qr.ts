// DESERT STRIKE 3D — QR code drawing (qrcode-generator, MIT)
import qrcode from 'qrcode-generator';

/** draw `text` as a QR code onto a square canvas (dark modules on light bg) */
export function drawQr(canvas: HTMLCanvasElement, text: string, size = 460) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 3;
    const cells = n + quiet * 2;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f3e9cf';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#171410';
    const cs = size / cells;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) {
          // slight overlap (+0.4) keeps anti-aliasing gaps closed on hi-dpi
          ctx.fillRect(Math.floor((c + quiet) * cs), Math.floor((r + quiet) * cs),
            Math.ceil(cs) + 0.4, Math.ceil(cs) + 0.4);
        }
      }
    }
    canvas.dataset.qr = '1';
  } catch {
    // payload too large or canvas unavailable — caller shows the paste code instead
    canvas.dataset.qr = '0';
  }
}
