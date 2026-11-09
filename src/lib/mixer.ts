/**
 * Background sound mixer. Ambient sounds are synthesised with the Web Audio API (no bundled audio
 * files), so any number of them can play at the same time as the music. Custom user files are
 * decoded and looped through the same graph.
 */
import { createStore, idbDelete, idbGet, idbSet, toast, uid } from "./store";
import { settings, update } from "./settings";
import { pickAnyFile } from "./platform";

export const BUILTIN = ["Rain", "Thunderstorm", "Forest", "Cafe", "Fireplace", "Wind", "White Noise"] as const;

type Running = { stop: () => void; gain: GainNode };
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let meter: AnalyserNode | null = null;
const running = new Map<string, Running>();
const buffers: Record<string, AudioBuffer> = {};

export const mixerState = createStore<{ custom: { id: string; name: string }[]; active: string[]; ready: boolean }>({
  custom: [], active: [], ready: false,
});

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
    meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    master.connect(meter);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function noise(type: "white" | "pink" | "brown", seconds = 6): AudioBuffer {
  const key = `${type}${seconds}`;
  if (buffers[key]) return buffers[key];
  const c = audio();
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (type === "white") d[i] = w;
    else if (type === "pink") {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  }
  // cross-fade the loop point to avoid a click
  const n = Math.floor(c.sampleRate * 0.05);
  for (let i = 0; i < n; i++) { const t = i / n; d[i] = d[i] * t + d[d.length - n + i] * (1 - t); }
  return (buffers[key] = buf);
}

function loopSrc(c: AudioContext, type: "white" | "pink" | "brown") {
  const s = c.createBufferSource();
  s.buffer = noise(type);
  s.loop = true;
  return s;
}
function filt(c: AudioContext, type: BiquadFilterType, f: number, q = 0.7) {
  const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n;
}
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Calls fn at random intervals until stopped. */
function scheduler(fn: () => void, min: number, max: number) {
  let t: number;
  const tick = () => { fn(); t = window.setTimeout(tick, rand(min, max)); };
  t = window.setTimeout(tick, rand(min, max));
  return () => window.clearTimeout(t);
}
function burst(c: AudioContext, dest: AudioNode, o: { dur: number; type?: "white" | "brown"; hp?: number; lp?: number; gain: number; attack?: number }) {
  const s = c.createBufferSource(); s.buffer = noise(o.type ?? "white");
  const g = c.createGain();
  const now = c.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(o.gain, now + (o.attack ?? 0.003));
  g.gain.exponentialRampToValueAtTime(0.0001, now + o.dur);
  let node: AudioNode = s;
  if (o.hp) { const f = filt(c, "highpass", o.hp); node.connect(f); node = f; }
  if (o.lp) { const f = filt(c, "lowpass", o.lp); node.connect(f); node = f; }
  node.connect(g); g.connect(dest);
  s.start(now, Math.random() * 3, o.dur + 0.05);
}
function tone(c: AudioContext, dest: AudioNode, f0: number, f1: number, dur: number, gain: number) {
  const o = c.createOscillator(); o.type = "sine";
  const g = c.createGain(); const now = c.currentTime;
  o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(f1, now + dur);
  g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(gain, now + dur * 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g); g.connect(dest); o.start(now); o.stop(now + dur + 0.05);
}
function lfo(c: AudioContext, rate: number, depth: number, target: AudioParam) {
  const o = c.createOscillator(); o.frequency.value = rate;
  const g = c.createGain(); g.gain.value = depth;
  o.connect(g); g.connect(target); o.start();
  return o;
}

