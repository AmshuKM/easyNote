// Export: PNG (browser) and a dependency-free vector PDF (buildPDF is pure). Graph cards are not exported.
import { bbox } from '../core/geom.js';
import { drawScene, strokeOutline } from '../canvas/render.js';

const MARGIN = 16, PAPER = { light: '#ffffff', dark: '#1c1e24' }; // PAPER matches --paper in css/app.css

export const inkStrokes = (doc) => [...doc.strokes.values(), ...[...doc.answers.values()].flatMap((a) => a.strokes ?? [])];

// World box around all ink (stroke width and a margin included), or null for an empty page.
export function inkBox(strokes) {
  const pts = strokes.flatMap((s) => s.pts);
  if (!pts.length) return null;
  const b = bbox(pts), pad = Math.max(...strokes.map((s) => s.width)) / 2 + MARGIN;
  return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
}

// theme: makeTheme(dark, paper). 2x, or less so the longest side stays within 8192 px.
export async function exportPNG(doc, theme) {
  const box = inkBox(inkStrokes(doc));
  if (!box) return null;
  const k = Math.min(2, 8192 / Math.max(box.w, box.h));
  const c = document.createElement('canvas');
  c.width = Math.ceil(box.w * k); c.height = Math.ceil(box.h * k);
  const ctx = c.getContext('2d');
  drawScene(ctx, doc, { x: -box.x * k, y: -box.y * k, scale: k }, theme, 1);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = theme.dark ? PAPER.dark : PAPER.light;
  ctx.fillRect(0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

// Always light (white page, original ink colours): it is for print. Highlighters first, as on screen.
export function exportPDF(doc) {
  const strokes = inkStrokes(doc), box = inkBox(strokes);
  if (!box) return null;
  const hl = (s) => s.tool === 'highlighter';
  const paths = [...strokes.filter(hl), ...strokes.filter((s) => !hl(s))].map((s) => ({
    pts: strokeOutline(s).map(([x, y]) => [x - box.x, y - box.y]), color: s.color, alpha: hl(s) ? 0.35 : 1,
  }));
  return buildPDF(paths, box);
}

const n = (v) => +v.toFixed(2);
const rgb = (hex) => [1, 3, 5].map((i) => n(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');

// paths: [{pts: [[x, y]...] closed outline in top-left coordinates, color: '#rrggbb', alpha = 1}], each filled.
// The stroke width is already in the outline. Page is w x h points; returns the file bytes.
export function buildPDF(paths, { w, h }) {
  const alphas = [...new Set(paths.map((p) => p.alpha ?? 1))];
  let content = `1 0 0 -1 0 ${n(h)} cm\n`; // y down, like the canvas
  for (const p of paths) {
    if (!p.pts.length) continue;
    content += `q /A${alphas.indexOf(p.alpha ?? 1)} gs ${rgb(p.color)} rg\n`;
    content += p.pts.map(([x, y], i) => `${n(x)} ${n(y)} ${i ? 'l' : 'm'}\n`).join('');
    content += 'h\nf\nQ\n';
  }
  const gs = alphas.map((a, i) => `/A${i} << /ca ${a} >>`).join(' ');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(w)} ${n(h)}] /Contents 4 0 R /Resources << /ExtGState << ${gs} >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out); // ASCII only, so string length = byte length
}
