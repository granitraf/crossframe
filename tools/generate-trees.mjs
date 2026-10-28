// Generates four SVG drawings of ONE tree at four growth stages, in a mid-century ink-illustration style:
// tapered branches with hatched shading, scalloped foliage masses with shading strokes, a sketched ground.
// Every branch's angle/length comes from a hash of its path in the tree, so later stages contain the
// earlier ones: the sapling literally grows into the tree.
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const BASE = process.argv[3] || '#5ba9dd';   // card colour: fills hide lines behind them
const INK = process.argv[4] || '#0b2340';
mkdirSync(OUT, { recursive: true });

// deterministic random from a string
let SEED = process.env.SEED || '7';
function rnd(key) { key = SEED + ':' + key; let h = 2166136261; for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; return (h >>> 0) / 4294967296; }
const R = (key, a, b) => a + (b - a) * rnd(key);
const f = n => +n.toFixed(1);

// growth stages: target height and max width in the 200×200 frame, branching depth, trunk width, foliage size
const STAGES = [
  { h: 58,  maxW: 44,  depth: 0, w: 1.7,  leaf: 'leaves',   cluster: 0 },
  { h: 100, maxW: 96,  depth: 3, w: 3.6,  leaf: 'clusters', cluster: 9 },
  { h: 140, maxW: 150, depth: 4, w: 6.6,  leaf: 'clusters', cluster: 11 },
  { h: 178, maxW: 186, depth: 5, w: 10,   leaf: 'clusters', cluster: 12.5 },
];
const GROUND_Y = 190, CX = 100;

function build(stage) {
  const S = STAGES[stage], segs = [], tips = [];
  // grow at a nominal size; the whole tree is scaled to its stage's frame afterwards
  (function grow(path, d, x, y, ang, len, w) {
    const bend = R(path + 'b', -0.1, 0.1) * len;
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    const cx = (x + ex) / 2 + nx * bend, cy = (y + ey) / 2 + ny * bend;
    const we = w * 0.72;
    segs.push({ path, d, x, y, ex, ey, cx, cy, w, we, ang, len });
    if (d >= S.depth) { tips.push({ x: ex, y: ey, d, path }); return; }
    // a central leader carries on upward; limbs branch off it to either side
    const lean = Math.cos(ang) * -0.12;                                    // limbs curve back toward upright
    const kids = [[0, 0.84, 0.92]];
    kids.push([-R(path + 'sl', 0.55, 0.85), R(path + 'll', 0.68, 0.8), 0.7]);
    kids.push([R(path + 'sr', 0.55, 0.85), R(path + 'lr', 0.68, 0.8), 0.7]);
    if (d >= 2 && rnd(path + 'drop') < 0.45) kids.shift();                // outer twigs fork in two
    kids.forEach(([da, lr, wr], i) => grow(path + i, d + 1, ex, ey, ang + da + lean + R(path + 'j' + i, -0.07, 0.07), len * lr, we * wr));
    if (d >= S.depth - 2) tips.push({ x: ex, y: ey, d, path: path + 'm' });    // foliage through the crown, not only at the tips
  })('t', 0, CX, GROUND_Y, -Math.PI / 2 + R('trunk', -0.03, 0.03), stage === 0 ? 50 : 44, 10);
  // scale to the stage's frame: height and width targets, trunk width set per stage
  const pad = S.cluster * 1.25;
  let minX = CX, maxX = CX, minY = GROUND_Y;
  for (const s of segs) { minX = Math.min(minX, s.ex, s.x); maxX = Math.max(maxX, s.ex, s.x); minY = Math.min(minY, s.ey); }
  for (const t of tips) { minX = Math.min(minX, t.x - pad); maxX = Math.max(maxX, t.x + pad); minY = Math.min(minY, t.y - pad); }
  const k = Math.min(S.h / (GROUND_Y - minY), S.maxW / Math.max(1, maxX - minX));
  const wk = S.w / 10;
  const sx = v => CX + (v - CX) * k, sy = v => GROUND_Y + (v - GROUND_Y) * k;
  for (const s of segs) { s.x = sx(s.x); s.ex = sx(s.ex); s.cx = sx(s.cx); s.y = sy(s.y); s.ey = sy(s.ey); s.cy = sy(s.cy); s.len *= k; s.w = Math.max(0.6, s.w * wk); s.we = Math.max(0.5, s.we * wk); }
  for (const t of tips) { t.x = sx(t.x); t.y = sy(t.y); }
  return { segs, tips, S };
}

