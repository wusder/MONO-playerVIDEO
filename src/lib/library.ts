import { createStore, idbDelete, idbGet, idbSet, toast, uid } from "./store";
import { type Meta, coverToDataUrl, readMetadata } from "./metadata";
import { type Picked, type Source, extOf, kindOf, mediaUrl, rangeSource, sourceExists } from "./platform";
import { guessLang } from "./subtitles";

export type SubRef = { name: string; lang: string; path?: string };
export type Item = {
  id: string;
  kind: "audio" | "video";
  name: string;
  ext: string;
  size: number;
  title: string;
  artist: string;
  album: string;
  year?: string;
  track?: number;
  duration?: number;
  codec?: string;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  lossless?: boolean;
  width?: number;
  height?: number;
  cover?: string;
  addedAt: number;
  lastPlayed?: number;
  playCount: number;
  favorite: boolean;
  position?: number;
  missing?: boolean;
  /** false when the built-in engine could not decode the file at import time */
  playable: boolean;
  ref: "path" | "handle" | "session";
  path?: string;
  subs?: SubRef[];
};
export type Playlist = { id: string; name: string; items: string[]; createdAt: number };

export const library = createStore<{
  items: Item[];
  playlists: Playlist[];
  loaded: boolean;
  importing: { done: number; total: number } | null;
}>({ items: [], playlists: [], loaded: false, importing: null });

/** In-memory sources for this session (Files, handles, paths). */
const sources = new Map<string, Source>();

let saveTimer: number | undefined;
function persist(now = false) {
  window.clearTimeout(saveTimer);
  const run = () => {
    const { items, playlists } = library.get();
    idbSet("kv", "library", { v: 1, items, playlists });
  };
  if (now) run();
  else saveTimer = window.setTimeout(run, 500);
}

export async function initLibrary() {
  const saved = await idbGet<{ items: Item[]; playlists: Playlist[] }>("kv", "library");
  library.set({ items: saved?.items ?? [], playlists: saved?.playlists ?? [], loaded: true });
  // Background existence check for items that live at a known path.
  for (const it of library.get().items) {
    if (it.ref !== "path" || !it.path) continue;
    const ok = await sourceExists({ path: it.path });
    if (ok === !!it.missing) patchItem(it.id, { missing: !ok }, false);
  }
}

export function getItem(id: string): Item | undefined {
  return library.get().items.find((i) => i.id === id);
}

function patchItem(id: string, patch: Partial<Item>, save = true) {
  library.set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  if (save) persist();
}
export const patch = patchItem;

export async function getSource(id: string): Promise<Source | undefined> {
  const mem = sources.get(id);
  if (mem) return mem;
  const it = getItem(id);
  if (!it) return undefined;
  if (it.ref === "path" && it.path) return { path: it.path };
  if (it.ref === "handle") {
    const h = await idbGet<FileSystemFileHandle>("handles", id);
    if (h) { const s = { handle: h }; sources.set(id, s); return s; }
  }
  return undefined;
}
export async function getSubSource(id: string, index: number): Promise<Source | undefined> {
  const mem = sources.get(`${id}:sub:${index}`);
  if (mem) return mem;
  const it = getItem(id);
  const ref = it?.subs?.[index];
  if (!ref) return undefined;
  if (ref.path) return { path: ref.path };
  const h = await idbGet<FileSystemFileHandle>("handles", `${id}:sub:${index}`);
  return h ? { handle: h } : undefined;
}

/* ---------------- import ---------------- */
const stripExt = (n: string) => n.replace(/\.[^.]+$/, "");

