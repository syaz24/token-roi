'use client';

import * as React from 'react';
import { Download, Share2, X } from 'lucide-react';
import { Button, cn } from './ui';
import { compactNumber, money, shortDate } from '@/lib/format';

export interface ShareableStats {
  tokens: number;
  sessions: number;
  requests: number;
  apiCost: number;
  cacheHitRate: number;
  from: string;
  to: string;
}

/**
 * Renders a shareable stats card and exports it as a PNG.
 *
 * Drawn with the Canvas API on this machine — no image service, no upload, and
 * nothing leaves the device. The download only happens when you click it, and
 * the card deliberately carries no project names or prompt text.
 */
export function ShareStats({ stats, headline }: { stats: ShareableStats; headline: string | null }) {
  const [open, setOpen] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const el = canvasRef.current;
    if (!el) return;

    const W = 1000;
    const H = 560;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = W * dpr;
    el.height = H * dpr;
    el.style.width = '100%';
    el.style.height = 'auto';

    const g = el.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);

    // Backdrop
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#101622');
    bg.addColorStop(0.55, '#0b0e16');
    bg.addColorStop(1, '#08080c');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    const glow = g.createRadialGradient(W * 0.78, -60, 40, W * 0.78, -60, 520);
    glow.addColorStop(0, 'rgba(167,139,250,0.22)');
    glow.addColorStop(1, 'rgba(167,139,250,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);

    // Dot grid
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 28; x < W; x += 26) {
      for (let y = 28; y < H; y += 26) g.fillRect(x, y, 1, 1);
    }

    const sans =
      '"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, -apple-system, sans-serif';

    g.fillStyle = '#F4F4F5';
    g.font = `600 40px ${sans}`;
    g.fillText('My AI coding stats', 56, 92);

    g.fillStyle = '#71717A';
    g.font = `400 19px ${sans}`;
    g.fillText(`${shortDate(stats.from)} → ${shortDate(stats.to)}`, 56, 124);

    if (headline) {
      g.fillStyle = '#FBBF24';
      g.font = `500 20px ${sans}`;
      g.fillText(truncate(g, headline, W - 112), 56, 160);
    }

    const cards: Array<[string, string]> = [
      ['TOTAL TOKENS', compactNumber(stats.tokens)],
      ['CONVERSATIONS', compactNumber(stats.sessions, 0)],
      ['CACHE HIT RATE', `${Math.round(stats.cacheHitRate * 100)}%`],
      ['API-EQUIVALENT COST', money(stats.apiCost)],
    ];

    const cw = (W - 112 - 24) / 2;
    const ch = 132;
    cards.forEach(([label, value], i) => {
      const x = 56 + (i % 2) * (cw + 24);
      const y = 196 + Math.floor(i / 2) * (ch + 20);
      roundRect(g, x, y, cw, ch, 14);
      g.fillStyle = 'rgba(255,255,255,0.045)';
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.10)';
      g.lineWidth = 1;
      g.stroke();

      g.fillStyle = '#A1A1AA';
      g.font = `500 14px ${sans}`;
      g.fillText(label, x + 24, y + 38);

      g.fillStyle = '#F4F4F5';
      g.font = `600 46px ${sans}`;
      g.fillText(value, x + 24, y + 96);
    });

    g.fillStyle = '#52525B';
    g.font = `400 15px ${sans}`;
    g.fillText('Measured locally with Project Token ROI', 56, H - 34);
    g.textAlign = 'right';
    g.fillText('npx token-roi', W - 56, H - 34);
    g.textAlign = 'left';
  }, [open, stats, headline]);

  function download() {
    const el = canvasRef.current;
    if (!el) return;
    const a = document.createElement('a');
    a.download = `token-roi-stats-${new Date().toISOString().slice(0, 10)}.png`;
    a.href = el.toDataURL('image/png');
    a.click();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Share2 size={11} />
        Share stats
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="panel w-full max-w-[720px] p-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Share your stats"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-semibold text-ink">Share your stats</h2>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink3">
                  Drawn on this machine and downloaded straight to your disk. No project names, folder paths
                  or prompt text are included, and nothing is uploaded anywhere.
                </p>
              </div>
              <Button variant="ghost" onClick={() => setOpen(false)} aria-label="Close">
                <X size={12} />
              </Button>
            </div>

            <canvas ref={canvasRef} className="w-full rounded-lg border border-hair" />

            <div className="mt-3 flex justify-end gap-1.5">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={download}>
                <Download size={11} />
                Download PNG
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function truncate(g: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (g.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 4 && g.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}
