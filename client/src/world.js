/* Deterministic island world + Wang corner autotiling from the PixelLab tileset
   metadata. Same seed → same map on every client. */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// smooth value noise on a hashed lattice
function valueNoise(seed) {
  const rnd = mulberry32(seed);
  const grid = {};
  const at = (x, y) => {
    const k = x + "," + y;
    if (grid[k] === undefined) grid[k] = mulberry32(((x * 73856093) ^ (y * 19349663) ^ seed) >>> 0)();
    return grid[k];
  };
  void rnd;
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };
}

// 5×7 pixel font for the LAGZONE landmark island
const FONT = {
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
};

/** Stamp a word as crisp grass tiles (water moat + gaps) directly into the tile grid. */
function stampWord(tiles, W, H, allGrass, allWater, word, centerX, topY, sc) {
  const lw = 5 * sc, lh = 7 * sc, gap = sc * 2;
  const totalW = word.length * lw + (word.length - 1) * gap;
  const sx = Math.round(centerX - totalW / 2);
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) tiles[y * W + x] = v; };
  for (let y = topY - 2; y < topY + lh + 2; y++) for (let x = sx - 2; x < sx + totalW + 2; x++) set(x, y, allWater);
  let ox = sx;
  for (const ch of word) {
    const g = FONT[ch];
    if (g) for (let fy = 0; fy < 7; fy++) for (let fx = 0; fx < 5; fx++) {
      if (g[fy][fx] !== "1") continue;
      for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) set(ox + fx * sc + dx, topY + fy * sc + dy, allGrass);
    }
    ox += lw + gap;
  }
}

/** Build the tile-frame grid (W×H) from the tileset metadata + a seed. */
export function buildWorld(meta, seed, W, H) {
  const lut = {};
  let allWater = 6, allGrass = 12;
  for (const t of meta.tileset_data.tiles) {
    const c = t.corners;
    const bit = (v) => (v === "upper" ? 1 : 0);
    const key = `${bit(c.NW)}${bit(c.NE)}${bit(c.SE)}${bit(c.SW)}`;
    const frame = (t.bounding_box.y / 16) * 4 + t.bounding_box.x / 16;
    lut[key] = frame;
    if (key === "0000") allWater = frame;
    if (key === "1111") allGrass = frame;
  }

  // vertex terrain grid (W+1)×(H+1): 1 = land, 0 = water — a DENSE ARCHIPELAGO
  // of many islands in open sea, with a guaranteed home island at the centre.
  const n1 = valueNoise(seed), n2 = valueNoise((seed ^ 0x9e3779b9) >>> 0), n3 = valueNoise((seed ^ 0x5bd1e995) >>> 0);
  const cx = W / 2, cy = H / 2, maxR = Math.min(W, H) * 0.5;
  const vert = [];
  for (let x = 0; x <= W; x++) {
    vert[x] = [];
    for (let y = 0; y <= H; y++) {
      const dx = x - cx, dy = y - cy, dc = Math.sqrt(dx * dx + dy * dy);
      // layered noise → many scattered landmasses of varied size
      let v = n1(x / 8, y / 8) * 0.5 + n2(x / 4, y / 4) * 0.32 + n3(x / 2.2, y / 2.2) * 0.18;
      // radial falloff so the world is ringed by open ocean
      v -= Math.max(0, (dc / maxR) - 0.46) * 0.55;
      // a defined home island at the centre, ringed by a water moat that keeps
      // it separate from the surrounding archipelago
      if (dc < 9) v = 1;
      else if (dc < 13) v = Math.max(v, 0.66);
      else if (dc < 16.5) v -= 0.5;
      vert[x][y] = v > 0.47 ? 1 : 0;
    }
  }

  const tiles = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nw = vert[x][y], ne = vert[x + 1][y], se = vert[x + 1][y + 1], sw = vert[x][y + 1];
      const key = `${nw}${ne}${se}${sw}`;
      tiles[y * W + x] = lut[key] ?? (nw + ne + se + sw >= 2 ? allGrass : allWater);
    }
  }

  // stamp a giant "LAGZONE" landmark island in the upper sea (crisp tile letters)
  stampWord(tiles, W, H, allGrass, allWater, "LAGZONE", Math.round(W * 0.5), Math.round(H * 0.13), 2);
  return { tiles, vert, W, H, allWater, allGrass };
}

/** Is the tile at world position walkable (not full water)? */
export function isLand(world, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= world.W || ty >= world.H) return false;
  const f = world.tiles[ty * world.W + tx];
  return f !== world.allWater;
}

const rh = (x, y, s) => { const t = Math.sin((x * 374761 + y * 668265 + s * 9176) * 1.13) * 43758.5453; return t - Math.floor(t); };

/** Flood-fill the land into separate islands and give each a theme so every
 *  island feels different (forest, gold, rocky, bloom, outpost…). Cached on the
 *  world object so it's computed once. Same seed → same themes everywhere. */