function branchPath(s) {
  const nx = -Math.sin(s.ang), ny = Math.cos(s.ang);
  const a = [s.x + nx * s.w / 2, s.y + ny * s.w / 2], b = [s.ex + nx * s.we / 2, s.ey + ny * s.we / 2];
  const c = [s.ex - nx * s.we / 2, s.ey - ny * s.we / 2], d = [s.x - nx * s.w / 2, s.y - ny * s.w / 2];
  const k1 = [s.cx + nx * (s.w + s.we) / 4, s.cy + ny * (s.w + s.we) / 4], k2 = [s.cx - nx * (s.w + s.we) / 4, s.cy - ny * (s.w + s.we) / 4];
  return `M${f(a[0])} ${f(a[1])}Q${f(k1[0])} ${f(k1[1])} ${f(b[0])} ${f(b[1])}L${f(c[0])} ${f(c[1])}Q${f(k2[0])} ${f(k2[1])} ${f(d[0])} ${f(d[1])}Z`;
}
// hatching on the shaded (right-hand) side of thicker branches
function hatches(s) {
  if (s.w < 2.4) return '';
  const nx = -Math.sin(s.ang), ny = Math.cos(s.ang), out = [], n = Math.floor(s.len / 2.1);
  for (let i = 1; i < n; i++) {
    const t = i / n, w = s.w + (s.we - s.w) * t;
    const px = (1 - t) * (1 - t) * s.x + 2 * (1 - t) * t * s.cx + t * t * s.ex, py = (1 - t) * (1 - t) * s.y + 2 * (1 - t) * t * s.cy + t * t * s.ey;
    const side = -1;                                   // light from the upper left: shade the right edge
    const x1 = px + nx * side * w * 0.48, y1 = py + ny * side * w * 0.48;
    const reach = w * R(s.path + 'h' + i, 0.28, 0.5);
    const x2 = x1 - nx * side * reach + Math.cos(s.ang) * 0.6, y2 = y1 - ny * side * reach + Math.sin(s.ang) * 0.6;
    out.push(`M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`);
  }
  // a couple of bark lines down the thick trunk
  if (s.d === 0 && s.w > 6) for (let k = 0; k < 3; k++) {
    const off = R('bark' + k, -0.25, 0.15) * s.w, t0 = R('bt' + k, 0.05, 0.3), t1 = R('bu' + k, 0.6, 0.95);
    const p = t => [s.x + (s.ex - s.x) * t + nx * off, s.y + (s.ey - s.y) * t + ny * off];
    const [a, b] = [p(t0), p(t1)]; out.push(`M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`);
  }
  return out.join('');
}
function scallop(x, y, r, key) {
  const n = 8 + Math.floor(rnd(key) * 4), pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rnd(key + 'r') * 6, rr = r * R(key + 'q' + i, 0.82, 1.05); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.86, a]); }
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n], am = (p[2] + q[2]) / 2 + (i === n - 1 ? Math.PI : 0), bump = r * R(key + 'u' + i, 1.18, 1.32);
    const cx = x + Math.cos(am) * bump, cy = y + Math.sin(am) * bump * 0.86;
    d += `Q${f(cx)} ${f(cy)} ${f(q[0])} ${f(q[1])}`;
  }
  return d + 'Z';
}
function clusterShade(x, y, r, key) {   // short curved strokes in the lower right of each foliage mass
  const out = [], n = 3 + Math.floor(rnd(key + 'n') * 3);
  for (let i = 0; i < n; i++) {
    const a = R(key + 'a' + i, 0.1, 1.5), rr = r * R(key + 'd' + i, 0.35, 0.78);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.86, len = r * 0.32;
    out.push(`M${f(px - len / 2)} ${f(py)}q${f(len / 2)} ${f(len * 0.32)} ${f(len)} 0`);
  }
  return out.join('');
}
function leaf(x, y, ang, s) {
  const tx = x + Math.cos(ang) * s, ty = y + Math.sin(ang) * s, nx = -Math.sin(ang) * s * 0.36, ny = Math.cos(ang) * s * 0.36;
  const mx = (x + tx) / 2, my = (y + ty) / 2;
  return `M${f(x)} ${f(y)}Q${f(mx + nx)} ${f(my + ny)} ${f(tx)} ${f(ty)}Q${f(mx - nx)} ${f(my - ny)} ${f(x)} ${f(y)}ZM${f(x)} ${f(y)}L${f(mx)} ${f(my)}`;
}
function ground(stage) {
  const gw = [26, 42, 60, 76][stage], out = [], y = GROUND_Y;
  out.push(`M${CX - gw} ${y + 0.6}Q${CX - gw / 2} ${y - 0.8} ${CX} ${y}T${CX + gw} ${y + 0.4}`);
  for (let i = 0; i < 5 + stage * 3; i++) {                                    // dashes of earth below
    const x = CX - gw * 0.9 + R('g' + stage + i, 0, gw * 1.8), yy = y + R('gy' + i, 2, 6), l = R('gl' + i, 3, 8);
    out.push(`M${f(x)} ${f(yy)}h${f(l)}`);
  }
  for (let i = 0; i < 4 + stage * 3; i++) {                                    // grass tufts
    const x = CX - gw + R('t' + stage + i, 0, gw * 2); if (Math.abs(x - CX) < [2, 4, 7, 9][stage]) continue;
    const hgt = R('th' + i, 2.5, 5);
    out.push(`M${f(x - 1.2)} ${y}l${f(0.4)} ${f(-hgt)}M${f(x)} ${y}l${f(0.6)} ${f(-hgt * 1.2)}M${f(x + 1.2)} ${y}l${f(0.9)} ${f(-hgt * 0.8)}`);
  }
  return out.join('');
}
function roots(stage, w) {
  if (stage < 2) return '';
  const out = [];
  for (const [dx, k] of [[-1, 'a'], [1, 'b'], [-0.4, 'c'], [0.55, 'd']]) {
    const sx = CX + dx * w * 0.45, ex = CX + dx * w * R('r' + k, 1.1, 1.6);
    out.push(`M${f(sx)} ${GROUND_Y - w * 0.5}Q${f(sx + dx * 2)} ${GROUND_Y - 0.5} ${f(ex)} ${GROUND_Y + 0.6}`);
  }
  return out.join('');
}

