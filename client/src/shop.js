/* Lagzone Marketplace — a real USDC (Solana) store. Buy items/packs/boosts with
   USDC paid to the project treasury; rewards are granted in-game on success. */
import { connectWallet, payUSDC, getProvider, TREASURY } from "./solana";

const ITEMS = [
  { id: "heal5", cat: "potion", icon: "heart", name: "Self-Heal ×5", desc: "Restore full health 5 times", price: 0.10, grant: { heals: 5 } },
  { id: "meat20", cat: "potion", icon: "meat", name: "Meat Bundle", desc: "+20 meat to revive guardians", price: 0.20, grant: { meat: 20 } },
  { id: "wood500", cat: "pack", icon: "wood", name: "Wood Crate", desc: "+500 wood instantly", price: 0.30, grant: { wood: 500 } },
  { id: "stone500", cat: "pack", icon: "stone", name: "Stone Crate", desc: "+500 stone instantly", price: 0.30, grant: { stone: 500 } },
  { id: "gold500", cat: "pack", icon: "gold", name: "Gold Pouch", desc: "+500 gold instantly", price: 0.50, grant: { gold: 500 } },
  { id: "str", cat: "boost", icon: "gold", name: "Strength Boost", desc: "+25% damage · 1 hour", price: 0.25, grant: { buff: "str" } },
  { id: "spd", cat: "boost", icon: "gold", name: "Swiftness Boost", desc: "+25% move speed · 1 hour", price: 0.25, grant: { buff: "spd" } },
];
const CATS = [["all", "All"], ["pack", "Packs"], ["boost", "Boosts"], ["potion", "Potions"]];
const ICON = (k) => `/assets/icons/${k}.png`;
const short = (s) => s.slice(0, 4) + "…" + s.slice(-4);

let panel, wallet = null, cat = "all";

function toast(msg, kind) {
  let t = document.getElementById("shopToast");
  if (!t) { t = document.createElement("div"); t.id = "shopToast"; document.getElementById("hud").appendChild(t); }
  t.className = `shop-toast ${kind || ""}`; t.innerHTML = msg; t.style.opacity = "1";
  clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = "0"; }, kind === "ok" ? 8000 : 5000);
}

function render() {
  const list = panel.querySelector("#shopList");
  list.innerHTML = "";
  for (const it of ITEMS.filter((i) => cat === "all" || i.cat === cat)) {
    const row = document.createElement("div"); row.className = "shop-row";
    row.innerHTML = `
      <img class="shop-ic" src="${ICON(it.icon)}" onerror="this.style.visibility='hidden'" />
      <div class="shop-meta"><b>${it.name}</b><span>${it.desc}</span></div>
      <div class="shop-price">$${it.price.toFixed(2)}<em>USDC</em></div>
      <button class="wbtn sm shop-buy">Buy</button>`;
    row.querySelector(".shop-buy").onclick = (e) => buy(it, e.target);
    list.appendChild(row);
  }
  const wbtn = panel.querySelector("#shopWallet");
  wbtn.textContent = wallet ? short(wallet) : "Connect Wallet";
}

async function buy(it, btn) {
  const orig = btn.textContent;
  try {
    if (!getProvider()) { toast("No Phantom wallet found. <a href='https://phantom.app' target='_blank'>Get Phantom →</a>", "err"); return; }
    if (!wallet) { btn.textContent = "Connecting…"; wallet = await connectWallet(); render(); }
    btn.textContent = "Confirm in wallet…"; btn.disabled = true;
    const sig = await payUSDC(it.price);
    window.LZ?.grant?.(it.grant);
    btn.textContent = "Owned ✓";
    toast(`Purchased <b>${it.name}</b> · <a href="https://solscan.io/tx/${sig}" target="_blank">view tx ↗</a>`, "ok");
  } catch (e) {
    btn.textContent = orig; btn.disabled = false;
    toast(`Payment failed: ${(e.message || e).toString().slice(0, 80)}`, "err");
  }
}

function build() {
  panel = document.createElement("div");
  panel.id = "market"; panel.className = "wood-frame hidden";
  panel.innerHTML = `
    <div class="panel-head"><span>Marketplace</span><span class="x" id="shopClose">×</span></div>
    <div class="shop-sub">Pay with <b>USDC</b> on Solana · treasury <code>${short(TREASURY.toString())}</code></div>
    <button id="shopWallet" class="wbtn sm" style="margin:0 14px 8px">Connect Wallet</button>
    <div class="shop-cats" id="shopCats"></div>
    <div id="shopList" class="shop-list"></div>`;
  document.getElementById("hud").appendChild(panel);
  panel.querySelector("#shopClose").onclick = () => panel.classList.add("hidden");
  panel.querySelector("#shopWallet").onclick = async () => { try { wallet = await connectWallet(); render(); } catch (e) { toast(e.message, "err"); } };
  const cats = panel.querySelector("#shopCats");
  for (const [id, label] of CATS) {
    const b = document.createElement("button"); b.className = "shop-cat" + (id === cat ? " on" : ""); b.textContent = label;
    b.onclick = () => { cat = id; cats.querySelectorAll(".shop-cat").forEach((x) => x.classList.toggle("on", x === b)); render(); };
    cats.appendChild(b);
  }
}

export function openShop() {
  if (!panel) build();
  const hidden = panel.classList.toggle("hidden");
  if (!hidden) { const p = getProvider(); if (p?.publicKey) wallet = p.publicKey.toString(); render(); }
  return !hidden;
}
