/**
 * QR labels: Royal Mail and InPost both offer a printerless option where the seller
 * shows a QR code at the counter. Some counters will still take a printed one, and
 * it saves fumbling with a phone. This turns a code or a link into a label page.
 */

import QRCode from 'qrcode';

import { imagePage, type PageSource } from './source.js';

const PX_PER_MM = 12;

export async function qrPage(content: string, caption: string, widthMm: number, heightMm: number): Promise<PageSource> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthMm * PX_PER_MM);
  canvas.height = Math.round(heightMm * PX_PER_MM);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const margin = 8 * PX_PER_MM;
  const side = Math.min(canvas.width, canvas.height) - 2 * margin;
  const code = document.createElement('canvas');
  await QRCode.toCanvas(code, content, { errorCorrectionLevel: 'M', margin: 0, width: side });
  const top = caption ? margin : (canvas.height - side) / 2;
  ctx.drawImage(code, (canvas.width - side) / 2, top, side, side);

  if (caption) {
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${6 * PX_PER_MM}px system-ui, sans-serif`;
    const lines = wrap(ctx, caption, canvas.width - 2 * margin);
    lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, top + side + (6 + i * 8) * PX_PER_MM));
  }

  const label = caption.trim() || content.trim();
  return imagePage(`QR: ${label.length > 40 ? `${label.slice(0, 39)}…` : label}`, canvas, widthMm, heightMm);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}
