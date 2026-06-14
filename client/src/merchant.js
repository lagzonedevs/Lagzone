/* Per-NPC shops. Each villager sells different wares. The Blacksmith runs the
   Armory: gear with stat bonuses you can buy with resources once you hit the
   level requirement — or pay USDC to skip the wait and equip it now. */
import { connectWallet, payUSDC, getProvider } from "./solana";

const ICON = (k) => `/assets/icons/${k}.png`;

// ---- gear (Armory) ----
const GEAR = [
  { id: "club", slot: "weapon", icon: "gold", name: "Wooden Club", str: 1, levelReq: 1, cost: { wood: 40 }, usdc: 0.10 },
  { id: "sword", slot: "weapon", icon: "gold", name: "Iron Sword", str: 3, levelReq: 3, cost: { wood: 120, stone: 30 }, usdc: 0.30 },
  { id: "saber", slot: "weapon", icon: "gold", name: "Brutal Saber", str: 5, agi: 1, levelReq: 6, cost: { wood: 200, gold: 50 }, usdc: 0.60 },
  { id: "vest", slot: "armor", icon: "stone", name: "Leather Vest", vit: 1, levelReq: 1, cost: { wood: 40 }, usdc: 0.10 },
  { id: "chain", slot: "armor", icon: "stone", name: "Chainmail", vit: 3, levelReq: 3, cost: { stone: 100 }, usdc: 0.30 },
  { id: "brig", slot: "armor", icon: "stone", name: "Gleaming Brigandine", vit: 3, agi: 1, levelReq: 6, cost: { stone: 80, gold: 50 }, usdc: 0.60 },
  { id: "boots", slot: "shoes", icon: "wood", name: "Worn Boots", agi: 1, levelReq: 1, cost: { wood: 30 }, usdc: 0.10 },
  { id: "strider", slot: "shoes", icon: "wood", name: "Vicious Striders", agi: 3, levelReq: 4, cost: { wood: 60, gold: 30 }, usdc: 0.45 },
];

// ---- potions / consumables, distinct per merchant ----
const P = {
  hpS: { icon: "heart", name: "Health Potion (Small)", desc: "Restore 40% HP", cost: { wood: 30, meat: 5 }, fx: { healPct: 0.4 } },
  hpL: { icon: "heart", name: "Health Potion (Large)", desc: "Restore full HP", cost: { wood: 80, meat: 12 }, fx: { healPct: 1 } },
  str: { icon: "gold", name: "Strength Elixir", desc: "+25% damage · 5 min", cost: { wood: 70, gold: 10 }, fx: { buff: "str", ms: 300000 } },
  spd: { icon: "wood", name: "Swiftness Potion", desc: "+25% move speed · 5 min", cost: { wood: 50, gold: 5 }, fx: { buff: "spd", ms: 300000 } },
  def: { icon: "stone", name: "Ironskin Potion", desc: "Take fewer hits · 5 min", cost: { wood: 70, gold: 10 }, fx: { buff: "def", ms: 300000 } },
  charm: { icon: "gold", name: "Lucky Charm", desc: "+50% XP · 10 min", cost: { gold: 15 }, fx: { buff: "xp", ms: 600000 } },
  scholar: { icon: "gold", name: "Scholar's Brew", desc: "+50% XP · 15 min", cost: { wood: 120, gold: 20 }, fx: { buff: "xp", ms: 900000 } },
  tome: { icon: "gold", name: "Greater Tome", desc: "+50% XP · 30 min", cost: { wood: 150, gold: 30 }, fx: { buff: "xp", ms: 1800000 } },
  meat: { icon: "meat", name: "Meat Bundle", desc: "+20 meat for guardians", cost: { wood: 40 }, fx: { give: { meat: 20 } } },
  stew: { icon: "heart", name: "Hearty Stew", desc: "Restore full HP", cost: { wood: 30, meat: 8 }, fx: { healPct: 1 } },
};

const SHOPS = {
  blacksmith: { title: "Brom's Armory", sub: "Forge your might. Reach the level — or pay USDC to skip it.", type: "gear", items: GEAR },
  villager: { title: "Merrik's Apothecary", sub: "Healing draughts and battle tonics.", type: "potion", items: [P.hpS, P.hpL, P.str] },
  trader: { title: "Pell's Trading Post", sub: "Tonics for the road ahead.", type: "potion", items: [P.spd, P.def, P.charm] },
  elder: { title: "Vossa's Sanctum", sub: "Wisdom, distilled.", type: "potion", items: [P.scholar, P.tome, P.def] },
  fisher: { title: "Ko's Fishmonger", sub: "Fresh from the sea.", type: "potion", items: [P.meat, P.stew] },
};

let panel, wallet = null;

