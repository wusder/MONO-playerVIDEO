/**
 * Playback engine. ONE media element drives music, video and the mini player, so every control in
 * the app (main player, mini player, media keys, hotkeys) works on the same real state.
 */
import { createStore, toast } from "./store";
import { type Item, getItem, getSource, getSubSource, markPlayed, setPosition, updateDuration, checkItem } from "./library";
import { settings, update } from "./settings";
import { type Cue, activeCue, decodeSubtitleBytes, guessLang, LANG_NAMES, parseSubtitles } from "./subtitles";
import { ensureHandlePermission, mediaUrl, readText, type Picked, type Source } from "./platform";
import { musicMul, onBalanceChange } from "./mixer";

export type SubTrack = { id: string; label: string; lang: string; cues: Cue[]; origin: "file" | "embedded" };
export type AudioTrackInfo = { id: string; label: string; lang: string; enabled: boolean };

export type PlayerState = {
  queue: string[];
  order: number[];
  pos: number;
  currentId: string | null;
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  buffered: number;
  rate: number;
  videoW: number;
  videoH: number;
  audioTracks: AudioTrackInfo[];
  subTracks: SubTrack[];
  subActive: string; // "off" or SubTrack.id
  cue: string;
  error: string | null;
  pip: boolean;
  canPip: boolean;
};

export const media = document.createElement("video");
media.playsInline = true;
media.preload = "auto";
media.className = "media-element";
media.setAttribute("tabindex", "-1");

export const player = createStore<PlayerState>({
  queue: [], order: [], pos: -1, currentId: null, playing: false, loading: false,
  time: 0, duration: 0, buffered: 0, rate: 1, videoW: 0, videoH: 0,
  audioTracks: [], subTracks: [], subActive: "off", cue: "", error: null, pip: false,
  canPip: typeof document !== "undefined" && !!document.pictureInPictureEnabled,
});

let navigate: (screen: "music" | "video") => void = () => {};
export const setNavigator = (fn: typeof navigate) => { navigate = fn; };

let revoke: (() => void) | null = null;
let loadToken = 0;
let lastSave = 0;

/* ---------------- volume / rate ---------------- */
function applyVolume() {
  const s = settings.get();
  media.volume = Math.max(0, Math.min(1, s.volume * musicMul()));
  media.muted = s.muted;
}
onBalanceChange(applyVolume);
export function setVolume(v: number) {
  update({ volume: Math.max(0, Math.min(1, v)), muted: false });
  applyVolume();
}
export function toggleMute() {
  update({ muted: !settings.get().muted });
  applyVolume();
}
export function setRate(r: number) {
  const rate = Math.max(0.25, Math.min(2, Math.round(r * 100) / 100));
  media.playbackRate = rate;
  media.defaultPlaybackRate = rate;
  player.set({ rate });
}

/* ---------------- order / queue ---------------- */
function makeOrder(len: number, first: number, shuffle: boolean): number[] {
  const idx = Array.from({ length: len }, (_, i) => i);
  if (!shuffle) return idx;
  const rest = idx.filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  return first >= 0 ? [first, ...rest] : rest;
}

export async function playIds(ids: string[], startIndex = 0, opts: { navigate?: boolean } = {}) {
  const valid = ids.filter((id) => getItem(id));
  if (!valid.length) return;
  const shuffle = settings.get().shuffle;
  const order = makeOrder(valid.length, startIndex, shuffle);
  player.set({ queue: valid, order, pos: shuffle ? 0 : startIndex });
  await loadAt(player.get().pos, opts.navigate !== false);
}
export async function playOne(id: string, context: string[]) {
  const i = context.indexOf(id);
  await playIds(context.length && i >= 0 ? context : [id], i >= 0 ? i : 0);
}