function build(name: string, out: GainNode): () => void {
  const c = audio();
  const stops: (() => void)[] = [];
  const stopNodes = (...n: (AudioScheduledSourceNode)[]) => stops.push(() => n.forEach((x) => { try { x.stop(); } catch { /* already stopped */ } }));
  switch (name) {
    case "White Noise": {
      const s = loopSrc(c, "white"); const g = c.createGain(); g.gain.value = 0.35;
      s.connect(g); g.connect(out); s.start(); stopNodes(s); break;
    }
    case "Rain":
    case "Thunderstorm": {
      const s = loopSrc(c, "white");
      const hp = filt(c, "highpass", name === "Rain" ? 700 : 400);
      const lp = filt(c, "lowpass", name === "Rain" ? 9500 : 6500);
      const g = c.createGain(); g.gain.value = name === "Rain" ? 0.38 : 0.45;
      s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out); s.start();
      const l = lfo(c, 0.13, 0.05, g.gain);
      stopNodes(s, l);
      stops.push(scheduler(() => burst(c, out, { dur: 0.03, hp: 3000, lp: 9000, gain: rand(0.03, 0.12) }), 25, 90));
      if (name === "Thunderstorm")
        stops.push(scheduler(() => burst(c, out, { dur: rand(3, 5.5), type: "brown", lp: rand(120, 260), gain: rand(0.7, 1.4), attack: 0.5 }), 6000, 16000));
      break;
    }
    case "Forest": {
      const s = loopSrc(c, "brown"); const lp = filt(c, "lowpass", 900); const g = c.createGain(); g.gain.value = 0.28;
      s.connect(lp); lp.connect(g); g.connect(out); s.start();
      const l = lfo(c, 0.08, 0.1, g.gain); stopNodes(s, l);
      stops.push(scheduler(() => {
        const base = rand(2400, 4600); const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) window.setTimeout(() => tone(c, out, base, base * rand(0.7, 1.3), rand(0.07, 0.16), 0.045), i * 140);
      }, 900, 3600));
      break;
    }
    case "Cafe": {
      const s = loopSrc(c, "pink"); const bp = filt(c, "bandpass", 900, 0.5); const g = c.createGain(); g.gain.value = 0.55;
      s.connect(bp); bp.connect(g); g.connect(out); s.start();
      const l = lfo(c, 0.35, 0.12, g.gain); stopNodes(s, l);
      stops.push(scheduler(() => { tone(c, out, 3100, 3000, 0.3, 0.035); window.setTimeout(() => tone(c, out, 4300, 4200, 0.22, 0.025), 70); }, 2500, 8000));
      break;
    }
    case "Fireplace": {
      const s = loopSrc(c, "brown"); const lp = filt(c, "lowpass", 520); const g = c.createGain(); g.gain.value = 0.55;
      s.connect(lp); lp.connect(g); g.connect(out); s.start(); stopNodes(s);
      stops.push(scheduler(() => burst(c, out, { dur: rand(0.008, 0.04), hp: 1400, gain: rand(0.05, Math.random() < 0.12 ? 0.5 : 0.18) }), 35, 260));
      break;
    }
    case "Wind": {
      const s = loopSrc(c, "brown"); const bp = filt(c, "bandpass", 500, 0.8); const g = c.createGain(); g.gain.value = 0.7;
      s.connect(bp); bp.connect(g); g.connect(out); s.start();
      const l1 = lfo(c, 0.07, 320, bp.frequency); const l2 = lfo(c, 0.11, 0.25, g.gain); stopNodes(s, l1, l2);
      break;
    }
    default: {
      const buf = buffers[name];
      if (!buf) break;
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(out); s.start(); stopNodes(s);
    }
  }
  return () => stops.forEach((f) => f());
}

const volOf = (name: string) => {
  const m = settings.get().mixer[name];
  return m?.muted ? 0 : Math.pow(m?.vol ?? 0.5, 1.6);
};
const bgMul = () => Math.min(1, settings.get().mixerBalance / 50);
/** Music gets quieter as the balance slider moves toward "Background". */
export const musicMul = () => Math.max(0.1, Math.min(1, (100 - settings.get().mixerBalance) / 50));

function applyGains() {
  if (!ctx || !master) return;
  master.gain.setTargetAtTime(bgMul(), ctx.currentTime, 0.05);
  for (const [name, r] of running) r.gain.gain.setTargetAtTime(volOf(name), ctx.currentTime, 0.05);
}