type Probe = { duration?: number; width?: number; height?: number; thumb?: string; playable: boolean };
async function probe(p: Picked, kind: "audio" | "video"): Promise<Probe> {
  let handle: { url: string; revoke: () => void };
  try { handle = await mediaUrl(p.src, p.ext); } catch { return { playable: false }; }
  const el = document.createElement(kind === "video" ? "video" : "audio");
  el.preload = "metadata";
  el.muted = true;
  const done = (r: Probe) => { el.removeAttribute("src"); el.load(); handle.revoke(); return r; };
  const ready = await new Promise<boolean>((res) => {
    const t = window.setTimeout(() => res(false), 7000);
    el.onloadedmetadata = () => { window.clearTimeout(t); res(true); };
    el.onerror = () => { window.clearTimeout(t); res(false); };
    el.src = handle.url;
  });
  if (!ready) return done({ playable: false });
  const out: Probe = { playable: true, duration: isFinite(el.duration) ? el.duration : undefined };
  if (kind === "video") {
    const v = el as HTMLVideoElement;
    out.width = v.videoWidth; out.height = v.videoHeight;
    try {
      const target = Math.min(Math.max((out.duration ?? 10) * 0.1, 1), 40);
      await new Promise<void>((res) => {
        const t = window.setTimeout(res, 4000);
        v.onseeked = () => { window.clearTimeout(t); res(); };
        v.currentTime = target;
      });
      const k = Math.min(1, 480 / Math.max(v.videoWidth, 1));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(v.videoWidth * k));
      c.height = Math.max(1, Math.round(v.videoHeight * k));
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      out.thumb = c.toDataURL("image/jpeg", 0.7);
    } catch { /* tainted canvas or seek failure: no thumbnail */ }
  }
  return done(out);
}

export type ImportResult = { added: number; duplicates: number; subtitles: number; unplayable: number; ids: string[] };