export function enqueue(ids: string[], asNext = false) {
  const s = player.get();
  const valid = ids.filter((id) => getItem(id));
  if (!valid.length) return;
  if (!s.queue.length || s.currentId === null) { void playIds(valid); return; }
  const cur = s.order[s.pos];
  const insertAt = asNext ? cur + 1 : s.queue.length;
  const queue = [...s.queue.slice(0, insertAt), ...valid, ...s.queue.slice(insertAt)];
  // keep order consistent: shift indices >= insertAt and append/insert new ones after current position
  const shifted = s.order.map((o) => (o >= insertAt ? o + valid.length : o));
  const newIdx = valid.map((_, k) => insertAt + k);
  const order = asNext ? [...shifted.slice(0, s.pos + 1), ...newIdx, ...shifted.slice(s.pos + 1)] : [...shifted, ...newIdx];
  player.set({ queue, order });
  toast(asNext ? "Will play next" : `Added ${valid.length} to queue`);
}

export function removeFromQueue(index: number) {
  const s = player.get();
  if (index < 0 || index >= s.queue.length) return;
  const cur = s.order[s.pos];
  const queue = s.queue.filter((_, i) => i !== index);
  let order = s.order.filter((o) => o !== index).map((o) => (o > index ? o - 1 : o));
  if (index === cur) {
    // removed the playing item: keep playing it until it ends, but drop it from the list
    player.set({ queue, order, pos: Math.min(s.pos, Math.max(order.length - 1, 0)) });
    return;
  }
  const newCur = cur > index ? cur - 1 : cur;
  order = order.length ? order : [];
  player.set({ queue, order, pos: Math.max(0, order.indexOf(newCur)) });
}
export function moveInQueue(from: number, to: number) {
  const s = player.get();
  if (from === to || to < 0 || to >= s.queue.length) return;
  const curId = s.queue[s.order[s.pos]];
  const queue = [...s.queue];
  const [x] = queue.splice(from, 1);
  queue.splice(to, 0, x);
  const curIdx = Math.max(0, queue.indexOf(curId));
  const order = makeOrder(queue.length, curIdx, false);
  player.set({ queue, order, pos: curIdx });
  if (settings.get().shuffle) shuffleRemaining();
}
function shuffleRemaining() {
  const s = player.get();
  const cur = s.order[s.pos] ?? 0;
  const order = makeOrder(s.queue.length, cur, true);
  player.set({ order, pos: 0 });
}
export function clearQueue() {
  const s = player.get();
  if (s.currentId === null) { player.set({ queue: [], order: [], pos: -1 }); return; }
  player.set({ queue: [s.currentId], order: [0], pos: 0 });
}

/* ---------------- loading ---------------- */
async function loadAt(pos: number, doNavigate = true, autoplay = true) {
  const s = player.get();
  const qi = s.order[pos];
  const id = s.queue[qi];
  const item = getItem(id);
  if (!item) return;
  const token = ++loadToken;
  player.set({ pos, currentId: id, loading: true, error: null, time: 0, duration: item.duration ?? 0, buffered: 0, videoW: 0, videoH: 0, audioTracks: [], subTracks: [], subActive: "off", cue: "" });
  if (doNavigate) navigate(item.kind === "video" ? "video" : "music");
  media.pause();
  revoke?.(); revoke = null;

  const src = await getSource(id);
  if (token !== loadToken) return;
  if (!src) return fail(item, "This file is not linked to the library any more.", true);
  if (src.handle && !(await ensureHandlePermission(src.handle))) return fail(item, "Mono needs permission to read this file again. Click play to grant it.", false);
  if (!(await checkItem(id))) return fail(item, `“${item.name}” was moved or deleted.`, true);
  let url: string;
  try {
    const m = await mediaUrl(src, item.ext);
    url = m.url; revoke = m.revoke;
  } catch { return fail(item, "The file could not be opened.", false); }
  if (token !== loadToken) { revoke?.(); revoke = null; return; }

  media.src = url;
  media.defaultPlaybackRate = settings.get().defaultSpeed;
  media.playbackRate = settings.get().defaultSpeed;
  player.set({ rate: settings.get().defaultSpeed });
  applyVolume();
  media.load();
  const resume = settings.get().rememberPosition && item.position && item.duration && item.position > 5 && item.position < item.duration - 10 ? item.position : 0;
  if (resume) media.currentTime = resume;
  if (autoplay) {
    try { await media.play(); } catch (e) {
      if ((e as DOMException).name === "NotAllowedError") player.set({ loading: false }); // needs a user gesture
    }
  }
  markPlayed(id);
  setMediaSession(item);
  void loadSidecarSubtitles(item, token);
}

