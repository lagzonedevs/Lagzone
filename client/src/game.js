import Phaser from "phaser";
import { buildWorld, isLand, scatter } from "./world";
import { spawnEntities, goldFields, spawnMonsters } from "./entities";

const DIRS = ["south", "east", "north", "west"];
const WALK_FRAMES = 6;
const ATK_FRAMES = 3; // lead-jab punch = 3 frames per direction
const SPEED = 150; // px/sec
const PROPS = {
  tree: { s: 0.62, blocks: true }, bush: { s: 0.5 }, rock: { s: 0.5, blocks: true },
  flowers: { s: 0.55 }, fence: { s: 0.6, blocks: true }, mushroom: { s: 0.5 },
  boat: { s: 0.72, water: true }, fish: { s: 0.55, water: true },
  house: { s: 0.75, blocks: true }, hut: { s: 0.8, blocks: true }, garden: { s: 0.7 },
  fountain: { s: 0.8, blocks: true }, well: { s: 0.85, blocks: true },
  lamp: { s: 0.7 }, stall: { s: 0.8, blocks: true }, campfire: { s: 0.7 },
  stonewall: { s: 0.66, blocks: true }, signpost: { s: 0.62, blocks: true }, crate: { s: 0.58, blocks: true },
  pine: { s: 0.6, blocks: true }, palm: { s: 0.62, blocks: true }, bigtree: { s: 0.66, blocks: true },
};
const WOOD_KEYS = new Set(["tree", "pine", "palm", "bigtree"]);
const NPC_KINDS = ["villager", "trader", "elder", "fisher", "blacksmith"];

const GATHER_RANGE = 56;
const NODE_RESPAWN = 8000;
const TALK_RANGE = 80;
const XP_PER = 5;
const PLAYER = { maxHp: 10, atkCd: 450, atkRange: 60, atkDmg: 1 };
const GOB = { maxHp: 3, speed: 52, aggro: 165, contactDist: 26, contactDmg: 1, contactCd: 900, respawnMs: 14000, wander: 64 };
// boat.png points east-west by default; rotate its long axis to the heading
const BOAT_ROT = { east: 0, west: 0, north: Math.PI / 2, south: Math.PI / 2 };
const N_BOTS = 18;
const BOT_NAMES = ["saltydog", "ReefRunner", "Mara", "kuyng", "BoraBora", "driftwood", "TideY", "Penny", "gg_otter", "Marlin", "sandy", "Koa", "reef42", "blub", "Nemo_", "seafarer", "Lagoona", "oysterboy", "pearl", "Finn", "Wavey", "Brizo", "castaway", "skipper", "Coraline", "Nori", "Bayou", "Triton", "Misty", "Shelly", "barnacle", "Squid", "deepblue", "Marin"];
const BOT_CHAT = ["anyone selling wood?", "the east gold isle is brutal lol", "gg", "how do i equip the saber", "this music is so chill", "lvl up lets gooo", "need meat to revive my guy", "where do i buy armor", "sailing is smooth af", "found a hidden isle", "brb mining", "who wants to trade stone", "the goblins keep wrecking me", "new here, this is cozy", "wen token", "anyone near the windmill?", "just hit a goblin for 5 dmg", "love this map"];
const levelFor = (xp) => Math.floor(Math.sqrt(xp / 20)) + 1;
const xpInLevel = (xp) => { const lv = levelFor(xp); const lo = 20 * (lv - 1) * (lv - 1); const hi = 20 * lv * lv; return { lv, frac: (xp - lo) / (hi - lo) }; };

class WorldScene extends Phaser.Scene {
  constructor() { super("world"); }

  init(data) { this.world = data.world; this.minimap = data.minimap; this.ambient = true; this.net = { on() {}, send() {} }; this.onChat = null; }

  preload() {
    this.load.spritesheet("tiles", "/assets/tileset.png", { frameWidth: 16, frameHeight: 16 });
    for (const d of DIRS) {
      this.load.image(`hero_${d}`, `/assets/hero_${d}.png`);
      for (let i = 0; i < WALK_FRAMES; i++) this.load.image(`hw_${d}_${i}`, `/assets/hero/walk_${d}_${i}.png`);
      for (let i = 0; i < ATK_FRAMES; i++) this.load.image(`ha_${d}_${i}`, `/assets/hero/attack_${d}_${i}.png`);
      for (const k of NPC_KINDS) this.load.image(`npc_${k}_${d}`, `/assets/npc/${k}_${d}.png`);
      this.load.image(`gob_${d}`, `/assets/mobs/goblin_${d}.png`);
    }
    for (const k of Object.keys(PROPS)) this.load.image(`p_${k}`, `/assets/props/${k}.png`);
    this.load.image("gold", "/assets/gold.png");
    this.load.image("p_bridge", "/assets/props/bridge.png");
    for (const k of ["wood", "stone", "gold", "meat", "heart"]) this.load.image(`icon_${k}`, `/assets/icons/${k}.png`);
  }