export async function importPicked(list: Picked[]): Promise<ImportResult> {
  const result: ImportResult = { added: 0, duplicates: 0, subtitles: 0, unplayable: 0, ids: [] };
  const idMap = new Map<Picked, string>();
  const media = list.filter((p) => { const k = kindOf(p.ext); return k === "audio" || k === "video"; });
  const subs = list.filter((p) => kindOf(p.ext) === "sub");
  const existing = library.get().items;
  const fresh: Picked[] = [];
  for (const p of media) {
    const same = existing.find((i) => (p.src.path ? i.path === p.src.path : i.ref !== "path" && i.name === p.name && i.size === p.size));
    const twin = fresh.find((f) => f.name === p.name && f.size === p.size && f.dir === p.dir && f.src.path === p.src.path);
    if (same) { result.duplicates++; result.ids.push(same.id); }
    else if (twin) { result.duplicates++; result.ids.push(idMap.get(twin)!); }
    else { const id = uid(); idMap.set(p, id); result.ids.push(id); fresh.push(p); }
  }
  if (!fresh.length) return result;
  library.set({ importing: { done: 0, total: fresh.length } });

  let cursor = 0;
  let done = 0;
  const added: Item[] = [];
  const worker = async () => {
    while (cursor < fresh.length) {
      const p = fresh[cursor++];
      const kind = kindOf(p.ext) as "audio" | "video";
      let meta: Meta = {};
      try {
        if (kind === "audio" || p.ext === "mp4") meta = await readMetadata(await rangeSource(p.src, p.size), p.ext);
      } catch { /* tags are optional */ }
      const pr = await probe(p, kind);
      const id = idMap.get(p)!;
      const ref: Item["ref"] = p.src.path ? "path" : p.src.handle ? "handle" : "session";
      if (p.src.handle) await idbSet("handles", id, p.src.handle);
      sources.set(id, p.src);
      const base = stripExt(p.name);
      const cover = kind === "audio" && meta.cover ? await coverToDataUrl(meta.cover) : pr.thumb;
      const it: Item = {
        id, kind, name: p.name, ext: p.ext, size: p.size,
        title: (meta.title || base).trim(),
        artist: (meta.artist || "").trim(),
        album: (meta.album || "").trim(),
        year: meta.year, track: meta.track,
        duration: pr.duration ?? meta.duration,
        codec: kind === "audio" ? meta.codec ?? p.ext.toUpperCase() : undefined,
        sampleRate: meta.sampleRate, bitDepth: meta.bitDepth, channels: meta.channels, lossless: meta.lossless,
        width: pr.width, height: pr.height, cover,
        addedAt: Date.now() + added.length, playCount: 0, favorite: false,
        playable: pr.playable, ref, path: p.src.path,
      };
      if (kind === "video") {
        const vb = base.toLowerCase();
        const matches = subs.filter((s) => s.dir === p.dir && stripExt(s.name).toLowerCase().startsWith(vb));
        if (matches.length) {
          it.subs = [];
          for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            it.subs.push({ name: m.name, lang: guessLang(m.name), path: m.src.path });
            if (m.src.handle) await idbSet("handles", `${id}:sub:${i}`, m.src.handle);
            sources.set(`${id}:sub:${i}`, m.src);
            result.subtitles++;
          }
        }
      }
      if (!pr.playable) result.unplayable++;
      added.push(it);
      done++;
      library.set({ importing: { done, total: fresh.length } });
      if (added.length % 10 === 0) { library.set((s) => ({ items: [...s.items, ...added.splice(0)] })); persist(); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  library.set((s) => ({ items: [...s.items, ...added], importing: null }));
  result.added = fresh.length;
  persist(true);
  return result;
}

export function describeImport(r: ImportResult): string {
  const parts: string[] = [];
  if (r.added) parts.push(`${r.added} item${r.added === 1 ? "" : "s"} added`);
  if (r.duplicates) parts.push(`${r.duplicates} already in library`);
  if (r.subtitles) parts.push(`${r.subtitles} subtitle file${r.subtitles === 1 ? "" : "s"} linked`);
  if (r.unplayable) parts.push(`${r.unplayable} may need a different decoder`);
  return parts.length ? parts.join(" · ") : "No supported media found";
}

/* ---------------- item operations ---------------- */
export function toggleFavorite(id: string) {
  const it = getItem(id);
  if (it) patchItem(id, { favorite: !it.favorite });
}
export function markPlayed(id: string) {
  const it = getItem(id);
  if (it) patchItem(id, { lastPlayed: Date.now(), playCount: it.playCount + 1 });
}
export function setPosition(id: string, position: number) {
  patchItem(id, { position });
}
export function updateDuration(id: string, duration: number, extra?: Partial<Item>) {
  const it = getItem(id);
  if (it && (!it.duration || Math.abs(it.duration - duration) > 1)) patchItem(id, { duration, ...extra });
}

/** Removes records only. Files on disk are never touched. */
export async function removeItems(ids: string[]) {
  const set = new Set(ids);
  library.set((s) => ({
    items: s.items.filter((i) => !set.has(i.id)),
    playlists: s.playlists.map((p) => ({ ...p, items: p.items.filter((x) => !set.has(x)) })),
  }));
  for (const id of ids) { sources.delete(id); await idbDelete("handles", id); }
  persist(true);
}

export async function relink(id: string, p: Picked) {
  const it = getItem(id);
  if (!it) return;
  sources.set(id, p.src);
  if (p.src.handle) await idbSet("handles", id, p.src.handle);
  patchItem(id, { missing: false, ref: p.src.path ? "path" : p.src.handle ? "handle" : "session", path: p.src.path, size: p.size, name: p.name });
  toast(`Linked “${it.title}” to ${p.name}`);
}

export async function checkItem(id: string): Promise<boolean> {
  const src = await getSource(id);
  if (!src) { patchItem(id, { missing: true }); return false; }
  const ok = await sourceExists(src);
  if (ok === !!getItem(id)?.missing) patchItem(id, { missing: !ok });
  return ok;
}

/* ---------------- playlists ---------------- */
export function createPlaylist(name: string, ids: string[] = []): Playlist {
  const p: Playlist = { id: uid(), name: name.trim() || "Untitled playlist", items: [...new Set(ids)], createdAt: Date.now() };
  library.set((s) => ({ playlists: [...s.playlists, p] }));
  persist(true);
  return p;
}
export function renamePlaylist(id: string, name: string) {
  library.set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)) }));
  persist();
}
export function deletePlaylist(id: string) {
  library.set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }));
  persist(true);
}
export function addToPlaylist(pid: string, ids: string[]) {
  let added = 0;
  library.set((s) => ({
    playlists: s.playlists.map((p) => {
      if (p.id !== pid) return p;
      const fresh = ids.filter((i) => !p.items.includes(i));
      added = fresh.length;
      return { ...p, items: [...p.items, ...fresh] };
    }),
  }));
  persist(true);
  return added;
}
export function removeFromPlaylist(pid: string, id: string) {
  library.set((s) => ({ playlists: s.playlists.map((p) => (p.id === pid ? { ...p, items: p.items.filter((x) => x !== id) } : p)) }));
  persist(true);
}
export function movePlaylistItem(pid: string, from: number, to: number) {
  library.set((s) => ({
    playlists: s.playlists.map((p) => {
      if (p.id !== pid || to < 0 || to >= p.items.length) return p;
      const items = [...p.items];
      const [x] = items.splice(from, 1);
      items.splice(to, 0, x);
      return { ...p, items };
    }),
  }));
  persist(true);
}