function fail(item: Item, message: string, missing: boolean) {
  player.set({ loading: false, playing: false, error: message });
  toast(message, missing ? { label: "Locate…", run: () => window.dispatchEvent(new CustomEvent("mono:locate", { detail: item.id })) } : undefined);
}

/* ---------------- transport ---------------- */
export async function play() {
  const s = player.get();
  if (!s.currentId) return;
  if (s.error && !media.src) { await loadAt(s.pos, false); return; }
  if (media.ended) media.currentTime = 0;
  try { await media.play(); } catch { toast("Playback was blocked. Press play again."); }
}
export const pause = () => media.pause();
export function toggle() {
  if (!player.get().currentId) return false;
  if (media.paused) void play(); else pause();
  return true;
}
export function seek(sec: number) {
  if (!isFinite(media.duration)) return;
  media.currentTime = Math.max(0, Math.min(media.duration, sec));
  syncTime();
}
export const seekBy = (d: number) => seek(media.currentTime + d);
export const seekPct = (p: number) => { if (isFinite(media.duration)) seek((p / 100) * media.duration); };

export async function next(auto = false) {
  const s = player.get();
  if (!s.queue.length) return;
  let pos = s.pos + 1;
  if (pos >= s.order.length) {
    if (settings.get().repeat === "all" || !auto) { if (settings.get().repeat !== "all" && !auto && s.order.length <= 1) return; pos = 0; if (settings.get().shuffle) { shuffleRemaining(); pos = 0; } }
    else { media.pause(); return; }
  }
  await loadAt(pos, !auto);
}
export async function prev() {
  const s = player.get();
  if (!s.queue.length) return;
  if (media.currentTime > 3 || s.pos <= 0) { seek(0); if (media.paused) void play(); return; }
  await loadAt(s.pos - 1, true);
}
export async function jumpTo(queueIndex: number) {
  const s = player.get();
  const pos = s.order.indexOf(queueIndex);
  if (pos >= 0) await loadAt(pos, true);
}
export function toggleShuffle() {
  const on = !settings.get().shuffle;
  update({ shuffle: on });
  const s = player.get();
  if (!s.queue.length) return;
  const cur = s.order[s.pos] ?? 0;
  const order = makeOrder(s.queue.length, cur, on);
  player.set({ order, pos: on ? 0 : cur });
}
export function cycleRepeat() {
  const r = settings.get().repeat;
  update({ repeat: r === "off" ? "all" : r === "all" ? "one" : "off" });
}

/* ---------------- media events ---------------- */
function syncTime() {
  const b = media.buffered;
  let buffered = 0;
  for (let i = 0; i < b.length; i++) if (b.start(i) <= media.currentTime && b.end(i) >= media.currentTime) buffered = b.end(i);
  player.set({ time: media.currentTime, buffered: media.duration ? (buffered / media.duration) * 100 : 0 });
  const id = player.get().currentId;
  if (id && Date.now() - lastSave > 4000 && media.currentTime > 1) { lastSave = Date.now(); setPosition(id, media.currentTime); }
  updateCue();
}
function updateCue() {
  const s = player.get();
  const t = s.subTracks.find((x) => x.id === s.subActive);
  const c = t ? activeCue(t.cues, media.currentTime)?.text ?? "" : "";
  if (c !== s.cue) player.set({ cue: c });
}
let raf = 0;
function loop() {
  syncTime();
  raf = requestAnimationFrame(loopThrottled);
}
let lastTick = 0;
function loopThrottled(t: number) {
  if (t - lastTick > 90) { lastTick = t; loop(); } else raf = requestAnimationFrame(loopThrottled);
}

