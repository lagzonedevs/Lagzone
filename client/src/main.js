import "./style.css";
import { Buffer } from "buffer";
window.global = window.global || window;
if (!window.Buffer) window.Buffer = Buffer;
import { Net } from "./net";
import { startGame } from "./game";
import { openShop } from "./shop";
import { openShop as openNpcShop } from "./merchant";
import { startAudio, setMuted, setVolume, isMuted, getVolume } from "./audio";
window.LZ_openShop = (kind, name) => openNpcShop(kind, name);

const WS_URL = (import.meta.env.VITE_LAGZONE_WS || (location.hostname === "localhost" ? "ws://localhost:8920" : "")).trim().replace(/^[^a-zA-Z]+/, "");
const HTTP_URL = WS_URL.replace(/^ws/, "http");
const X_URL = "https://x.com/lagzone";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nameColor = (s) => `hsl(${[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) * 47 % 360}, 60%, 42%)`;

let net, game, wallet = null, online = 0;

// ---- wallet ----
const shortAddr = (a) => a.slice(0, 4) + "…" + a.slice(-4);
async function connectWallet() {
  const p = window.phantom?.solana || window.solana;
  if (!p?.isPhantom) { window.open("https://phantom.app/", "_blank"); return null; }
  try {
    const res = await p.connect();
    wallet = res.publicKey.toString();
    const s = shortAddr(wallet);
    $("walletBtn").textContent = s; $("walletBtn2").textContent = s;
    if (net && net.send) net.send("join", { name: currentName, wallet });
    return wallet;
  } catch { return null; }
}
// in-game button: just connect. landing button: connect then jump straight into the game.
$("walletBtn").onclick = connectWallet;
$("walletBtn2").onclick = async () => {
  const w = await connectWallet();
  if (w) enterGame(w.slice(0, 4) + w.slice(-4));
};

// ---- landing online count ----
async function pollHealth() {
  if (!HTTP_URL) return;
  try { const h = await (await fetch(HTTP_URL + "/health")).json(); setOnline(h.online ?? 0); } catch {}
}
function setOnline(n) { online = n; const b = `${n}`; $("onlineLand").querySelector("b").textContent = b; $("onlinePill").querySelector("b").textContent = b; }
$("xlink").href = X_URL;
pollHealth(); setInterval(pollHealth, 15000);

// ---- flow ----
$("playBtn").onclick = () => { $("nameModal").classList.remove("hidden"); $("heroName").focus(); };
$("spectateBtn").onclick = () => enterGame("Guest" + Math.floor(1000 + Math.random() * 9000));
$("setSail").onclick = () => {
  const n = $("heroName").value.trim();
  if (n.length < 2) { $("heroName").focus(); return; }
  enterGame(n);
};
$("heroName").addEventListener("keydown", (e) => { if (e.key === "Enter") $("setSail").click(); });

// ---- HUD: chat, toolbar, tutorial, inventory ----
const toggle = (id, btn) => { const el = $(id), hid = el.classList.toggle("hidden"); if (btn) $(btn).classList.toggle("on", !hid); return !hid; };
$("chatClose").onclick = () => { $("chat").classList.add("hidden"); $("tbChat").classList.remove("on"); };
$("tbChat").onclick = () => toggle("chat", "tbChat");
$("tbInv").onclick = () => { if (toggle("inventory", "tbInv")) syncInv(); };
$("tbCtrl").onclick = () => toggle("ctrlpop", "tbCtrl");
$("tbHelp").onclick = () => $("tutorial").classList.remove("hidden");
// sound controls
$("muteBtn").textContent = `Sound: ${isMuted() ? "Off" : "On"}`;
$("volSlider").value = Math.round(getVolume() * 100);
$("muteBtn").onclick = () => { const m = !isMuted(); setMuted(m); $("muteBtn").textContent = `Sound: ${m ? "Off" : "On"}`; };
$("volSlider").oninput = (e) => setVolume(e.target.value / 100);
$("tbShop").onclick = () => { const open = openShop(); $("tbShop").classList.toggle("on", open); };
$("tbMap").onclick = () => window.LZ?.recenter();
document.querySelectorAll("#hud [data-close]").forEach((b) => b.onclick = () => b.closest(".panel").classList.add("hidden"));
$("tbChat").classList.add("on"); // chat open by default

// chat tabs
let chatTab = "public";
document.querySelectorAll(".chat-tabs .tab").forEach((t) => t.onclick = () => {
  document.querySelectorAll(".chat-tabs .tab").forEach((x) => x.classList.remove("active"));
  t.classList.add("active"); chatTab = t.dataset.tab; renderChat();
});

