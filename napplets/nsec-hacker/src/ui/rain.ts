/**
 * Matrix rain.
 *
 * Owns its own rAF loop rather than riding the GSAP timeline, so it can idle
 * quietly between runs and surge while mining. The glyphs it drops are real
 * candidate pubkey characters handed over by the miner -- see `feed`.
 */

const IDLE_ALPHA = 0.35;
const MINING_ALPHA = 1;
const FALLBACK_GLYPHS = '0123456789abcdef';

export interface Rain {
  /** Push real candidate hex in; the rain drops these characters. */
  feed(samples: string[]): void;
  setMining(mining: boolean): void;
  resize(): void;
  stop(): void;
}

export function createRain(canvas: HTMLCanvasElement): Rain {
  const context = canvas.getContext('2d');
  let glyphs = FALLBACK_GLYPHS;
  let columns: number[] = [];
  let cellSize = 14;
  let mining = false;
  let alpha = IDLE_ALPHA;
  let frame = 0;
  let raf = 0;

  function resize(): void {
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);

    cellSize = Math.max(10, Math.min(18, Math.round(width / 48)));
    const count = Math.max(1, Math.ceil(width / cellSize));
    columns = Array.from({ length: count }, (_, i) => columns[i] ?? Math.random() * -40);
    columns.length = count;
  }

  function draw(): void {
    raf = requestAnimationFrame(draw);
    if (!context) return;

    // Two frames of trail per drawn frame keeps the fade cheap at any size.
    frame += 1;
    if (frame % 2 !== 0) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const target = mining ? MINING_ALPHA : IDLE_ALPHA;
    alpha += (target - alpha) * 0.05;

    context.fillStyle = 'rgba(1, 7, 4, 0.16)';
    context.fillRect(0, 0, width, height);
    context.font = `${cellSize}px ui-monospace, monospace`;
    context.textBaseline = 'top';

    const rows = height / cellSize;
    for (let i = 0; i < columns.length; i += 1) {
      const y = columns[i] ?? 0;
      const glyph = glyphs[Math.floor(Math.random() * glyphs.length)] ?? '0';

      context.fillStyle = `rgba(56, 255, 156, ${(0.85 * alpha).toFixed(3)})`;
      context.fillText(glyph, i * cellSize, y * cellSize);

      // Head of the drop is brighter than its tail.
      context.fillStyle = `rgba(224, 255, 238, ${(0.5 * alpha).toFixed(3)})`;
      context.fillText(glyph, i * cellSize, y * cellSize);

      const speed = mining ? 1.1 : 0.45;
      const next = y + speed;
      columns[i] = next > rows && Math.random() > 0.975 ? 0 : next;
    }
  }

  resize();
  raf = requestAnimationFrame(draw);

  return {
    feed(samples) {
      const joined = samples.join('');
      if (joined.length > 0) glyphs = joined;
    },
    setMining(next) {
      mining = next;
    },
    resize,
    stop() {
      cancelAnimationFrame(raf);
    },
  };
}