media.addEventListener("play", () => { player.set({ playing: true, loading: false }); cancelAnimationFrame(raf); raf = requestAnimationFrame(loopThrottled); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; });
media.addEventListener("pause", () => { player.set({ playing: false }); cancelAnimationFrame(raf); syncTime(); const id = player.get().currentId; if (id && media.currentTime > 1) setPosition(id, media.currentTime); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; });
media.addEventListener("seeked", syncTime);
media.addEventListener("timeupdate", () => { if (media.paused) syncTime(); });
media.addEventListener("progress", syncTime);
media.addEventListener("waiting", () => player.set({ loading: true }));
media.addEventListener("playing", () => player.set({ loading: false }));
media.addEventListener("ratechange", () => player.set({ rate: media.playbackRate }));
media.addEventListener("loadedmetadata", () => {
  const id = player.get().currentId;
  player.set({ duration: media.duration, videoW: media.videoWidth, videoH: media.videoHeight, loading: false });
  if (id) {
    updateDuration(id, media.duration, media.videoWidth ? { width: media.videoWidth, height: media.videoHeight } : undefined);
    refreshTracks();
  }
});
media.addEventListener("durationchange", () => { if (isFinite(media.duration)) player.set({ duration: media.duration }); });
media.addEventListener("ended", () => {
  const id = player.get().currentId;
  if (id) setPosition(id, 0);
  if (settings.get().repeat === "one") { media.currentTime = 0; void media.play(); return; }
  if (settings.get().autoPlayNext) void next(true); else player.set({ playing: false });
});
media.addEventListener("error", () => {
  const id = player.get().currentId;
  const it = id ? getItem(id) : undefined;
  if (!it || !media.src) return;
  const hint =
    it.ext === "mkv" ? "This Matroska file uses a codec the built-in engine cannot decode."
    : it.codec === "DSD" ? "DSD playback needs the native libmpv backend (not available in this engine)."
    : it.codec === "ALAC" ? "ALAC is not supported by this engine on this platform."
    : "The built-in engine cannot decode this file.";
  player.set({ loading: false, playing: false, error: hint });
  toast(`${it.title}: ${hint}`);
});
media.addEventListener("enterpictureinpicture", () => player.set({ pip: true }));
media.addEventListener("leavepictureinpicture", () => player.set({ pip: false }));

/* ---------------- audio tracks / subtitles ---------------- */
type MediaWithTracks = HTMLVideoElement & {
  audioTracks?: { length: number; [i: number]: { id: string; label: string; language: string; enabled: boolean } };
};
export const supportsAudioTracks = () => !!(media as MediaWithTracks).audioTracks;

function refreshTracks() {
  const at = (media as MediaWithTracks).audioTracks;
  const audioTracks: AudioTrackInfo[] = [];
  if (at) for (let i = 0; i < at.length; i++) audioTracks.push({ id: at[i].id || String(i), label: at[i].label || `Track ${i + 1}`, lang: at[i].language || "und", enabled: at[i].enabled });
  player.set({ audioTracks });
  // embedded text tracks (WebM/VTT, some MP4)
  const embedded: SubTrack[] = [];
  for (let i = 0; i < media.textTracks.length; i++) {
    const tt = media.textTracks[i];
    if (tt.kind !== "subtitles" && tt.kind !== "captions") continue;
    tt.mode = "hidden";
    const id = `emb:${i}`;
    const collect = () => {
      const cues: Cue[] = [];
      for (const c of Array.from(tt.cues ?? []) as VTTCue[]) cues.push({ start: c.startTime, end: c.endTime, text: c.text.replace(/<[^>]+>/g, "") });
      player.set((st) => ({ subTracks: st.subTracks.map((x) => (x.id === id ? { ...x, cues } : x)) }));
    };
    tt.addEventListener("cuechange", collect);
    embedded.push({ id, label: tt.label || `Embedded #${embedded.length + 1}`, lang: tt.language || "und", cues: [], origin: "embedded" });
    window.setTimeout(collect, 300);
  }
  if (embedded.length) {
    player.set((st) => ({ subTracks: [...st.subTracks, ...embedded] }));
    autoPickSubtitle();
  }
}
export function setAudioTrack(id: string) {
  const at = (media as MediaWithTracks).audioTracks;
  if (!at) return;
  for (let i = 0; i < at.length; i++) at[i].enabled = (at[i].id || String(i)) === id;
  refreshTracks();
}

