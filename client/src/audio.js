/* Cozy, cheerful ambient soundscape (Web Audio, no files):
   a gentle flowing-stream wash, little birds chirping, and soft music-box notes
   on a major pentatonic. Bright and relaxing — not eerie. Loops forever. */
let ctx, master, soft, birdBus, musicBus, started = false;
let muted = localStorage.getItem("lz_mute") === "1";
let vol = parseFloat(localStorage.getItem("lz_vol") || "0.55");

function brownNoise(sec) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.0; }
  return buf;
}
function lfo(freq, depth, target, type = "sine") {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = depth; o.connect(g); g.connect(target); o.start();
}

function buildStream() {
  // bright, trickling water (band-passed noise that bubbles)
  const src = ctx.createBufferSource(); src.buffer = brownNoise(4); src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.value = 0.13;
  src.connect(bp); bp.connect(g); g.connect(soft);
  lfo(0.4, 0.05, g.gain); lfo(0.7, 0.035, g.gain, "triangle"); lfo(0.25, 420, bp.frequency);
  // smooth low water bed (calm, not a deep ominous rumble)
  const low = ctx.createBufferSource(); low.buffer = brownNoise(4); low.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520; lp.Q.value = 0.3;
  const lg = ctx.createGain(); lg.gain.value = 0.09;
  low.connect(lp); lp.connect(lg); lg.connect(soft);
  lfo(0.1, 0.04, lg.gain);
  src.start(); low.start();
}

function chirp() {
  if (!ctx) return;
  const t = ctx.currentTime, n = 2 + Math.floor(Math.random() * 3), base = 2400 + Math.random() * 1300;
  for (let i = 0; i < n; i++) {
    const st = t + i * (0.07 + Math.random() * 0.05);
    const o = ctx.createOscillator(); o.type = "triangle";
    const g = ctx.createGain(); g.gain.value = 0.0001;
    o.connect(g); g.connect(birdBus);
    const f0 = base * (0.9 + Math.random() * 0.25);
    o.frequency.setValueAtTime(f0, st);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.12 + Math.random() * 0.25), st + 0.04);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.86, st + 0.09);
    g.gain.exponentialRampToValueAtTime(0.13, st + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.1);
    o.start(st); o.stop(st + 0.13);
  }
  setTimeout(chirp, 2500 + Math.random() * 6500);
}

function pluck(freq, st, vel) {
  const o = ctx.createOscillator(); o.type = "sine";
  const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = freq * 2.01;
  const g = ctx.createGain(); g.gain.value = 0.0001;
  const g2 = ctx.createGain(); g2.gain.value = 0.0001;
  o.connect(g); o2.connect(g2); g.connect(musicBus); g2.connect(musicBus);
  o.frequency.value = freq;
  g.gain.exponentialRampToValueAtTime(vel, st + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.7);
  g2.gain.exponentialRampToValueAtTime(vel * 0.28, st + 0.006); g2.gain.exponentialRampToValueAtTime(0.0001, st + 0.35);
  o.start(st); o.stop(st + 0.75); o2.start(st); o2.stop(st + 0.4);
}
function melody() {
  if (!ctx) return;
  const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; // C D E G A C — major pentatonic, bright
  const t = ctx.currentTime, n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) pluck(scale[Math.floor(Math.random() * scale.length)], t + i * 0.19, 0.1);
  setTimeout(melody, 3800 + Math.random() * 5200);
}

export function startAudio() {
  if (started) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  started = true;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0;
  const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 5200; tone.Q.value = 0.2;
  soft = ctx.createGain(); soft.gain.value = 1; soft.connect(tone); tone.connect(master); master.connect(ctx.destination);
  birdBus = ctx.createGain(); birdBus.gain.value = 0.5; birdBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.5;
  const mlp = ctx.createBiquadFilter(); mlp.type = "lowpass"; mlp.frequency.value = 3200; musicBus.connect(mlp); mlp.connect(master);
  master.gain.linearRampToValueAtTime(muted ? 0 : vol, ctx.currentTime + 3);
  buildStream();
  setTimeout(chirp, 1500); setTimeout(melody, 2500);
  document.addEventListener("pointerdown", () => ctx.resume(), { once: true });
}

export function isMuted() { return muted; }
export function getVolume() { return vol; }
export function setMuted(m) { muted = m; localStorage.setItem("lz_mute", m ? "1" : "0"); if (master) master.gain.setTargetAtTime(m ? 0 : vol, ctx.currentTime, 0.4); }
export function setVolume(v) { vol = Math.max(0, Math.min(1, v)); localStorage.setItem("lz_vol", vol.toString()); if (master && !muted) master.gain.setTargetAtTime(vol, ctx.currentTime, 0.25); }
