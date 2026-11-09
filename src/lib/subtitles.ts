export type Cue = { start: number; end: number; text: string };

const ts = (s: string): number => {
  // 00:01:02,345 | 01:02.345 | 1:02:03.45 (ASS h:mm:ss.cc)
  const m = s.trim().replace(",", ".").match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return NaN;
  return (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + parseFloat(m[3]);
};
const clean = (t: string) =>
  t
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\h/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

/** SRT and WebVTT share the same cue structure. */
function parseBlocks(src: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = src.replace(/\r/g, "").split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, rest] = lines[i].split("-->");
    const start = ts(a);
    const end = ts(rest.trim().split(/\s+/)[0]);
    const text = clean(lines.slice(i + 1).join("\n"));
    if (isFinite(start) && isFinite(end) && text) cues.push({ start, end, text });
  }
  return cues;
}

function parseAss(src: string): Cue[] {
  const cues: Cue[] = [];
  let format: string[] = [];
  let inEvents = false;
  for (const raw of src.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      inEvents = line.toLowerCase() === "[events]";
      continue;
    }
    if (!inEvents) continue;
    if (/^format\s*:/i.test(line)) {
      format = line.slice(line.indexOf(":") + 1).split(",").map((x) => x.trim().toLowerCase());
    } else if (/^dialogue\s*:/i.test(line)) {
      const body = line.slice(line.indexOf(":") + 1).trimStart();
      const n = format.length || 10;
      const parts: string[] = [];
      let rest = body;
      for (let k = 0; k < n - 1; k++) {
        const c = rest.indexOf(",");
        if (c < 0) break;
        parts.push(rest.slice(0, c));
        rest = rest.slice(c + 1);
      }
      parts.push(rest);
      const get = (name: string, fallback: number) => parts[format.indexOf(name) >= 0 ? format.indexOf(name) : fallback];
      const start = ts(get("start", 1) ?? "");
      const end = ts(get("end", 2) ?? "");
      const text = clean(get("text", n - 1) ?? "");
      if (isFinite(start) && isFinite(end) && text) cues.push({ start, end, text });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function parseSubtitles(text: string, filename: string): Cue[] {
  const t = text.replace(/^\uFEFF/, "");
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "ass" || ext === "ssa" || /^\[script info\]/im.test(t)) return parseAss(t);
  return parseBlocks(t).sort((a, b) => a.start - b.start);
}

/** Decode subtitle bytes: UTF-8 first, falling back to windows-1251 / 1252 for legacy files. */
export function decodeSubtitleBytes(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    const cp1251 = new TextDecoder("windows-1251").decode(buf);
    return /[А-Яа-яЁё]{3}/.test(cp1251) ? cp1251 : new TextDecoder("windows-1252").decode(buf);
  }
}

export function activeCue(cues: Cue[], t: number): Cue | null {
  // binary search for last cue with start <= t, then scan a few back for overlaps
  let lo = 0, hi = cues.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  for (let i = idx; i >= 0 && i > idx - 4; i--) if (t <= cues[i].end) return cues[i];
  return null;
}

export function guessLang(filename: string): string {
  const m = filename.toLowerCase().match(/[._-](en|ru|de|fr|es|it|ja|zh|ko|pt|uk|pl|tr|nl)(?=[._-]|\.[a-z]{3}$)/);
  return m ? m[1] : "und";
}
export const LANG_NAMES: Record<string, string> = {
  en: "English", ru: "Russian", de: "German", fr: "French", es: "Spanish", it: "Italian",
  ja: "Japanese", zh: "Chinese", ko: "Korean", pt: "Portuguese", uk: "Ukrainian", pl: "Polish",
  tr: "Turkish", nl: "Dutch", und: "Unknown",
};