export function islandMap(world) {
  if (world.__islands) return world.__islands;
  const { W, H } = world;
  const id = new Int32Array(W * H).fill(-1);
  const islands = [];
  const land = (x, y) => x >= 0 && y >= 0 && x < W && y < H && world.tiles[y * W + x] !== world.allWater;
  let next = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!land(x, y) || id[y * W + x] !== -1) continue;
    const tiles = [], stack = [[x, y]]; id[y * W + x] = next;
    let sx = 0, sy = 0;
    while (stack.length) {
      const [px, py] = stack.pop(); tiles.push({ x: px, y: py }); sx += px; sy += py;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (land(nx, ny) && id[ny * W + nx] === -1) { id[ny * W + nx] = next; stack.push([nx, ny]); }
      }
    }
    islands.push({ id: next, tiles, cx: Math.round(sx / tiles.length), cy: Math.round(sy / tiles.length), size: tiles.length });
    next++;
  }
  // assign themes (weighted) by a hash of the island centroid — deterministic
  const homeCx = Math.floor(W / 2), homeCy = Math.floor(H / 2);
  const THEMES = ["forest", "forest", "bloom", "rocky", "outpost", "gold", "gold"]; // weighted bag
  for (const isl of islands) {
    if (Math.hypot(isl.cx - homeCx, isl.cy - homeCy) < 13) isl.theme = "home";
    else if (isl.size < 5) isl.theme = "islet";
    else isl.theme = THEMES[Math.floor(rh(isl.cx, isl.cy, 0x131) * THEMES.length)];
  }
  const themeAt = (x, y) => { const i = (x < 0 || y < 0 || x >= W || y >= H) ? -1 : id[y * W + x]; return i < 0 ? null : islands[i].theme; };
  world.__islands = { id, islands, themeAt };
  return world.__islands;
}

// a little starter village laid out around the spawn (tile offsets from centre)
const VILLAGE = [
  ["fountain", 0, -1],
  ["house", -7, -5], ["house", 7, -4], ["house", -6, 6], ["house", 6, 6],
  ["hut", -10, 1], ["hut", 10, 1],
  ["stall", 2, -8], ["well", -3, 4], ["campfire", 3, 3],
  ["garden", -9, -8], ["garden", 8, -8], ["garden", 0, 8],
  ["lamp", -3, -3], ["lamp", 4, -3], ["lamp", -3, 2], ["lamp", 5, 2],
];

// per-theme prop density + weighted prop table (cumulative thresholds).
// Kept sparse so islands read as natural, not cluttered.
const THEME_PROPS = {
  forest:  { density: 0.17, w: [["tree", 0.3], ["pine", 0.52], ["bigtree", 0.62], ["bush", 0.8], ["mushroom", 0.9], ["flowers", 0.97], ["signpost", 1]] },
  bloom:   { density: 0.15, w: [["flowers", 0.38], ["mushroom", 0.6], ["bush", 0.8], ["palm", 0.9], ["garden", 0.97], ["lamp", 1]] },
  rocky:   { density: 0.14, w: [["rock", 0.42], ["stonewall", 0.68], ["pine", 0.84], ["bush", 0.96], ["well", 1]] },
  outpost: { density: 0.08, w: [["hut", 0.22], ["house", 0.36], ["fence", 0.58], ["crate", 0.7], ["stall", 0.8], ["signpost", 0.87], ["campfire", 0.93], ["lamp", 1]] },
  islet:   { density: 0.1, w: [["palm", 0.5], ["tree", 0.75], ["bush", 0.95], ["flowers", 1]] },
};
const pickProp = (w, p) => { for (const [k, th] of w) if (p < th) return k; return w[w.length - 1][0]; };

/** Themed placement: a village on the home isle, distinct props per island
 *  theme, and boats/fish on the open water. Gold isles are left for goldFields.
 *  Same seed → same world for every client. */
export function scatter(world, seed) {
  const { W, H } = world;
  const { themeAt } = islandMap(world);
  const cxT = Math.floor(W / 2), cyT = Math.floor(H / 2);
  const cx = cxT * 32, cy = cyT * 32;
  const out = [];
  const used = new Set();
  const place = (key, x, y) => { out.push({ key, x, y }); used.add(`${x},${y}`); };

  // home village
  for (const [key, dx, dy] of VILLAGE) { const x = cxT + dx, y = cyT + dy; if (isLand(world, x, y)) place(key, x, y); }

  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (used.has(`${x},${y}`)) continue;
    if (!isLand(world, x, y)) { if (rh(x, y, seed ^ 21) < 0.005) out.push({ key: rh(x, y, seed ^ 31) < 0.4 ? "boat" : "fish", x, y }); continue; }
    const theme = themeAt(x, y);
    if (theme === "gold") continue; // gold isles are populated by goldFields()
    if (theme === "home") {
      if (Math.abs(x * 32 - cx) < 150 && Math.abs(y * 32 - cy) < 150) continue;
      if (rh(x, y, seed ^ 7) < 0.09) { const p = rh(x, y, seed ^ 13); place(p < 0.4 ? "tree" : p < 0.62 ? "bush" : p < 0.8 ? "flowers" : p < 0.9 ? "fence" : "signpost", x, y); }
      continue;
    }
    const cfg = THEME_PROPS[theme] || THEME_PROPS.forest;
    if (rh(x, y, seed ^ 7) >= cfg.density) continue;
    place(pickProp(cfg.w, rh(x, y, seed ^ 13)), x, y);
  }
  return out;
}