function toast(msg, kind) {
  let t = document.getElementById("shopToast");
  if (!t) { t = document.createElement("div"); t.id = "shopToast"; document.getElementById("hud").appendChild(t); }
  t.className = `shop-toast ${kind || ""}`; t.innerHTML = msg; t.style.opacity = "1";
  clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = "0"; }, kind === "ok" ? 7000 : 4500);
}
const costHtml = (cost) => Object.entries(cost).map(([k, v]) => `<span class="mcost"><img src="${ICON(k)}"/>${v}</span>`).join("");
const statHtml = (g) => ["str", "agi", "vit"].filter((s) => g[s]).map((s) => `${s.toUpperCase()} +${g[s]}`).join(" · ");

function renderPotion(shop, list) {
  const s = window.LZ?.stats?.() || {};
  for (const p of shop.items) {
    const afford = Object.entries(p.cost).every(([k, v]) => (s[k] || 0) >= v);
    const row = document.createElement("div"); row.className = "shop-row";
    row.innerHTML = `<img class="shop-ic" src="${ICON(p.icon)}"/>
      <div class="shop-meta"><b>${p.name}</b><span>${p.desc}</span><div class="mcosts">${costHtml(p.cost)}</div></div>
      <button class="wbtn sm shop-buy ${afford ? "" : "dis"}">Buy</button>`;
    row.querySelector(".shop-buy").onclick = () => { const r = window.LZ?.buyPotion?.(p.cost, p.fx); if (r?.ok) { toast(`Brewed <b>${p.name}</b>`, "ok"); renderInto(shop); } else toast(r?.msg || "Cannot brew", "err"); };
    list.appendChild(row);
  }
}

function renderGear(shop, list) {
  const st = window.LZ?.stats?.() || {}, eq = window.LZ?.equipped?.() || {};
  for (const g of shop.items) {
    const equipped = eq[g.slot]?.id === g.id;
    const meetLvl = (st.lv || 1) >= g.levelReq;
    const afford = meetLvl && Object.entries(g.cost).every(([k, v]) => (st[k] || 0) >= v);
    const row = document.createElement("div"); row.className = "shop-row gear";
    row.innerHTML = `<img class="shop-ic" src="${ICON(g.icon)}"/>
      <div class="shop-meta"><b>${g.name}</b><span>${g.slot} · ${statHtml(g)} · <i>Lv ${g.levelReq}</i></span><div class="mcosts">${costHtml(g.cost)}</div></div>
      <div class="gear-btns">
        <button class="wbtn sm g-res ${afford ? "" : "dis"}">${equipped ? "Owned" : "Buy"}</button>
        <button class="wbtn sm primary g-usd">◎ $${g.usdc.toFixed(2)}</button>
      </div>`;
    row.querySelector(".g-res").onclick = () => {
      if (equipped) return;
      const r = window.LZ?.buyGear?.(g, false);
      if (r?.ok) { toast(`Equipped <b>${g.name}</b>`, "ok"); renderInto(shop); }
      else toast(r?.msg || "Cannot buy", "err");
    };
    row.querySelector(".g-usd").onclick = (e) => buyGearUsdc(g, e.target, shop);
    list.appendChild(row);
  }
}

async function buyGearUsdc(g, btn, shop) {
  const orig = btn.textContent;
  try {
    if (!getProvider()) { toast("No Phantom wallet. <a href='https://phantom.app' target='_blank'>Get Phantom →</a>", "err"); return; }
    if (!wallet) { btn.textContent = "Connecting…"; wallet = await connectWallet(); }
    btn.textContent = "Confirm…"; btn.disabled = true;
    const sig = await payUSDC(g.usdc);
    window.LZ?.buyGear?.(g, true);
    toast(`Bought &amp; equipped <b>${g.name}</b> · <a href="https://solscan.io/tx/${sig}" target="_blank">tx ↗</a>`, "ok");
    renderInto(shop);
  } catch (e) { btn.textContent = orig; btn.disabled = false; toast(`Payment failed: ${(e.message || e).toString().slice(0, 70)}`, "err"); }
}

function renderInto(shop) {
  const list = panel.querySelector("#mList"); list.innerHTML = "";
  if (shop.type === "gear") renderGear(shop, list); else renderPotion(shop, list);
}

function build() {
  panel = document.createElement("div");
  panel.id = "merchant"; panel.className = "wood-frame hidden";
  panel.innerHTML = `<div class="panel-head"><span id="mTitle">Merchant</span><span class="x" id="mClose">×</span></div>
    <div class="shop-sub" id="mSub"></div><div id="mList" class="shop-list"></div>`;
  document.getElementById("hud").appendChild(panel);
  panel.querySelector("#mClose").onclick = () => panel.classList.add("hidden");
}

export function openShop(kind) {
  if (!panel) build();
  const shop = SHOPS[kind] || SHOPS.villager;
  panel.querySelector("#mTitle").textContent = shop.title;
  panel.querySelector("#mSub").textContent = shop.sub;
  panel.classList.remove("hidden");
  if (getProvider()?.publicKey) wallet = getProvider().publicKey.toString();
  renderInto(shop);
}