/* ---------------- derived helpers ---------------- */
export type Album = { key: string; album: string; artist: string; cover?: string; year?: string; ids: string[]; duration: number };
export function buildAlbums(items: Item[]): Album[] {
  const map = new Map<string, Album>();
  for (const it of items) {
    if (it.kind !== "audio") continue;
    const album = it.album || "Unknown album";
    const key = `${album}\u0000${it.album ? it.artist : ""}`;
    let a = map.get(key);
    if (!a) { a = { key, album, artist: it.album ? it.artist || "Unknown artist" : "Various", cover: it.cover, year: it.year, ids: [], duration: 0 }; map.set(key, a); }
    a.ids.push(it.id);
    a.duration += it.duration ?? 0;
    if (!a.cover && it.cover) a.cover = it.cover;
  }
  for (const a of map.values()) {
    const byId = new Map(items.map((i) => [i.id, i]));
    a.ids.sort((x, y) => (byId.get(x)?.track ?? 999) - (byId.get(y)?.track ?? 999) || (byId.get(x)?.title ?? "").localeCompare(byId.get(y)?.title ?? ""));
  }
  return [...map.values()];
}

export function sortItems<T extends Item>(items: T[], by: "added" | "title" | "artist" | "year"): T[] {
  const a = [...items];
  const cmp = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: "base", numeric: true });
  if (by === "title") a.sort((x, y) => cmp(x.title, y.title));
  else if (by === "artist") a.sort((x, y) => cmp(x.artist || "~", y.artist || "~") || cmp(x.album, y.album) || (x.track ?? 0) - (y.track ?? 0));
  else if (by === "year") a.sort((x, y) => (y.year ?? "").localeCompare(x.year ?? ""));
  else a.sort((x, y) => y.addedAt - x.addedAt);
  return a;
}

/** Real characteristics of the source file for the "Audio quality" panel. */
export function qualityInfo(it: Item) {
  const khz = it.sampleRate ? `${+(it.sampleRate / 1000).toFixed(1)} kHz` : undefined;
  const isDsd = it.codec === "DSD";
  const dsdRate = it.sampleRate && isDsd ? `${+(it.sampleRate / 1e6).toFixed(4)} MHz` : undefined;
  const bits = it.bitDepth && !isDsd ? `${it.bitDepth}-bit` : undefined;
  const hires = !!it.lossless && (isDsd || (it.bitDepth ?? 0) > 16 || (it.sampleRate ?? 0) > 48000);
  const avgKbps = it.duration && it.duration > 1 ? Math.round((it.size * 8) / it.duration / 1000) : undefined;
  const tier = hires ? "HI-RES" : it.lossless ? "LOSSLESS" : "LOSSY";
  const short = [it.codec ?? it.ext.toUpperCase(), it.lossless ? [bits, isDsd ? dsdRate : khz].filter(Boolean).join(" / ") : avgKbps ? `${avgKbps} kbps` : khz].filter(Boolean);
  return { khz, dsdRate, bits, hires, avgKbps, tier, short };
}