// tutorial (once per browser)
$("tutGo").onclick = $("tutClose").onclick = () => { $("tutorial").classList.add("hidden"); localStorage.setItem("lz_tut", "1"); };
function showTutorial() { if (!localStorage.getItem("lz_tut")) $("tutorial").classList.remove("hidden"); }

// inventory mirror (game writes #statWood/#statStone)
function syncInv() {
  const s = window.LZ?.stats?.() || {};
  $("invWood").textContent = $("statWood").textContent;
  $("invStone").textContent = $("statStone").textContent;
  $("invGold").textContent = $("statGold").textContent;
  $("invMeat").textContent = s.meat ?? 0;
  $("invHeals").textContent = s.heals ?? 0;
  const eq = window.LZ?.equipped?.() || {};
  $("eqWeapon").textContent = eq.weapon?.name || "—";
  $("eqArmor").textContent = eq.armor?.name || "—";
  $("eqShoes").textContent = eq.shoes?.name || "—";
  $("eqStats").textContent = `STR +${eq.str || 0} · AGI +${eq.agi || 0} · VIT +${eq.vit || 0}`;
}
setInterval(() => { if (!$("inventory").classList.contains("hidden")) syncInv(); }, 300);

// active buff indicators
setInterval(() => {
  const buffs = window.LZ?.activeBuffs?.(); const el = $("buffs"); if (!el) return;
  if (!buffs || !buffs.length) { el.innerHTML = ""; return; }
  el.innerHTML = buffs.map((b) => `<span class="buff">${b.label} ${b.sec > 60 ? Math.ceil(b.sec / 60) + "m" : b.sec + "s"}</span>`).join("");
}, 1000);

let currentName = "wanderer";

const DEFAULT_WORLD = { seed: 1337, W: 144, H: 144, tile: 32, players: [] };

// start the world immediately as a live, drifting backdrop behind the login
game = startGame({ world: { seed: DEFAULT_WORLD.seed, W: DEFAULT_WORLD.W, H: DEFAULT_WORLD.H }, minimap: $("minimap") });

function playWhenReady(me, n, onChat, tries = 0) {
  if (window.LZ?.play) return window.LZ.play(me, n, onChat);
  if (tries < 80) setTimeout(() => playWhenReady(me, n, onChat, tries + 1), 50);
}

function enterGame(name) {
  currentName = name;
  $("landing").classList.add("hidden");
  $("nameModal").classList.add("hidden");
  $("hud").classList.remove("hidden");
  showTutorial();
  startAudio();

  // net is optional — the world renders from the seed, multiplayer layers on top
  if (WS_URL) {
    net = new Net(WS_URL).connect();
    net.on("open", () => net.send("join", { name, wallet }));
    net.on("init", (m) => setOnline((m.players ? m.players.length : 0)));
    net.on("spawn", () => setOnline(online + 1));
    net.on("leave", () => setOnline(Math.max(0, online - 1)));
    net.on("chat", addChat);
    net.on("close", () => addChat({ sys: true, text: "reconnecting…" }));
  } else {
    net = { on() {}, send() {} };
    addChat({ sys: true, text: "Server offline — exploring solo. Multiplayer needs the live server." });
  }

  const me = { id: "self", x: (DEFAULT_WORLD.W * DEFAULT_WORLD.tile) / 2, y: (DEFAULT_WORLD.H * DEFAULT_WORLD.tile) / 2, name, level: 1 };
  playWhenReady(me, net, addChat);
}

// ---- chat (Public / Whispers tabs) ----
const chatMsgs = [];
function addChat(m) { chatMsgs.push(m); while (chatMsgs.length > 120) chatMsgs.shift(); if (chatTab === "public") renderChat(); }
function renderChat() {
  const log = $("chatLog");
  if (chatTab === "whispers") { log.innerHTML = `<div class="whisper-empty">No whispers yet. Walk up to a player to say hi!</div>`; return; }
  log.innerHTML = "";
  for (const m of chatMsgs) {
    const div = document.createElement("div");
    if (m.sys || m.from === "system") { div.className = "sys"; div.textContent = m.text; }
    else div.innerHTML = `<span class="nm" style="color:${nameColor(m.name)}">${esc(m.name)}:</span> ${esc(m.text)}`;
    log.appendChild(div);
  }
  log.scrollTop = log.scrollHeight;
}
$("chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("chatInput").value.trim();
  if (v && net) { net.send("chat", { text: v }); }
  $("chatInput").value = "";
});
// keep WASD/arrows out of chat input focus
$("chatInput").addEventListener("keydown", (e) => e.stopPropagation());
