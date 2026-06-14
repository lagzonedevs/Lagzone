/* Deterministic NPCs, gold clusters and monster spawns derived from the island
   themes in world.js. Same seed → same world for every client. */
import { isLand, islandMap } from "./world";

const eh = (x, y, s) => { const t = Math.sin((x * 127.1 + y * 311.7 + s * 74.7) * 1.0) * 43758.5453; return t - Math.floor(t); };

/** Friendly villagers near spawn. */
export function spawnEntities(world) {
  const { W, H } = world;
  const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
  const npcs = [];
  const NPC_SPOTS = [
    [cx - 2, cy - 3, "Old Merrik", "villager", "Welcome to Lagzone! Sail out and explore the isles."],
    [cx + 5, cy, "Trader Pell", "trader", "Every island's different — forests, ruins, gold…"],
    [cx + 1, cy + 5, "Elder Vossa", "elder", "Goblins guard the gold isles. Bring a club."],
    [cx - 6, cy + 2, "Net Fisher Ko", "fisher", "Walk into the sea and your boat carries you."],
    [cx + 4, cy - 6, "Brom the Smith", "blacksmith", "I forge the finest tools on the isle."],
  ];
  for (const [x, y, name, sprite, line] of NPC_SPOTS) if (isLand(world, x, y)) npcs.push({ x, y, name, sprite, line });
  return { npcs };
}

/** Gold ore covering the gold-themed islands (interior tiles, shore left walkable).
 *  Returns [{ cx, cy, tiles:[{x,y}], size }] so callers can guard each isle. */
export function goldFields(world) {
  const { islands } = islandMap(world);
  const land = (x, y) => isLand(world, x, y);
  const clusters = [];
  for (const isl of islands) {
    if (isl.theme !== "gold") continue;
    // interior tiles only (shore stays walkable), then thin to ~38% so ore is
    // scattered in natural veins with grass gaps instead of a solid gold block
    let gold = isl.tiles.filter((t) => land(t.x + 1, t.y) && land(t.x - 1, t.y) && land(t.x, t.y + 1) && land(t.x, t.y - 1));
    if (gold.length < 3) gold = isl.tiles.slice(0, 2);
    else gold = gold.filter((t) => eh(t.x, t.y, 0x901d) < 0.12); // sparse: each ore is rich (100 pts)
    clusters.push({ cx: isl.cx, cy: isl.cy, tiles: gold.map(({ x, y }) => ({ x, y })), size: isl.size });
  }
  return clusters;
}

/** Free-roaming goblins on the wild islands (not home, not gold guardians, not islets). */
export function spawnMonsters(world) {
  const { W, H } = world;
  const { themeAt } = islandMap(world);
  const mobs = [];
  for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
    if (!isLand(world, x, y)) continue;
    const theme = themeAt(x, y);
    if (theme === "home" || theme === "gold" || theme === "islet") continue;
    if (eh(x, y, 0x6b1e) < 0.0026) mobs.push({ x, y });
  }
  return mobs;
}