for (let st = 0; st < 4; st++) {
  const { segs, tips, S } = build(st);
  let body = '';
  // branches, trunk first so children draw over their joints
  for (const s of segs) body += `<path d="${branchPath(s)}" fill="${BASE}"/>`;
  let hatch = segs.map(hatches).join('') + roots(st, S.w);
  // foliage
  let fol = '', folShade = '';
  if (S.leaf === 'leaves') {
    const s = segs[0], at = q => [(1 - q) * (1 - q) * s.x + 2 * (1 - q) * q * s.cx + q * q * s.ex, (1 - q) * (1 - q) * s.y + 2 * (1 - q) * q * s.cy + q * q * s.ey];
    for (const [q, side, size] of [[0.38, -1, 6], [0.55, 1, 7], [0.72, -1, 7.5], [0.86, 1, 7.5]]) { const [x, y] = at(q); fol += `<path d="${leaf(x, y, -Math.PI / 2 + side * 0.95, size)}" fill="${BASE}"/>`; }
    for (const a of [-0.45, 0.45]) fol += `<path d="${leaf(s.ex, s.ey, -Math.PI / 2 + a, 8)}" fill="${BASE}"/>`;
  } else {
    const cl = tips.map((t, i) => ({ x: t.x + R(t.path + 'cx', -2, 2), y: t.y + R(t.path + 'cy', -2, 1), r: S.cluster * R(t.path + 'cr', 0.75, 1.15), key: t.path })).sort((a, b) => a.y - b.y);
    // each mass's shading is drawn right after the mass, so masses in front hide the shading behind them
    for (const c of cl) fol += `<path d="${scallop(c.x, c.y, c.r, c.key)}" fill="${BASE}"/><path d="${clusterShade(c.x, c.y, c.r, c.key)}" stroke-width="0.7"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke-width="1.05" vector-effect="non-scaling-stroke">${body}</g>` +
    `<path d="${hatch}" stroke-width="0.7" vector-effect="non-scaling-stroke"/>` +
    `<g stroke-width="1" vector-effect="non-scaling-stroke">${fol}</g>` +
    `<path d="${folShade}" stroke-width="0.7" vector-effect="non-scaling-stroke"/>` +
    `<path d="${ground(st)}" stroke-width="0.9" vector-effect="non-scaling-stroke"/></svg>`;
  // vector-effect on groups is not inherited: apply it per path
  const fixed = svg.replace(/<path /g, '<path vector-effect="non-scaling-stroke" ').replace(/ vector-effect="non-scaling-stroke"(?=[^<]*vector-effect)/g, '');
  if (st === 3) { const xs = tips.map(t => t.x), ys = tips.map(t => t.y); const cxm = xs.reduce((a, b) => a + b, 0) / xs.length;
    const left = Math.min(...xs), right = Math.max(...xs); globalThis.BAL = { off: Math.abs(cxm - CX), sym: Math.abs((CX - left) - (right - CX)), top: Math.min(...ys) }; }
  if (!process.env.DRY) writeFileSync(`${OUT}/tree-${st + 1}.svg`, fixed);
  if (!process.env.DRY) console.log(`tree-${st + 1}.svg`, segs.length, 'branches', tips.length, 'tips', (fixed.length / 1024).toFixed(1) + ' KB');
}

if (process.env.DRY) console.log(JSON.stringify({ seed: SEED, ...globalThis.BAL }));
