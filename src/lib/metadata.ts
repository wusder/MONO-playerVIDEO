/**
 * Lightweight, dependency-free tag/format readers for the formats Mono Player cares about:
 * MP3 (ID3v1/v2), FLAC, WAV, M4A/ALAC/AAC (MP4 atoms) and DSF (DSD).
 * Everything works on a ranged byte source so large files are never fully loaded.
 */
export type RangeSource = { size: number; read(start: number, end: number): Promise<Uint8Array> };

export type Meta = {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  track?: number;
  duration?: number;
  codec?: string; // MP3 | FLAC | WAV | ALAC | AAC | DSD ...
  bitrate?: number; // bps, only when known from the container
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  lossless?: boolean;
  cover?: { data: Uint8Array; mime: string };
};

export function blobSource(blob: Blob): RangeSource {
  return {
    size: blob.size,
    async read(start, end) {
      return new Uint8Array(await blob.slice(start, Math.min(end, blob.size)).arrayBuffer());
    },
  };
}
export function urlSource(url: string, size: number): RangeSource {
  return {
    size,
    async read(start, end) {
      const r = await fetch(url, { headers: { Range: `bytes=${start}-${Math.min(end, size) - 1}` } });
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

const dec = (enc: number, b: Uint8Array): string => {
  try {
    if (enc === 1 || enc === 2) {
      let bytes = b;
      let label = enc === 2 ? "utf-16be" : "utf-16le";
      if (b[0] === 0xff && b[1] === 0xfe) { label = "utf-16le"; bytes = b.slice(2); }
      else if (b[0] === 0xfe && b[1] === 0xff) { label = "utf-16be"; bytes = b.slice(2); }
      return new TextDecoder(label).decode(bytes).replace(/\0+$/g, "");
    }
    return new TextDecoder(enc === 3 ? "utf-8" : "windows-1252").decode(b).replace(/\0+$/g, "");
  } catch {
    return "";
  }
};
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const synch = (b: Uint8Array, o: number) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const str = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);

/* ---------------- ID3 ---------------- */
async function parseId3(src: RangeSource, at = 0): Promise<{ meta: Meta; size: number } | null> {
  const head = await src.read(at, at + 10);
  if (head.length < 10 || str(head, 0, 3) !== "ID3") return null;
  const ver = head[3];
  const tagSize = synch(head, 6);
  const total = 10 + tagSize;
  const body = await src.read(at + 10, at + 10 + Math.min(tagSize, 12 * 1024 * 1024));
  const meta: Meta = {};
  let p = 0;
  const idLen = ver === 2 ? 3 : 4;
  const hdr = ver === 2 ? 6 : 10;
  while (p + hdr <= body.length) {
    const id = str(body, p, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size = ver === 2 ? (body[p + 3] << 16) | (body[p + 4] << 8) | body[p + 5] : ver === 4 ? synch(body, p + 4) : u32(body, p + 4);
    const d = body.slice(p + hdr, p + hdr + size);
    p += hdr + size;
    if (!d.length) continue;
    const text = () => dec(d[0], d.slice(1)).split("\0")[0].trim();
    switch (id) {
      case "TIT2": case "TT2": meta.title = text(); break;
      case "TPE1": case "TP1": meta.artist = text(); break;
      case "TALB": case "TAL": meta.album = text(); break;
      case "TYER": case "TYE": case "TDRC": meta.year = meta.year || text().slice(0, 4); break;
      case "TRCK": case "TRK": meta.track = parseInt(text()) || undefined; break;
      case "APIC": case "PIC": {
        const enc = d[0];
        let o = 1;
        let mime = "image/jpeg";
        if (id === "APIC") {
          const e = d.indexOf(0, 1);
          mime = str(d, 1, e - 1) || "image/jpeg";
          o = e + 1;
        } else {
          mime = str(d, 1, 3).toUpperCase() === "PNG" ? "image/png" : "image/jpeg";
          o = 4;
        }
        o += 1; // picture type
        // skip description (null-terminated, width depends on encoding)
        if (enc === 1 || enc === 2) { while (o + 1 < d.length && !(d[o] === 0 && d[o + 1] === 0)) o += 2; o += 2; }
        else { while (o < d.length && d[o] !== 0) o++; o += 1; }
        if (!meta.cover && o < d.length) meta.cover = { data: d.slice(o), mime };
        break;
      }
    }
  }
  return { meta, size: total };
}

async function parseMp3(src: RangeSource): Promise<Meta> {
  const meta: Meta = { codec: "MP3", lossless: false };
  const id3 = await parseId3(src);
  let audioStart = 0;
  if (id3) { Object.assign(meta, id3.meta); audioStart = id3.size; }
  else if (src.size > 128) {
    const t = await src.read(src.size - 128, src.size);
    if (str(t, 0, 3) === "TAG") {
      const clean = (a: number, n: number) => dec(0, t.slice(a, a + n)).trim();
      meta.title = clean(3, 30); meta.artist = clean(33, 30); meta.album = clean(63, 30); meta.year = clean(93, 4);
    }
  }
  // first frame header
  const win = await src.read(audioStart, audioStart + 8192);
  for (let i = 0; i + 4 < win.length; i++) {
    if (win[i] === 0xff && (win[i + 1] & 0xe0) === 0xe0) {
      const v = (win[i + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
      const layer = (win[i + 1] >> 1) & 3;
      const sr = (win[i + 2] >> 2) & 3;
      if (v === 1 || layer !== 1 || sr === 3) continue;
      const rates = v === 3 ? [44100, 48000, 32000] : v === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
      meta.sampleRate = rates[sr];
      meta.channels = ((win[i + 3] >> 6) & 3) === 3 ? 1 : 2;
      break;
    }
  }
  return meta;
}

/* ---------------- FLAC ---------------- */
async function parseFlac(src: RangeSource): Promise<Meta> {
  const meta: Meta = { codec: "FLAC", lossless: true };
  const head = await src.read(0, 4);
  if (str(head, 0, 4) !== "fLaC") return meta;
  let pos = 4;
  for (let n = 0; n < 64; n++) {
    const h = await src.read(pos, pos + 4);
    if (h.length < 4) break;
    const last = !!(h[0] & 0x80);
    const type = h[0] & 0x7f;
    const len = (h[1] << 16) | (h[2] << 8) | h[3];
    if (type === 0 || type === 4 || (type === 6 && len < 16 * 1024 * 1024)) {
      const b = await src.read(pos + 4, pos + 4 + len);
      if (type === 0) {
        meta.sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
        meta.channels = ((b[12] >> 1) & 7) + 1;
        meta.bitDepth = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
        const samples = (b[13] & 0x0f) * 2 ** 32 + u32(b, 14);
        if (meta.sampleRate && samples) meta.duration = samples / meta.sampleRate;
      } else if (type === 4) {
        let o = 4 + u32le(b, 0);
        const count = u32le(b, o); o += 4;
        for (let i = 0; i < count && o + 4 <= b.length; i++) {
          const l = u32le(b, o); o += 4;
          const kv = new TextDecoder().decode(b.slice(o, o + l)); o += l;
          const eq = kv.indexOf("=");
          if (eq < 0) continue;
          const k = kv.slice(0, eq).toUpperCase(), v = kv.slice(eq + 1);
          if (k === "TITLE") meta.title = v;
          else if (k === "ARTIST") meta.artist = v;
          else if (k === "ALBUM") meta.album = v;
          else if (k === "DATE" || k === "YEAR") meta.year = v.slice(0, 4);
          else if (k === "TRACKNUMBER") meta.track = parseInt(v) || undefined;
        }
      } else if (type === 6 && !meta.cover) {
        const ml = u32(b, 4);
        const mime = str(b, 8, ml);
        let o = 8 + ml;
        const dl = u32(b, o); o += 4 + dl + 16;
        const pl = u32(b, o); o += 4;
        meta.cover = { data: b.slice(o, o + pl), mime: mime || "image/jpeg" };
      }
    }
    pos += 4 + len;
    if (last) break;
  }
  return meta;
}

/* ---------------- WAV ---------------- */
async function parseWav(src: RangeSource): Promise<Meta> {
  const meta: Meta = { codec: "WAV", lossless: true };
  const b = await src.read(0, Math.min(src.size, 256 * 1024));
  if (str(b, 0, 4) !== "RIFF") return meta;
  let p = 12;
  let byteRate = 0;
  while (p + 8 <= b.length) {
    const id = str(b, p, 4);
    const sz = u32le(b, p + 4);
    if (id === "fmt ") {
      meta.channels = u16le(b, p + 10);
      meta.sampleRate = u32le(b, p + 12);
      byteRate = u32le(b, p + 16);
      meta.bitDepth = u16le(b, p + 22);
      if (u16le(b, p + 8) === 3) meta.codec = "WAV (float)";
    } else if (id === "data") {
      if (byteRate) meta.duration = Math.min(sz, src.size - p - 8) / byteRate;
    } else if (id === "LIST" && str(b, p + 8, 4) === "INFO") {
      let q = p + 12;
      const end = Math.min(p + 8 + sz, b.length);
      while (q + 8 <= end) {
        const k = str(b, q, 4), l = u32le(b, q + 4);
        const v = dec(3, b.slice(q + 8, q + 8 + l));
        if (k === "INAM") meta.title = v; else if (k === "IART") meta.artist = v;
        else if (k === "IPRD") meta.album = v; else if (k === "ICRD") meta.year = v.slice(0, 4);
        q += 8 + l + (l & 1);
      }
    }
    p += 8 + sz + (sz & 1);
  }
  return meta;
}

/* ---------------- MP4 / M4A ---------------- */
type Box = { type: string; start: number; end: number; body: number };
function boxes(b: Uint8Array, from = 0, to = b.length): Box[] {
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = u32(b, p);
    const type = str(b, p + 4, 4);
    let body = p + 8;
    if (size === 1) { size = u64(b, p + 8); body = p + 16; }
    else if (size === 0) size = to - p;
    if (size < 8 || p + size > to) { if (size >= 8) out.push({ type, start: p, end: to, body }); break; }
    out.push({ type, start: p, end: p + size, body });
    p += size;
  }
  return out;
}
async function parseMp4(src: RangeSource): Promise<Meta> {
  const meta: Meta = { codec: "AAC", lossless: false };
  // locate moov via headers only
  let pos = 0;
  let moov: Uint8Array | null = null;
  while (pos + 8 <= src.size) {
    const h = await src.read(pos, pos + 16);
    let size = u32(h, 0);
    const type = str(h, 4, 4);
    if (size === 1) size = u64(h, 8);
    if (size === 0) size = src.size - pos;
    if (size < 8) break;
    if (type === "moov" && size < 48 * 1024 * 1024) { moov = await src.read(pos, pos + size); break; }
    pos += size;
  }
  if (!moov) return meta;
  const find = (b: Uint8Array, box: Box, path: string[]): Box | undefined => {
    let cur: Box | undefined = box;
    for (const t of path) {
      const kids: Box[] = boxes(b, cur.body, cur.end);
      cur = kids.find((k) => k.type === t);
      if (!cur) return undefined;
    }
    return cur;
  };
  const root: Box = { type: "root", start: 0, end: moov.length, body: 0 };
  const mv = boxes(moov)[0]; // moov itself
  const mvhd = find(moov, mv, ["mvhd"]);
  if (mvhd) {
    const v = moov[mvhd.body];
    const ts = v === 1 ? u32(moov, mvhd.body + 20) : u32(moov, mvhd.body + 12);
    const dur = v === 1 ? u64(moov, mvhd.body + 24) : u32(moov, mvhd.body + 16);
    if (ts) meta.duration = dur / ts;
  }
  void root;
  for (const trak of boxes(moov, mv.body, mv.end).filter((k) => k.type === "trak")) {
    const stsd = find(moov, trak, ["mdia", "minf", "stbl", "stsd"]);
    if (!stsd) continue;
    const entry = boxes(moov, stsd.body + 8, stsd.end)[0];
    if (!entry) continue;
    const t = entry.type;
    if (!["mp4a", "alac", "Opus", "fLaC", "ac-3", "ec-3"].includes(t)) continue;
    meta.codec = t === "alac" ? "ALAC" : t === "mp4a" ? "AAC" : t === "fLaC" ? "FLAC" : t === "Opus" ? "Opus" : t.toUpperCase();
    meta.lossless = t === "alac" || t === "fLaC";
    const e = entry.start;
    meta.channels = u16(moov, e + 24);
    meta.bitDepth = u16(moov, e + 26);
    meta.sampleRate = u16(moov, e + 32);
    if (t === "alac") {
      const kid = boxes(moov, e + 36, entry.end).find((k) => k.type === "alac");
      if (kid) {
        const c = kid.body + 4; // skip fullbox header
        meta.bitDepth = moov[c + 5];
        meta.channels = moov[c + 9];
        meta.sampleRate = u32(moov, c + 20);
      }
    }
    if (t !== "alac" && t !== "fLaC") meta.bitDepth = undefined;
    break;
  }
  const ilst = (() => {
    const meta1 = find(moov, mv, ["udta", "meta"]);
    if (!meta1) return undefined;
    return boxes(moov, meta1.body + 4, meta1.end).find((k) => k.type === "ilst");
  })();
  if (ilst) {
    for (const item of boxes(moov, ilst.body, ilst.end)) {
      const data = boxes(moov, item.body, item.end).find((k) => k.type === "data");
      if (!data) continue;
      const payload = moov.slice(data.body + 8, data.end);
      const key = item.type;
      if (key === "\u00a9nam") meta.title = dec(3, payload);
      else if (key === "\u00a9ART") meta.artist = dec(3, payload);
      else if (key === "\u00a9alb") meta.album = dec(3, payload);
      else if (key === "\u00a9day") meta.year = dec(3, payload).slice(0, 4);
      else if (key === "covr") meta.cover = { data: payload, mime: moov[data.body + 3] === 14 ? "image/png" : "image/jpeg" };
    }
  }
  return meta;
}

/* ---------------- DSF ---------------- */
async function parseDsf(src: RangeSource): Promise<Meta> {
  const meta: Meta = { codec: "DSD", lossless: true, bitDepth: 1 };
  const b = await src.read(0, 92);
  if (str(b, 0, 4) !== "DSD ") return meta;
  const metaPtr = u64(b, 20);
  meta.channels = u32le(b, 52);
  meta.sampleRate = u32le(b, 56);
  const samples = u32le(b, 64) + u32le(b, 68) * 2 ** 32;
  if (meta.sampleRate && samples) meta.duration = samples / meta.sampleRate;
  if (metaPtr > 0 && metaPtr < src.size) {
    const id3 = await parseId3(src, metaPtr);
    if (id3) Object.assign(meta, id3.meta, { codec: "DSD", sampleRate: meta.sampleRate, channels: meta.channels, duration: meta.duration, bitDepth: 1 });
  }
  return meta;
}

export async function readMetadata(src: RangeSource, ext: string): Promise<Meta> {
  try {
    switch (ext) {
      case "mp3": return await parseMp3(src);
      case "flac": return await parseFlac(src);
      case "wav": case "wave": return await parseWav(src);
      case "m4a": case "alac": case "aac": case "m4b": case "mp4": return await parseMp4(src);
      case "dsf": return await parseDsf(src);
      case "ogg": case "oga": return { codec: "Vorbis", lossless: false };
      case "opus": return { codec: "Opus", lossless: false };
      case "dff": return { codec: "DSD", lossless: true, bitDepth: 1 };
      default: return {};
    }
  } catch {
    return {};
  }
}

/** Downscale embedded artwork to a compact JPEG data URL for storage in the library. */
export async function coverToDataUrl(cover: { data: Uint8Array; mime: string }, size = 420): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(new Blob([cover.data.slice().buffer as ArrayBuffer], { type: cover.mime }));
    const k = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return c.toDataURL("image/jpeg", 0.82);
  } catch {
    return undefined;
  }
}