export async function setSound(name: string, on: boolean) {
  const cur = settings.get().mixer[name] ?? { on: false, vol: 0.5 };
  update({ mixer: { ...settings.get().mixer, [name]: { ...cur, on } } });
  await syncOne(name);
}
export function setSoundVolume(name: string, vol: number) {
  const cur = settings.get().mixer[name] ?? { on: false, vol };
  update({ mixer: { ...settings.get().mixer, [name]: { ...cur, vol } } });
  applyGains();
}
export function toggleSoundMute(name: string) {
  const cur = settings.get().mixer[name] ?? { on: false, vol: 0.5 };
  update({ mixer: { ...settings.get().mixer, [name]: { ...cur, muted: !cur.muted } } });
  applyGains();
}
export function setBalance(v: number) {
  update({ mixerBalance: v });
  applyGains();
  onBalance?.();
}
let onBalance: (() => void) | null = null;
export const onBalanceChange = (fn: () => void) => { onBalance = fn; };

async function loadCustomBuffer(id: string): Promise<boolean> {
  if (buffers[id]) return true;
  const blob = await idbGet<Blob>("blobs", `sound:${id}`);
  if (!blob) return false;
  try { buffers[id] = await audio().decodeAudioData(await blob.arrayBuffer()); return true; } catch { return false; }
}

async function syncOne(name: string) {
  const want = !!settings.get().mixer[name]?.on;
  const has = running.has(name);
  if (want && !has) {
    if (name.startsWith("custom:") && !(await loadCustomBuffer(name.slice(7)))) {
      toast("That custom sound could not be decoded."); return;
    }
    if (name.startsWith("custom:")) buffers[name] = buffers[name.slice(7)];
    const c = audio();
    const g = c.createGain(); g.gain.value = 0; g.connect(master!);
    const stop = build(name, g);
    running.set(name, { gain: g, stop });
    g.gain.setTargetAtTime(volOf(name), c.currentTime, 0.4);
  } else if (!want && has) {
    const r = running.get(name)!;
    running.delete(name);
    r.gain.gain.setTargetAtTime(0, ctx!.currentTime, 0.15);
    window.setTimeout(() => { r.stop(); r.gain.disconnect(); }, 700);
  }
  mixerState.set({ active: [...running.keys()] });
  applyGains();
}

export async function addCustomSound() {
  const f = await pickAnyFile(["mp3", "wav", "flac", "ogg", "m4a", "opus"], "Audio");
  if (!f) return;
  if (f.size > 60 * 1024 * 1024) { toast("Custom sounds are limited to 60 MB."); return; }
  try { await audio().decodeAudioData(await f.slice().arrayBuffer()); } catch { toast("That file could not be decoded as audio."); return; }
  const id = uid();
  if (!(await idbSet("blobs", `sound:${id}`, f))) { toast("Could not store the sound locally."); return; }
  const custom = [...mixerState.get().custom, { id, name: f.name.replace(/\.[^.]+$/, "") }];
  mixerState.set({ custom });
  await idbSet("kv", "customSounds", custom);
  await setSound(`custom:${id}`, true);
}
export async function removeCustomSound(id: string) {
  await setSound(`custom:${id}`, false);
  const custom = mixerState.get().custom.filter((c) => c.id !== id);
  mixerState.set({ custom });
  await idbSet("kv", "customSounds", custom);
  await idbDelete("blobs", `sound:${id}`);
  const m = { ...settings.get().mixer }; delete m[`custom:${id}`]; update({ mixer: m });
}

/** Restores the custom list. Sounds only start after the first user gesture (browser autoplay rules). */
export async function initMixer() {
  const custom = (await idbGet<{ id: string; name: string }[]>("kv", "customSounds")) ?? [];
  mixerState.set({ custom, ready: true });
  const resume = async () => {
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("keydown", resume);
    for (const [name, v] of Object.entries(settings.get().mixer)) if (v.on) await syncOne(name);
  };
  window.addEventListener("pointerdown", resume, { once: true });
  window.addEventListener("keydown", resume, { once: true });
}

/** RMS level of the mixed ambience (0..1). Used by the diagnostics hook. */
export function mixerLevel(): number {
  if (!meter) return 0;
  const d = new Float32Array(meter.fftSize);
  meter.getFloatTimeDomainData(d);
  let sum = 0;
  for (const v of d) sum += v * v;
  return Math.sqrt(sum / d.length);
}
export const mixerRunning = () => [...running.keys()];