  create() {
    const W = this.world.W, H = this.world.H, T = 32;
    this.cx = (W / 2) * 32; this.cy = (H / 2) * 32;
    const built = buildWorld(this.tilesetMeta || this.world.meta, this.world.seed, W, H);
    this.terrain = built;

    for (const d of DIRS) {
      this.anims.create({ key: `walk_${d}`, frames: Array.from({ length: WALK_FRAMES }, (_, i) => ({ key: `hw_${d}_${i}` })), frameRate: 10, repeat: -1 });
      const af = Array.from({ length: ATK_FRAMES }, (_, i) => ({ key: `ha_${d}_${i}` })).filter((f) => this.textures.exists(f.key));
      if (af.length) this.anims.create({ key: `atk_${d}`, frames: af, frameRate: 16, repeat: 0 });
    }

    // tilemap
    const map = this.make.tilemap({ tileWidth: 16, tileHeight: 16, width: W, height: H });
    const ts = map.addTilesetImage("tiles", "tiles", 16, 16, 0, 0);
    const layer = map.createBlankLayer("ground", ts, 0, 0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) layer.putTileAt(built.tiles[y * W + x], x, y);
    layer.setScale(2);

    // ornaments + resource nodes
    this.blocked = new Set();
    this.nodes = [];
    for (const d of scatter(built, this.world.seed)) {
      const cfg = PROPS[d.key];
      const px = d.x * 32 + 16, py = cfg.water ? d.y * 32 + 16 : d.y * 32 + 30;
      const img = this.add.image(px, py, `p_${d.key}`).setScale(cfg.s).setOrigin(0.5, cfg.water ? 0.5 : 0.9);
      img.setDepth(cfg.water ? 1 : py);
      const isResource = WOOD_KEYS.has(d.key) || d.key === "rock";
      if (isResource) {
        // resource nodes block only their own tile so they can be walked over once cleared
        const key = `${d.x},${d.y}`;
        this.blocked.add(key);
        const pts = d.key === "rock" ? 3 : d.key === "bigtree" ? 5 : 4; // multi-hit
        this.nodes.push({ sprite: img, tx: d.x, ty: d.y, blockKey: key, x: px, y: py - 14, kind: d.key === "rock" ? "stone" : "wood", base: cfg.s, points: pts, max: pts, alive: true, respawnAt: 0 });
      } else if (cfg.blocks) {
        const src = this.textures.get(`p_${d.key}`).getSourceImage();
        const wT = Math.max(1, Math.round((src.width * cfg.s) / 40)), hT = Math.max(1, Math.round((src.height * cfg.s) / 48));
        const half = Math.floor(wT / 2);
        for (let bx = -half; bx <= half; bx++) for (let by = -(hT - 1); by <= 0; by++) this.blocked.add(`${d.x + bx},${d.y + by}`);
      }
    }

    // mineable gold clusters + goblin guardians
    this.enemies = [];
    const goblinPts = [];
    if (this.textures.exists("gold")) {
      for (const cl of goldFields(built)) {
        for (const g of cl.tiles) {
          if (this.blocked.has(`${g.x},${g.y}`)) continue;
          const px = g.x * 32 + 16, py = g.y * 32 + 28;
          const img = this.add.image(px, py, "gold").setScale(0.78).setOrigin(0.5, 0.8).setDepth(py);
          const key = `${g.x},${g.y}`;
          this.blocked.add(key);
          this.nodes.push({ sprite: img, tx: g.x, ty: g.y, blockKey: key, x: px, y: py - 12, kind: "gold", base: 0.78, points: 100, max: 100, alive: true, respawnAt: 0 });
        }
        const guards = Math.min(4, 1 + Math.floor((cl.size || 9) / 16));
        for (let i = 0; i < guards; i++) goblinPts.push({ x: cl.cx + (i % 2 ? 2 : -2), y: cl.cy + (i > 1 ? 2 : -2), guard: true });
      }
    }
    for (const m of spawnMonsters(built)) goblinPts.push({ x: m.x, y: m.y, guard: false });
    if (this.textures.exists("gob_south")) for (const g of goblinPts) this.enemies.push(this.makeGoblin(g));

    // foot-bridges across 1-tile channels between islands (walkable, no boat)
    this.bridges = new Set();
    if (this.textures.exists("p_bridge")) {
      const isW = (x, y) => x >= 0 && y >= 0 && x < W && y < H && built.tiles[y * W + x] === built.allWater;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (!isW(x, y)) continue;
        const horiz = isLand(built, x - 1, y) && isLand(built, x + 1, y) && isW(x, y - 1) && isW(x, y + 1);
        const vert = isLand(built, x, y - 1) && isLand(built, x, y + 1) && isW(x - 1, y) && isW(x + 1, y);
        if (!horiz && !vert) continue;
        const px = x * 32 + 16, py = y * 32 + 16;
        const img = this.add.image(px, py, "p_bridge").setScale(0.52).setOrigin(0.5, 0.5).setDepth(py);
        if (vert) img.setRotation(Math.PI / 2);
        this.bridges.add(`${x},${y}`);
      }
    }

    this.makeWake();
    this.spawnBots();

    this.physics.world.setBounds(0, 0, W * T, H * T);
    this.cameras.main.setBounds(0, 0, W * T, H * T);
    this.cameras.main.setBackgroundColor("#4a8fc9");
    // color-grade the world toward the muted teal-green islands.games palette
    if (this.cameras.main.postFX) {
      const cm = this.cameras.main.postFX.addColorMatrix();
      cm.saturate(-0.12);
      cm.brightness(0.97, true);
    }

    // npcs
    const ent = spawnEntities(built);
    this.npcs = ent.npcs.map((n) => this.makeNpc(n));
    this.bubble = this.add.text(0, 0, "", { fontFamily: "Outfit, sans-serif", fontSize: "13px", color: "#4a3a1e", backgroundColor: "#fff8e6", padding: { x: 8, y: 4 } }).setOrigin(0.5, 1).setDepth(120000).setVisible(false);

    this.others = new Map();
    this.labels = new Map();

    // player (hidden until play) + boat
    this.player = this.add.sprite(this.cx, this.cy, "hero_south").setScale(0.62).setDepth(this.cy).setVisible(false);
    this.boat = this.add.image(this.cx, this.cy, "p_boat").setScale(0.92).setOrigin(0.5, 0.5).setVisible(false);
    this.onBoat = false;
    this.stats = { wood: 0, stone: 0, gold: 0, xp: 0, hp: PLAYER.maxHp, meat: 0, heals: 0 };
    this.equip = { weapon: null, armor: null, shoes: null };
    this.maxHp = PLAYER.maxHp;
    this.lastAtk = 0; this.invuln = 0;
    this.myLabel = this.makeLabel("you", 1, true).setVisible(false);
    this.hud = {
      wood: document.getElementById("statWood"), stone: document.getElementById("statStone"), gold: document.getElementById("statGold"),
      lvl: document.getElementById("youLvl"), hp: document.getElementById("hpFill"), hint: document.getElementById("hint"),
    };

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys("W,A,S,D,E,SPACE");
    this.dir = "south"; this.moving = false; this.lastSent = 0; this.serverId = null;
    this.camDrift = 0;
    this.cameras.main.centerOn(this.cx, this.cy);
    // click a tree / ore / goblin → path over and work it; click an NPC → shop; click ground → walk there
    this.autoTarget = null; this.path = null;
    this.input.on("pointerdown", (pointer) => {
      if (this.ambient) return;
      const wx = pointer.worldX, wy = pointer.worldY;
      for (const n of this.npcs) { if (Math.hypot(n.spr.x - wx, n.spr.y - wy) < 30) { window.LZ_openShop?.(n.kind, n.name); return; } }
      let node = null, nd = 34;
      for (const n of this.nodes) { if (!n.alive) continue; const d = Math.hypot(n.x - wx, n.y - wy); if (d < nd) { nd = d; node = n; } }
      let enemy = null, ed = 34;
      for (const e of this.enemies) { if (!e.alive) continue; const d = Math.hypot(e.spr.x - wx, e.spr.y - wy); if (d < ed) { ed = d; enemy = e; } }
      let dx2, dy2;
      if (node) { this.autoTarget = { type: "node", ref: node }; [dx2, dy2] = this.adjacentTile(node.tx, node.ty); }
      else if (enemy) { this.autoTarget = { type: "enemy", ref: enemy }; [dx2, dy2] = this.adjacentTile(Math.floor(enemy.spr.x / 32), Math.floor(enemy.spr.y / 32)); }
      else { this.autoTarget = null; dx2 = wx; dy2 = wy; }
      this.path = this.findPath(this.player.x, this.player.y, dx2, dy2) || [{ x: dx2, y: dy2 }];
    });
    // scroll to zoom the map in / out
    this.input.on("wheel", (pointer, over, dx, dy) => {
      const z = Phaser.Math.Clamp(this.cameras.main.zoom - dy * 0.0014, 0.55, 2.2);
      this.cameras.main.setZoom(z);
    });