function autoPickSubtitle() {
  const pref = settings.get().subtitleLang;
  const s = player.get();
  if (pref === "off" || s.subActive !== "off" || !s.subTracks.length) return;
  const hit = pref === "auto" ? s.subTracks[0] : s.subTracks.find((t) => t.lang === pref);
  if (hit) setSubtitle(hit.id);
}
export function setSubtitle(id: string) {
  player.set({ subActive: id });
  if (id !== "off") { /* keep language preference sticky */
    const t = player.get().subTracks.find((x) => x.id === id);
    if (t && t.lang !== "und") update({ subtitleLang: t.lang });
  } else update({ subtitleLang: "off" });
  updateCue();
}

async function addSubtitleFromSource(src: Source, name: string, label?: string, lang?: string) {
  const text = decodeSubtitleBytes(await readText(src));
  const cues = parseSubtitles(text, name);
  if (!cues.length) { toast(`No subtitle cues found in ${name}.`); return null; }
  const id = `file:${name}:${player.get().subTracks.length}`;
  const l = lang ?? guessLang(name);
  const track: SubTrack = { id, label: label ?? `${LANG_NAMES[l] ?? "Subtitles"} · ${name}`, lang: l, cues, origin: "file" };
  player.set((s) => ({ subTracks: [...s.subTracks, track] }));
  return track;
}
export async function loadSubtitleFile(p: Picked) {
  try {
    const t = await addSubtitleFromSource(p.src, p.name);
    if (t) { setSubtitle(t.id); toast(`Subtitles loaded: ${t.cues.length} lines`); }
  } catch { toast("The subtitle file could not be read."); }
}
async function loadSidecarSubtitles(item: Item, token: number) {
  if (!item.subs?.length) return;
  for (let i = 0; i < item.subs.length; i++) {
    const src = await getSubSource(item.id, i);
    if (!src || token !== loadToken) continue;
    try { await addSubtitleFromSource(src, item.subs[i].name, undefined, item.subs[i].lang); } catch { /* unreadable sidecar */ }
  }
  if (token === loadToken) autoPickSubtitle();
}

/* ---------------- picture in picture ---------------- */
export async function togglePip() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (document.pictureInPictureEnabled) await media.requestPictureInPicture();
    else toast("Picture-in-Picture is not supported here.");
  } catch { toast("Picture-in-Picture is unavailable for this video."); }
}

/* ---------------- OS media keys ---------------- */
function setMediaSession(item: Item) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: item.title, artist: item.artist, album: item.album,
    artwork: item.cover ? [{ src: item.cover, sizes: "420x420", type: "image/jpeg" }] : [],
  });
  const h = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
  h("play", () => void play()); h("pause", pause);
  h("previoustrack", () => void prev()); h("nexttrack", () => void next());
  h("seekbackward", () => seekBy(-10)); h("seekforward", () => seekBy(10));
  h("seekto", (d) => { if (d.seekTime != null) seek(d.seekTime); });
}

/** Called once after the library has loaded. */
export function initEngine() {
  applyVolume();
  media.playbackRate = settings.get().defaultSpeed;
  player.set({ rate: settings.get().defaultSpeed });
}
