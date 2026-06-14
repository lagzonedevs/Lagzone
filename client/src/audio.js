/* Relaxing ambient soundscape synthesized live with the Web Audio API (no files).
   Ocean-forward: layered wave wash + a soft, low, warm pad drone. Everything runs
   through a master low-pass so nothing is harsh or "whiny". Loops forever. */
let ctx, master, soft, started = false;
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
  const g = ctx.createGain(); g.gain.value = depth;
  o.connect(g); g.connect(target); o.start();
  return o;
}

function buildOcean() {
  // deep, calm undertow
  const deep = ctx.createBufferSource(); deep.buffer = brownNoise(4); deep.loop = true;
  const dlp = ctx.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 240; dlp.Q.value = 0.4;
  const dg = ctx.createGain(); dg.gain.value = 0.22;
  deep.connect(dlp); dlp.connect(dg); dg.connect(soft);
  lfo(0.06, 0.08, dg.gain);

  // surface wave wash — swells in and out like waves on a shore
  const surf = ctx.createBufferSource(); surf.buffer = brownNoise(4); surf.loop = true;
  const slp = ctx.createBiquadFilter(); slp.type = "lowpass"; slp.frequency.value = 900; slp.Q.value = 0.7;
  const sg = ctx.createGain(); sg.gain.value = 0.10;
  surf.connect(slp); slp.connect(sg); sg.connect(soft);
  lfo(0.09, 0.075, sg.gain);          // wave swell
  lfo(0.13, 0.05, sg.gain, "triangle"); // second, faster ripple for natural motion
  lfo(0.05, 320, slp.frequency);       // slow "breaking" sweep

  deep.start(); surf.start();
}

function buildPad() {
  // soft, low, warm drone — a gentle Cadd9 in a low octave, sine voices only
  const pg = ctx.createGain(); pg.gain.value = 0; pg.connect(soft);
  pg.gain.linearRampToValueAtTime(0.085, ctx.currentTime + 8);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700; lp.Q.value = 0.3; lp.connect(pg);
  lfo(0.035, 240, lp.frequency); // slow breathing
  const notes = [130.81, 196.0, 261.63, 293.66]; // C3 G3 C4 D4 — open, calm
  notes.forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
    const vg = ctx.createGain(); vg.gain.value = 0.0; o.connect(vg); vg.connect(lp);
    // each voice swells independently → an evolving, never-static texture
    vg.gain.setValueAtTime(0.0001, ctx.currentTime);
    vg.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 6 + i);
    lfo(0.04 + i * 0.013, 0.12, vg.gain);
    o.start();
  });
}

export function startAudio() {
  if (started) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  started = true;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0;
  // master tone-shaping: gentle low-pass so nothing is ever harsh/whiny
  const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 2400; tone.Q.value = 0.2;
  soft = ctx.createGain(); soft.gain.value = 1;
  soft.connect(tone); tone.connect(master); master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(muted ? 0 : vol, ctx.currentTime + 4);
  buildOcean();
  buildPad();
  const resume = () => ctx.resume();
  document.addEventListener("pointerdown", resume, { once: true });
}

export function isMuted() { return muted; }
export function getVolume() { return vol; }
export function setMuted(m) { muted = m; localStorage.setItem("lz_mute", m ? "1" : "0"); if (master) master.gain.setTargetAtTime(m ? 0 : vol, ctx.currentTime, 0.4); }
export function setVolume(v) { vol = Math.max(0, Math.min(1, v)); localStorage.setItem("lz_vol", vol.toString()); if (master && !muted) master.gain.setTargetAtTime(vol, ctx.currentTime, 0.25); }