    window.LZ = {
      play: (me, net, onChat) => this.beginPlay(me, net, onChat),
      stats: () => ({ ...this.stats, ...xpInLevel(this.stats.xp) }),
      onBoat: () => this.onBoat,
      enemyCount: () => this.enemies?.length || 0,
      botCount: () => this.bots?.length || 0,
      mobsOnWater: () => (this.enemies || []).filter((e) => e.alive && this.terrain.tiles[Math.floor(e.spr.y / 32) * this.terrain.W + Math.floor(e.spr.x / 32)] === this.terrain.allWater).length,
      grant: (g) => this.grant(g),
      buyPotion: (cost, fx) => this.buyPotion(cost, fx),
      buyGear: (item, viaUsdc) => this.buyGear(item, viaUsdc),
      equipped: () => this.equipped(),
      activeBuffs: () => this.activeBuffs(),
      pos: () => ({ x: this.player.x, y: this.player.y }),
      nearestNodeScreen: () => {
        const cam = this.cameras.main; let best = null, bd = 1e9;
        for (const n of this.nodes) { if (!n.alive) continue; const d = Math.hypot(n.x - this.player.x, n.y - this.player.y); if (d < bd) { bd = d; best = n; } }
        if (!best) return null;
        return { sx: (best.x - cam.scrollX) * cam.zoom, sy: (best.y - cam.scrollY) * cam.zoom, kind: best.kind };
      },
      recenter: () => { if (!this.ambient) { this.player.x = this.cx; this.player.y = this.cy; } },
    };
    if (this._pendingPlay) { const a = this._pendingPlay; this._pendingPlay = null; this.beginPlay(a.me, a.net, a.onChat); }
  }

  beginPlay(me, net, onChat) {
    this.ambient = false;
    this.me = me; this.net = net || { on() {}, send() {} }; this.onChat = onChat;
    this.player.setPosition(me.x, me.y).setVisible(true).setDepth(me.y);
    this.myLabel.setText(`${me.name || "you"} Lv 1`).setVisible(true);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.updateHud();

    this.net.on("init", (m) => {
      this.serverId = m.id;
      for (const id of [...this.others.keys()]) this.removeOther(id);
      for (const p of m.players || []) if (p.id !== m.id) this.addOther(p);
    });
    this.net.on("spawn", (m) => { if (m.player && m.player.id !== this.serverId) this.addOther(m.player); });
    this.net.on("move", (m) => this.moveOther(m));
    this.net.on("leave", (m) => this.removeOther(m.id));
  }

  buildWaterFx(world, W, H) {
    // procedural caustics texture (faint white waves on transparent)
    if (!this.textures.exists("watfx")) {
      const cv = document.createElement("canvas"); cv.width = 64; cv.height = 64;
      const g = cv.getContext("2d");
      g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 1.5; g.lineCap = "round"; g.setLineDash([7, 6]);
      for (let i = 0; i < 3; i++) {
        g.lineDashOffset = i * 5;
        g.beginPath();
        for (let x = 0; x <= 64; x += 3) { const y = 12 + i * 20 + Math.sin((x + i * 13) * 0.2) * 2.6; x === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
        g.stroke();
      }
      this.textures.addCanvas("watfx", cv);
    }
    this.waterFx = this.add.tileSprite(0, 0, W * 32, H * 32, "watfx").setOrigin(0, 0).setDepth(2).setAlpha(0.09).setBlendMode(Phaser.BlendModes.ADD);
    // mask shimmer to water tiles only (row run-length rects to keep it cheap)
    const mg = this.add.graphics().setVisible(false); mg.fillStyle(0xffffff, 1);
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        if (world.tiles[y * W + x] === world.allWater) { let x2 = x; while (x2 < W && world.tiles[y * W + x2] === world.allWater) x2++; mg.fillRect(x * 32, y * 32, (x2 - x) * 32, 32); x = x2; }
        else x++;
      }
    }
    this.waterFx.setMask(mg.createGeometryMask());
  }

  buildShoreFoam(world, W, H) {
    // dappled white foam texture (denser than the open-water shimmer)
    if (!this.textures.exists("foamfx")) {
      const cv = document.createElement("canvas"); cv.width = 64; cv.height = 64;
      const g = cv.getContext("2d");
      g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 3; g.lineCap = "round"; g.setLineDash([5, 4]);
      for (let i = 0; i < 6; i++) {
        g.lineDashOffset = i * 4;
        g.beginPath();
        for (let x = 0; x <= 64; x += 2) { const y = 5 + i * 11 + Math.sin((x + i * 9) * 0.34) * 2.4; x === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
        g.stroke();
      }
      this.textures.addCanvas("foamfx", cv);
    }
    this.shoreFoam = this.add.tileSprite(0, 0, W * 32, H * 32, "foamfx").setOrigin(0, 0).setDepth(2.6).setAlpha(0.4).setBlendMode(Phaser.BlendModes.ADD);
    // mask to coastal water (a water tile touching land on any of the 8 sides)
    const isWater = (x, y) => x >= 0 && y >= 0 && x < W && y < H && world.tiles[y * W + x] === world.allWater;
    const isLandT = (x, y) => x >= 0 && y >= 0 && x < W && y < H && world.tiles[y * W + x] !== world.allWater;
    const mg = this.add.graphics().setVisible(false); mg.fillStyle(0xffffff, 1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isWater(x, y)) continue;
      if (isLandT(x + 1, y) || isLandT(x - 1, y) || isLandT(x, y + 1) || isLandT(x, y - 1) ||
          isLandT(x + 1, y + 1) || isLandT(x - 1, y - 1) || isLandT(x + 1, y - 1) || isLandT(x - 1, y + 1))
        mg.fillRect(x * 32, y * 32, 32, 32);
    }
    this.shoreFoam.setMask(mg.createGeometryMask());
    this.foamT = 0;
  }

  makeWake() {
    if (!this.textures.exists("wake")) {
      const cv = document.createElement("canvas"); cv.width = 16; cv.height = 16;
      const g = cv.getContext("2d");
      const grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
      grad.addColorStop(0, "rgba(255,255,255,0.95)"); grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad; g.beginPath(); g.arc(8, 8, 8, 0, Math.PI * 2); g.fill();
      this.textures.addCanvas("wake", cv);
    }
    this.wake = this.add.particles(0, 0, "wake", {
      speed: { min: 3, max: 16 }, scale: { start: 0.6, end: 0 }, alpha: { start: 0.5, end: 0 },
      lifespan: 600, frequency: -1, blendMode: "ADD",
    }).setDepth(1.6);
    this._wakeT = 0;
    // foam ring that hugs a boat's waterline
    if (!this.textures.exists("bfoam")) {
      const cv = document.createElement("canvas"); cv.width = 72; cv.height = 44;
      const g = cv.getContext("2d");
      g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 3; g.lineCap = "round"; g.setLineDash([5, 5]);
      g.beginPath(); g.ellipse(36, 24, 27, 13, 0, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 2; g.globalAlpha = 0.55; g.beginPath(); g.ellipse(36, 26, 32, 16, 0, 0, Math.PI * 2); g.stroke();
      this.textures.addCanvas("bfoam", cv);
    }
    this.boatFoam = this.add.image(this.cx, this.cy, "bfoam").setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.foamT = 0;
    // hit spark for combat impacts
    if (!this.textures.exists("spark")) {
      const cv = document.createElement("canvas"); cv.width = 10; cv.height = 10;
      const g = cv.getContext("2d"); g.fillStyle = "#fff";
      g.beginPath(); g.moveTo(5, 0); g.lineTo(6, 4); g.lineTo(10, 5); g.lineTo(6, 6); g.lineTo(5, 10); g.lineTo(4, 6); g.lineTo(0, 5); g.lineTo(4, 4); g.closePath(); g.fill();
      this.textures.addCanvas("spark", cv);
    }
    this.hitFx = this.add.particles(0, 0, "spark", { speed: { min: 55, max: 160 }, scale: { start: 0.9, end: 0 }, alpha: { start: 1, end: 0 }, lifespan: 320, blendMode: "ADD", emitting: false }).setDepth(140000);
  }

  grant(g) {
    if (!g) return;
    if (g.wood) this.stats.wood += g.wood;
    if (g.stone) this.stats.stone += g.stone;
    if (g.gold) this.stats.gold += g.gold;
    if (g.meat) this.stats.meat = (this.stats.meat || 0) + g.meat;
    if (g.heals) { this.stats.heals = (this.stats.heals || 0) + g.heals; this.stats.hp = this.maxHp; }
    if (g.buff === "str") this.buffStr = this.time.now + 3600000;
    if (g.buff === "spd") this.buffSpd = this.time.now + 3600000;
    if (g.gear === "sword") this.gearDmg = (this.gearDmg || 0) + 1;
    this.floatText(this.player.x, this.player.y - 42, "Purchase delivered!", "#a9e06a");
    this.updateHud();
  }

  buyPotion(cost, fx) {
    for (const k in cost) if ((this.stats[k] || 0) < cost[k]) return { ok: false, msg: `Need ${cost[k]} ${k} (have ${this.stats[k] || 0})` };
    for (const k in cost) this.stats[k] -= cost[k];
    if (fx.give) for (const k in fx.give) this.stats[k] = (this.stats[k] || 0) + fx.give[k];
    if (fx.healPct) this.stats.hp = Math.min(this.maxHp, this.stats.hp + Math.ceil(this.maxHp * fx.healPct));
    if (fx.buff === "str") this.buffStr = this.time.now + fx.ms;
    if (fx.buff === "spd") this.buffSpd = this.time.now + fx.ms;
    if (fx.buff === "def") this.buffDef = this.time.now + fx.ms;
    if (fx.buff === "xp") this.buffXp = this.time.now + fx.ms;
    this.floatText(this.player.x, this.player.y - 42, "Potion brewed!", "#a9e06a");
    this.updateHud();
    return { ok: true };
  }

  gearStats() {
    let str = 0, agi = 0, vit = 0;
    for (const k in this.equip) { const g = this.equip[k]; if (g) { str += g.str || 0; agi += g.agi || 0; vit += g.vit || 0; } }
    return { str, agi, vit };
  }

  recomputeGear() {
    this.maxHp = PLAYER.maxHp + this.gearStats().vit;
    this.stats.hp = Math.min(this.stats.hp, this.maxHp);
    this.updateHud();
  }

  buyGear(item, viaUsdc) {
    if (!viaUsdc) {
      const { lv } = xpInLevel(this.stats.xp);
      if (lv < item.levelReq) return { ok: false, msg: `Requires level ${item.levelReq} — or buy with USDC to skip` };
      for (const k in item.cost) if ((this.stats[k] || 0) < item.cost[k]) return { ok: false, msg: `Need ${item.cost[k]} ${k}` };
      for (const k in item.cost) this.stats[k] -= item.cost[k];
    }
    this.equip[item.slot] = item;
    this.recomputeGear();
    this.floatText(this.player.x, this.player.y - 42, `Equipped ${item.name}`, "#a9e06a");
    return { ok: true };
  }

  equipped() { return { weapon: this.equip.weapon, armor: this.equip.armor, shoes: this.equip.shoes, ...this.gearStats(), maxHp: this.maxHp }; }

  activeBuffs() {
    const now = this.time.now, out = [];
    const add = (t, label) => { if (t > now) out.push({ label, sec: Math.ceil((t - now) / 1000) }); };
    add(this.buffStr, "STR"); add(this.buffDef, "DEF"); add(this.buffSpd, "SPD"); add(this.buffXp, "XP");
    return out;
  }

  hitEffect(x, y) {
    this.hitFx.emitParticleAt(x, y, 9);
    const star = this.add.image(x, y, "spark").setScale(0.6).setDepth(140001).setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff1a8);
    this.tweens.add({ targets: star, scale: 3.4, alpha: 0, angle: 120, duration: 230, onComplete: () => star.destroy() });
    this.cameras.main.shake(80, 0.004);
  }

  makeNpc(n) {
    const px = n.x * 32 + 16, py = n.y * 32 + 24;
    const kind = this.textures.exists(`npc_${n.sprite}_south`) ? n.sprite : "villager";
    const spr = this.add.image(px, py, `npc_${kind}_south`).setScale(0.6).setOrigin(0.5, 0.85).setDepth(py);
    const label = this.makeLabel(n.name, null, false, "#2f7fa8");
    return { ...n, kind, spr, label, hx: px, hy: py, phase: (n.x * 13 + n.y * 7) % 100, dir: "south" };
  }

  makeLabel(name, level, self, color) {
    const txt = level == null ? name : `${name} Lv ${level}`;
    return this.add.text(0, 0, txt, { fontFamily: "monospace", fontSize: "13px", color: color || (self ? "#ffe27a" : "#ffffff"), stroke: "#1a2230", strokeThickness: 4 }).setOrigin(0.5, 1).setDepth(100000);
  }

  floatText(x, y, str, color) {
    const t = this.add.text(x, y, str, { fontFamily: "Outfit, sans-serif", fontSize: "15px", color: color || "#fff", stroke: "#1a2230", strokeThickness: 4 }).setOrigin(0.5, 1).setDepth(130000);
    this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 750, ease: "Cubic.out", onComplete: () => t.destroy() });
  }

  addOther(p) {
    if (this.others.has(p.id)) return;
    const spr = this.add.sprite(p.x, p.y, `hero_${p.dir || "south"}`).setScale(0.62);
    spr.target = { x: p.x, y: p.y }; spr.dir = p.dir || "south"; spr.onBoat = !!p.boat;
    spr.boat = this.add.image(p.x, p.y, "p_boat").setScale(0.92).setVisible(false);
    spr.boatFoam = this.add.image(p.x, p.y, "bfoam").setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.others.set(p.id, spr);
    this.labels.set(p.id, this.makeLabel(p.name || "wanderer", p.level || 1, false));
  }
  moveOther(m) { const spr = this.others.get(m.id); if (!spr) return; spr.target = { x: m.x, y: m.y }; if (m.dir) spr.dir = m.dir; spr.onBoat = !!m.boat; }
  removeOther(id) { const s = this.others.get(id); s?.boat?.destroy(); s?.boatFoam?.destroy(); s?.destroy(); this.others.delete(id); this.labels.get(id)?.destroy(); this.labels.delete(id); }

  faceDir(dx, dy) { return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "west" : "east") : (dy < 0 ? "north" : "south"); }

  walkable(x, y) { return x >= 0 && y >= 0 && x < this.terrain.W && y < this.terrain.H && !this.blocked.has(`${x},${y}`); }

  adjacentTile(tx, ty) {
    let best = null, bd = 1e9;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = tx + dx, y = ty + dy;
      if (!this.walkable(x, y)) continue;
      const px = x * 32 + 16, py = y * 32 + 16, d = Math.hypot(px - this.player.x, py - this.player.y);
      if (d < bd) { bd = d; best = [px, py]; }
    }
    return best || [tx * 32 + 16, ty * 32 + 16];
  }

  /** A* over the tile grid (blocked props/walls = impassable). Returns waypoint pixel centres. */
  findPath(sxPx, syPx, txPx, tyPx) {
    const W = this.terrain.W, H = this.terrain.H;
    const sx = Math.floor(sxPx / 32), sy = Math.floor(syPx / 32), tx = Math.floor(txPx / 32), ty = Math.floor(tyPx / 32);
    if (sx === tx && sy === ty) return [{ x: txPx, y: tyPx }];
    if (!this.walkable(tx, ty)) return null;
    const id = (x, y) => y * W + x, start = id(sx, sy);
    const came = new Map(), g = new Map([[start, 0]]);
    const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
    const open = [{ f: h(sx, sy), x: sx, y: sy }], inOpen = new Set([start]);
    const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let iter = 0;
    while (open.length && iter++ < 9000) {
      let mi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[mi].f) mi = i;
      const cur = open.splice(mi, 1)[0], ci = id(cur.x, cur.y); inOpen.delete(ci);
      if (cur.x === tx && cur.y === ty) {
        const path = []; let k = ci;
        while (k !== start) { const x = k % W, y = (k - x) / W; path.push({ x: x * 32 + 16, y: y * 32 + 16 }); k = came.get(k); }
        return path.reverse();
      }
      for (const [dx, dy] of DIRS8) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (!this.walkable(nx, ny)) continue;
        if (dx && dy && (!this.walkable(cur.x + dx, cur.y) || !this.walkable(cur.x, cur.y + dy))) continue;
        const ni = id(nx, ny), ng = (g.get(ci) ?? 1e9) + (dx && dy ? 1.414 : 1);
        if (ng < (g.get(ni) ?? 1e9)) {
          came.set(ni, ci); g.set(ni, ng);
          if (!inOpen.has(ni)) { open.push({ f: ng + h(nx, ny), x: nx, y: ny }); inOpen.add(ni); }
        }
      }
    }
    return null;
  }

  tryGather() {
    let best = null, bd = GATHER_RANGE;
    for (const n of this.nodes) { if (!n.alive) continue; const d = Math.hypot(n.x - this.player.x, n.y - this.player.y); if (d < bd) { bd = d; best = n; } }
    if (best) this.gatherNode(best);
  }

  gatherNode(node) {
    if (!node.alive || this.time.now < (this.lastGather || 0) + 240) return false;
    this.lastGather = this.time.now;
    if (node.kind === "wood") this.stats.wood++;
    else if (node.kind === "stone") this.stats.stone++;
    else this.stats.gold++;
    this.stats.xp += (node.kind === "gold" ? 2 : XP_PER) * (this.buffXp > this.time.now ? 1.5 : 1);
    node.points--;
    this.tweens.add({ targets: node.sprite, angle: { from: -5, to: 5 }, duration: 55, yoyo: true, repeat: 1 });
    if (node.max > 1) node.sprite.setScale(node.base * (0.4 + 0.6 * Math.max(0, node.points) / node.max));
    this.flyToBag(node.x, node.y, node.kind);
    if (node.points <= 0) this.depleteNode(node);
    this.updateHud();
    return true;
  }

  flyToBag(wx, wy, kind) {
    const key = `icon_${kind}`;
    if (!this.textures.exists(key)) return;
    const cam = this.cameras.main;
    const sx = (wx - cam.scrollX) * cam.zoom, sy = (wy - cam.scrollY) * cam.zoom;
    const bag = document.getElementById("tbInv")?.getBoundingClientRect();
    const tx = bag ? bag.left + bag.width / 2 : this.scale.width - 200;
    const ty = bag ? bag.top + bag.height / 2 : this.scale.height - 36;
    const img = this.add.image(sx, sy - 10, key).setScrollFactor(0).setDepth(200000).setScale(0.55);
    this.tweens.add({ targets: img, x: tx, y: ty, scale: 0.18, alpha: 0.35, duration: 480, ease: "Cubic.in", onComplete: () => { img.destroy(); document.getElementById("tbInv")?.animate?.([{ transform: "translateY(0)" }, { transform: "translateY(-5px)" }, { transform: "translateY(0)" }], { duration: 200 }); } });
  }

  depleteNode(node) {
    node.alive = false;
    node.respawnAt = this.time.now + (node.max > 1 ? 30000 : NODE_RESPAWN);
    if (node.blockKey) this.blocked.delete(node.blockKey); // cleared spot becomes walkable
    this.tweens.add({ targets: node.sprite, scale: node.base * 0.3, alpha: 0.12, duration: 200 });
  }

  // ---- combat ----
  // ---- ambient bots that wander, sail and chat like other players ----
  spawnBots() {
    this.bots = [];
    const cxT = Math.floor(this.terrain.W / 2), cyT = Math.floor(this.terrain.H / 2);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < N_BOTS; i++) {
      let tx = cxT, ty = cyT, tries = 0;
      do { tx = cxT + Math.round((Math.random() * 2 - 1) * 34); ty = cyT + Math.round((Math.random() * 2 - 1) * 34); tries++; } while (!this.walkable(tx, ty) && tries < 60);
      const px = tx * 32 + 16, py = ty * 32 + 16;
      const spr = this.add.sprite(px, py, "hero_south").setScale(0.62).setDepth(py);
      spr.setTint(Phaser.Display.Color.HSVToRGB(Math.random(), 0.28, 1).color);
      const name = names[i] || `Sailor${i}`, level = 1 + Math.floor(Math.random() * 32);
      const label = this.makeLabel(name, level, false);
      const boat = this.add.image(px, py, "p_boat").setScale(0.92).setVisible(false);
      this.bots.push({ spr, boat, label, name, dir: "south", target: null, onBoat: false, wait: Math.random() * 2, chatAt: 6000 + i * 3500 + Math.random() * 4000 });
    }
  }

  botStand(wx, wy) {
    const W = this.terrain.W, x = Math.floor(wx / 32), y = Math.floor(wy / 32);
    const inB = x >= 0 && y >= 0 && x < W && y < this.terrain.H;
    const bridge = this.bridges.has(`${x},${y}`);
    const water = inB && this.terrain.tiles[y * W + x] === this.terrain.allWater && !bridge;
    const ok = inB && (water || ((isLand(this.terrain, x, y) || bridge) && !this.blocked.has(`${x},${y}`)));
    return { ok, water };
  }

  updateBots(dt) {
    if (!this.bots) return;
    const now = this.time.now;
    for (const b of this.bots) {
      if (!b.target) {
        b.wait -= dt;
        if (b.wait <= 0) {
          let tx, ty, tries = 0;
          do { tx = Math.floor(b.spr.x / 32) + Math.round((Math.random() * 2 - 1) * 11); ty = Math.floor(b.spr.y / 32) + Math.round((Math.random() * 2 - 1) * 11); tries++; } while (!this.walkable(tx, ty) && tries < 24);
          if (this.walkable(tx, ty)) b.target = { x: tx * 32 + 16, y: ty * 32 + 16 };
          else b.wait = 0.5;
        }
      }
      let moving = false;
      if (b.target) {
        const dx = b.target.x - b.spr.x, dy = b.target.y - b.spr.y, d = Math.hypot(dx, dy);
        if (d < 6) { b.target = null; b.wait = 0.6 + Math.random() * 3; }
        else {
          const step = 68 * dt;
          const sx = Math.sign(dx) * Math.min(step, Math.abs(dx)), sy = Math.sign(dy) * Math.min(step, Math.abs(dy));
          let nx = b.spr.x, ny = b.spr.y, water = b.onBoat;
          const rx = this.botStand(nx + sx, ny); if (rx.ok) { nx += sx; water = rx.water; }
          const ry = this.botStand(nx, ny + sy); if (ry.ok) { ny += sy; water = ry.water; }
          if (nx === b.spr.x && ny === b.spr.y) { b.target = null; b.wait = 0.3; }
          else { b.spr.x = nx; b.spr.y = ny; b.onBoat = water; b.dir = this.faceDir(dx, dy); moving = true; }
        }
      }
      b.spr.setDepth(b.spr.y);
      if (b.onBoat) {
        b.spr.anims.stop(); if (b.spr.texture.key !== `hero_${b.dir}`) b.spr.setTexture(`hero_${b.dir}`);
        b.boat.setVisible(true).setPosition(b.spr.x, b.spr.y + 9).setDepth(b.spr.y - 1).setRotation(BOAT_ROT[b.dir] || 0);
      } else {
        b.boat.setVisible(false);
        if (moving) b.spr.anims.play(`walk_${b.dir}`, true);
        else { b.spr.anims.stop(); if (b.spr.texture.key !== `hero_${b.dir}`) b.spr.setTexture(`hero_${b.dir}`); }
      }
      b.label.setPosition(b.spr.x, b.spr.y - 26);
      if (this.onChat && now > b.chatAt) { b.chatAt = now + 14000 + Math.random() * 32000; if (Math.random() < 0.55) this.onChat({ name: b.name, text: BOT_CHAT[Math.floor(Math.random() * BOT_CHAT.length)] }); }
    }
  }

  nearLand(tx, ty, r = 5) {
    if (isLand(this.terrain, tx, ty) && !this.blocked.has(`${tx},${ty}`)) return [tx, ty];
    for (let rad = 1; rad <= r; rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const x = tx + dx, y = ty + dy;
      if (isLand(this.terrain, x, y) && !this.blocked.has(`${x},${y}`)) return [x, y];
    }
    return null;
  }

  makeGoblin(g) {
    const snap = this.nearLand(g.x, g.y, 6) || [g.x, g.y];
    g = { ...g, x: snap[0], y: snap[1] };
    const px = g.x * 32 + 16, py = g.y * 32 + 18;
    const spr = this.add.sprite(px, py, "gob_south").setScale(0.66).setOrigin(0.5, 0.85).setDepth(py);
    const bar = this.add.rectangle(px, py - 24, 26, 4, 0xff5566).setDepth(py + 1).setVisible(false);
    return { home: { x: g.x, y: g.y }, spr, bar, hp: GOB.maxHp, dir: "south", alive: true, respawnAt: 0, lastContact: 0, wt: 0, wvx: 0, wvy: 0, guard: g.guard };
  }

  doAction() {
    let near = false;
    for (const e of this.enemies) { if (e.alive && Math.hypot(e.spr.x - this.player.x, e.spr.y - this.player.y) < PLAYER.atkRange) { near = true; break; } }
    if (near) this.tryAttack(); else this.tryGather();
  }

  flash(spr, color) { spr.setTint(color); this.time.delayedCall(120, () => spr.clearTint()); }

  playAttackAnim() {
    if (this.anims.exists(`atk_${this.dir}`) && !this.onBoat) {
      this._attacking = true;
      this.player.play(`atk_${this.dir}`);
      this.player.once("animationcomplete", () => { this._attacking = false; if (!this.moving) this.player.setTexture(`hero_${this.dir}`); });
    } else {
      this.tweens.add({ targets: this.player, scaleX: 0.72, scaleY: 0.54, duration: 70, yoyo: true });
    }
  }

  tryAttack() {
    if (this.time.now < this.lastAtk + PLAYER.atkCd) return;
    this.lastAtk = this.time.now;
    let hit = null, bd = PLAYER.atkRange;
    for (const e of this.enemies) { if (!e.alive) continue; const d = Math.hypot(e.spr.x - this.player.x, e.spr.y - this.player.y); if (d < bd) { bd = d; hit = e; } }
    if (hit) this.dir = this.faceDir(hit.spr.x - this.player.x, hit.spr.y - this.player.y);
    this.playAttackAnim();
    const ring = this.add.circle(this.player.x, this.player.y - 6, 10, 0xffffff, 0.3).setDepth(this.player.y + 1);
    this.tweens.add({ targets: ring, radius: PLAYER.atkRange, alpha: 0, duration: 200, onComplete: () => ring.destroy() });
    if (!hit) return;
    const dmg = Math.max(1, Math.round((PLAYER.atkDmg + (this.gearDmg || 0) + this.gearStats().str) * (this.buffStr > this.time.now ? 1.25 : 1)));
    this.time.delayedCall(80, () => {
      if (!hit.alive) return;
      hit.hp -= dmg; hit.bar.setVisible(true);
      const dx = hit.spr.x - this.player.x, dy = hit.spr.y - this.player.y, len = Math.hypot(dx, dy) || 1;
      hit.spr.x += (dx / len) * 14; hit.spr.y += (dy / len) * 14;
      this.flash(hit.spr, 0xff5566);
      this.hitEffect(hit.spr.x, hit.spr.y - 8);
      this.floatText(hit.spr.x, hit.spr.y - 18, `-${dmg}`, "#ffd24a");
      if (hit.hp <= 0) this.killGoblin(hit);
    });
  }

  killGoblin(e) {
    e.alive = false; e.respawnAt = this.time.now + GOB.respawnMs; e.bar.setVisible(false);
    const drop = e.guard ? 3 : 1;
    this.stats.gold += drop; this.stats.xp += 12;
    this.floatText(e.spr.x, e.spr.y - 10, `+${drop} gold`, "#ffe27a");
    this.tweens.add({ targets: e.spr, alpha: 0, scaleX: 0.2, scaleY: 0.2, duration: 260, onComplete: () => e.spr.setVisible(false) });
    this.updateHud();
  }

  hurtPlayer(n, fromX, fromY) {
    if (this.time.now < this.invuln) return;
    this.invuln = this.time.now + (this.buffDef > this.time.now ? 1500 : 700);
    this.stats.hp = Math.max(0, this.stats.hp - n);
    this.flash(this.player, 0xff4444); this.cameras.main.shake(120, 0.006);
    const dx = this.player.x - fromX, dy = this.player.y - fromY, len = Math.hypot(dx, dy) || 1;
    this.player.x += (dx / len) * 18; this.player.y += (dy / len) * 18;
    this.floatText(this.player.x, this.player.y - 30, `-${n}`, "#ff7a7a");
    this.updateHud();
    if (this.stats.hp <= 0) this.respawnPlayer();
  }

  respawnPlayer() {
    this.player.x = this.cx; this.player.y = this.cy; this.onBoat = false;
    this.stats.hp = this.maxHp;
    this.floatText(this.cx, this.cy - 40, "Respawned at village", "#9fe7ff");
    this.updateHud();
    this.onChat?.({ sys: true, text: "A goblin knocked you out — you woke back in the village." });
  }

  updateEnemies(dt) {
    for (const e of this.enemies) {
      if (!e.alive) {
        if (this.time.now >= e.respawnAt) { e.hp = GOB.maxHp; e.alive = true; e.spr.x = e.home.x * 32 + 16; e.spr.y = e.home.y * 32 + 18; e.spr.setAlpha(1).setScale(0.66).setVisible(true); }
        continue;
      }
      const pdx = this.player.x - e.spr.x, pdy = this.player.y - e.spr.y, pd = Math.hypot(pdx, pdy);
      let mx = 0, my = 0;
      if (pd < GOB.aggro) { mx = pdx / (pd || 1); my = pdy / (pd || 1); }
      else {
        e.wt -= dt;
        if (e.wt <= 0) { e.wt = 1.2 + Math.abs(Math.sin(e.spr.x * 0.7 + e.spr.y)) * 1.6; const a = (e.spr.x * 12.9 + e.spr.y * 78.2) % (Math.PI * 2); e.wvx = Math.cos(a); e.wvy = Math.sin(a); }
        const hdx = e.home.x * 32 + 16 - e.spr.x, hdy = e.home.y * 32 + 18 - e.spr.y;
        if (Math.hypot(hdx, hdy) > GOB.wander) { const l = Math.hypot(hdx, hdy) || 1; mx = hdx / l; my = hdy / l; }
        else { mx = e.wvx * 0.5; my = e.wvy * 0.5; }
      }
      const nx = e.spr.x + mx * GOB.speed * dt, ny = e.spr.y + my * GOB.speed * dt;
      const tx = Math.floor(nx / 32), ty = Math.floor(ny / 32);
      if (isLand(this.terrain, tx, ty) && !this.blocked.has(`${tx},${ty}`)) { e.spr.x = nx; e.spr.y = ny; }
      if (mx || my) { const nd = this.faceDir(mx, my); if (nd !== e.dir && this.textures.exists(`gob_${nd}`)) { e.dir = nd; e.spr.setTexture(`gob_${nd}`); } }
      e.spr.setDepth(e.spr.y);
      if (e.bar.visible) { e.bar.setPosition(e.spr.x, e.spr.y - 24).setDepth(e.spr.y + 1); e.bar.width = 26 * (e.hp / GOB.maxHp); }
      if (pd < GOB.contactDist && this.time.now > e.lastContact + GOB.contactCd) { e.lastContact = this.time.now; this.hurtPlayer(GOB.contactDmg, e.spr.x, e.spr.y); }
    }
  }

  updateHud() {
    const h = this.hud; if (!h) return;
    const { lv } = xpInLevel(this.stats.xp);
    if (this._lv !== lv) { this._lv = lv; this.myLabel?.setText(`${this.me?.name || "you"} Lv ${lv}`); }
    if (h.wood) h.wood.textContent = this.stats.wood;
    if (h.stone) h.stone.textContent = this.stats.stone;
    if (h.gold) h.gold.textContent = this.stats.gold;
    if (h.lvl) h.lvl.textContent = `Lv ${lv}`;
    if (h.hp) h.hp.style.width = `${Math.round((this.stats.hp / this.maxHp) * 100)}%`;
  }

  update(_t, dms) {
    const dt = dms / 1000;
    this.foamT += dt;

    if (this.ambient) {
      // slow cinematic drift over the island for the login backdrop
      this.camDrift += dt * 0.05;
      this.cameras.main.centerOn(this.cx + Math.cos(this.camDrift) * 360, this.cy + Math.sin(this.camDrift * 0.8) * 250);
      this.updateNodes(); this.updateNpcs(dt); this.updateBots(dt);
      if (this.minimap) this.drawMinimap();
      return;
    }

    let vx = 0, vy = 0;
    if (this.cursors.left.isDown || this.keys.A.isDown) vx = -1;
    else if (this.cursors.right.isDown || this.keys.D.isDown) vx = 1;
    if (this.cursors.up.isDown || this.keys.W.isDown) vy = -1;
    else if (this.cursors.down.isDown || this.keys.S.isDown) vy = 1;

    if (vx || vy) { this.autoTarget = null; this.path = null; } // manual input cancels click-to-move
    else {
      if (this.path && this.path.length) {
        const wp = this.path[0], dx = wp.x - this.player.x, dy = wp.y - this.player.y, d = Math.hypot(dx, dy);
        if (d < 8) this.path.shift();
        else { vx = dx / d; vy = dy / d; }
      }
      if ((!this.path || !this.path.length) && this.autoTarget) {
        const at = this.autoTarget, ref = at.ref;
        if (!ref.alive) this.autoTarget = null;
        else {
          const txp = at.type === "node" ? ref.x : ref.spr.x, typ = at.type === "node" ? ref.y : ref.spr.y;
          const dd = Math.hypot(txp - this.player.x, typ - this.player.y);
          if (dd <= (at.type === "node" ? GATHER_RANGE : PLAYER.atkRange)) {
            this.dir = this.faceDir(txp - this.player.x, typ - this.player.y);
            if (!this.onBoat && !this._attacking) this.player.setTexture(`hero_${this.dir}`);
            at.type === "node" ? this.gatherNode(ref) : this.tryAttack();
          } else this.autoTarget = null;
        }
      }
    }

    const moving = !!(vx || vy);
    if (moving) {
      const len = Math.hypot(vx, vy), W = this.terrain.W, H = this.terrain.H;
      const spd = SPEED * (1 + this.gearStats().agi * 0.03) * (this.buffSpd > this.time.now ? 1.25 : 1);
      const stepX = (vx / len) * spd * dt, stepY = (vy / len) * spd * dt;
      const stand = (wx, wy) => {
        const tx = Math.floor(wx / 32), ty = Math.floor(wy / 32);
        const inB = tx >= 0 && ty >= 0 && tx < W && ty < H;
        const bridge = this.bridges.has(`${tx},${ty}`);
        const water = inB && this.terrain.tiles[ty * W + tx] === this.terrain.allWater && !bridge;
        const landOk = (isLand(this.terrain, tx, ty) || bridge) && !this.blocked.has(`${tx},${ty}`);
        return { ok: water || landOk, water };
      };
      // axis-separated collision so you slide along obstacles
      let px = this.player.x, py = this.player.y, water = this.onBoat;
      const rx = stand(px + stepX, py); if (rx.ok) { px += stepX; water = rx.water; }
      const ry = stand(px, py + stepY); if (ry.ok) { py += stepY; water = ry.water; }
      this.player.x = px; this.player.y = py; this.onBoat = water;
      const nd = this.faceDir(vx, vy); if (nd !== this.dir) this.dir = nd;
      this.player.setDepth(this.player.y);
      if (this.onBoat) { this.player.anims.stop(); this.player.setTexture(`hero_${this.dir}`); }
      else this.player.anims.play(`walk_${this.dir}`, true);
      if (_t - this.lastSent > 70) { this.lastSent = _t; this.net.send("move", { x: Math.round(this.player.x), y: Math.round(this.player.y), dir: this.dir, boat: this.onBoat }); }
    } else if (this.moving) { this.player.anims.stop(); this.player.setTexture(`hero_${this.dir}`); }
    this.moving = moving;

    // ride the boat while on water — bow points the way you sail, foam at the waterline
    if (this.onBoat) {
      this.boat.setVisible(true).setPosition(this.player.x, this.player.y + 9).setDepth(this.player.y - 1).setRotation(BOAT_ROT[this.dir] || 0);
      const pulse = 1 + Math.sin(this.foamT * 4) * 0.06;
      this.boatFoam.setVisible(true).setPosition(this.player.x, this.player.y + 13).setDepth(this.player.y - 1.5).setScale(pulse);
    } else { this.boat.setVisible(false); this.boatFoam.setVisible(false); }

    // foam wake trailing the boat as it sails
    this._wakeT += dt;
    if (this.onBoat && this.moving && this._wakeT > 0.06) { this._wakeT = 0; this.wake.emitParticleAt(this.player.x, this.player.y + 12); }

    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) this.tryGather();
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.tryAttack();

    this.updateNodes(); this.updateNpcs(dt); this.updateEnemies(dt); this.updateBots(dt); this.updateHint();
    this.myLabel.setPosition(this.player.x, this.player.y - 26);
    for (const [id, spr] of this.others) {
      const dx = spr.target.x - spr.x, dy = spr.target.y - spr.y, dist = Math.hypot(dx, dy);
      spr.x += dx * Math.min(1, dt * 10); spr.y += dy * Math.min(1, dt * 10); spr.setDepth(spr.y);
      if (spr.onBoat) {
        spr.anims.stop(); if (spr.texture.key !== `hero_${spr.dir}`) spr.setTexture(`hero_${spr.dir}`);
        spr.boat.setVisible(true).setPosition(spr.x, spr.y + 9).setDepth(spr.y - 1).setRotation(BOAT_ROT[spr.dir] || 0);
        spr.boatFoam?.setVisible(true).setPosition(spr.x, spr.y + 13).setDepth(spr.y - 1.5);
        if (dist > 1.2 && this.wake && this.time.now - (spr._wk || 0) > 110) { spr._wk = this.time.now; this.wake.emitParticleAt(spr.x, spr.y + 12); }
      } else {
        spr.boat?.setVisible(false); spr.boatFoam?.setVisible(false);
        if (dist > 1.2) spr.anims.play(`walk_${spr.dir}`, true);
        else { spr.anims.stop(); if (spr.texture.key !== `hero_${spr.dir}`) spr.setTexture(`hero_${spr.dir}`); }
      }
      const lab = this.labels.get(id); if (lab) lab.setPosition(spr.x, spr.y - 26);
    }
    if (this.minimap) this.drawMinimap();
  }

  updateNodes() {
    for (const n of this.nodes) if (!n.alive && this.time.now >= n.respawnAt) {
      n.alive = true; n.points = n.max;
      if (n.blockKey) this.blocked.add(n.blockKey);
      this.tweens.add({ targets: n.sprite, scale: n.base, alpha: 1, angle: 0, duration: 220 });
    }
  }

  updateNpcs(dt) {
    for (const n of this.npcs) {
      n.phase += dt;
      const tx = n.hx + Math.cos(n.phase * 0.5) * 22, ty = n.hy + Math.sin(n.phase * 0.35) * 16;
      const dx = tx - n.spr.x, dy = ty - n.spr.y;
      if (Math.hypot(dx, dy) > 1) {
        n.spr.x += dx * Math.min(1, dt * 2); n.spr.y += dy * Math.min(1, dt * 2);
        const nd = this.faceDir(dx, dy);
        if (nd !== n.dir && this.textures.exists(`npc_${n.kind}_${nd}`)) { n.dir = nd; n.spr.setTexture(`npc_${n.kind}_${nd}`); }
      }
      n.spr.setDepth(n.spr.y); n.label.setPosition(n.spr.x, n.spr.y - 30);
    }
  }

  updateHint() {
    let gd = GATHER_RANGE, node = null;
    for (const n of this.nodes) { if (!n.alive) continue; const d = Math.hypot(n.x - this.player.x, n.y - this.player.y); if (d < gd) { gd = d; node = n; } }
    let nd = TALK_RANGE, npc = null;
    for (const n of this.npcs) { const d = Math.hypot(n.spr.x - this.player.x, n.spr.y - this.player.y); if (d < nd) { nd = d; npc = n; } }
    if (npc) this.bubble.setText(`${npc.name}: ${npc.line}`).setPosition(npc.spr.x, npc.spr.y - 44).setVisible(true);
    else this.bubble.setVisible(false);
    const h = this.hud?.hint; if (!h) return;
    if (node) { h.textContent = `E — gather ${node.kind}`; h.classList.remove("hidden"); }
    else h.classList.add("hidden");
  }

  drawMinimap() {
    const c = this.minimap, ctx = c.getContext("2d"), W = this.terrain.W, H = this.terrain.H, s = c.width / W;
    if (!this._mmBase) {
      this._mmBase = document.createElement("canvas"); this._mmBase.width = c.width; this._mmBase.height = c.height;
      const b = this._mmBase.getContext("2d");
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { b.fillStyle = isLand(this.terrain, x, y) ? "#6fae3e" : "#3f7fb8"; b.fillRect(x * s, y * s, Math.ceil(s), Math.ceil(s)); }
    }
    ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(this._mmBase, 0, 0);
    for (const e of this.enemies || []) { if (!e.alive) continue; ctx.fillStyle = "#ff5566"; ctx.fillRect((e.spr.x / 32) * s - 1, (e.spr.y / 32) * s - 1, 2, 2); }
    for (const n of this.npcs) { ctx.fillStyle = "#9fe7ff"; ctx.fillRect((n.spr.x / 32) * s - 1, (n.spr.y / 32) * s - 1, 2, 2); }
    for (const b of this.bots || []) { ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect((b.spr.x / 32) * s - 1, (b.spr.y / 32) * s - 1, 2, 2); }
    for (const spr of this.others.values()) { ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect((spr.x / 32) * s - 1, (spr.y / 32) * s - 1, 2, 2); }
    if (!this.ambient) { ctx.fillStyle = "#ffe27a"; ctx.fillRect((this.player.x / 32) * s - 2, (this.player.y / 32) * s - 2, 4, 4); }
  }
}

export function startGame({ world, minimap }) {
  const game = new Phaser.Game({
    type: Phaser.AUTO, parent: "game", backgroundColor: "#3aa0c8", pixelArt: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    physics: { default: "arcade" },
  });
  fetch("/assets/tileset.json").then((r) => r.json()).then((meta) => {
    WorldScene.prototype._meta = meta;
    game.scene.add("world", WorldScene, true, { world: { ...world, meta }, minimap });
  });
  return game;
}
