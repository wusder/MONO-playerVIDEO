import { createStore, idbGet, idbSet, idbDelete } from "./store";

export type Theme = "dark" | "light" | "custom";
export type WallpaperRef =
  | { kind: "none" }
  | { kind: "preset"; id: string }
  | { kind: "image"; name: string }
  | { kind: "video"; name: string };

export type Settings = {
  version: 2;
  onboarded: boolean;
  theme: Theme;
  /** Custom theme (stays monochrome): background tone 0-100, text contrast 0-100 */
  customTone: number;
  customContrast: number;
  // Glass
  blur: number; // 0-100
  glassOpacity: number; // 0-100
  borderOpacity: number; // 0-100
  highlight: number; // 0-100
  shadow: number; // 0-100
  radius: number; // 0-100
  depth: number; // 0-100
  density: "comfortable" | "compact";
  // Wallpaper
  wallpaper: WallpaperRef;
  wallpaperBlur: number; // 0-100
  wallpaperDim: number; // 0-100
  wallpaperAnimated: boolean;
  // Interface
  uiScale: number; // 80-130
  sidebarOpacity: number; // 0-100
  coverSize: "small" | "medium" | "large";
  miniPlayer: "auto" | "always" | "hidden";
  animations: boolean;
  reducedMotion: boolean;
  reducedEffects: boolean;
  sidebarCollapsed: boolean;
  // Library UI
  sort: "added" | "title" | "artist" | "year";
  grid: boolean;
  // Playback
  volume: number; // 0-1
  muted: boolean;
  defaultSpeed: number;
  rememberPosition: boolean;
  autoPlayNext: boolean;
  videoFit: "contain" | "cover";
  subtitleLang: string; // "off" | "auto" | iso code
  subtitleSize: number; // %
  subtitleOpacity: number; // %
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  // Security
  autoLockMinutes: number; // 0 = disabled
  lockOnMinimize: boolean;
  // Translation / OCR
  translateProvider: "device" | "endpoint";
  translateEndpoint: string;
  translateApiKey: string;
  translateTarget: string;
  translateConsent: boolean;
  ocrLang: string;
  ocrConsent: boolean;
  // Mixer
  mixer: Record<string, { on: boolean; vol: number; muted?: boolean }>;
  mixerBalance: number;
};

export const DEFAULTS: Settings = {
  version: 2,
  onboarded: false,
  theme: "dark",
  customTone: 18,
  customContrast: 70,
  blur: 72,
  glassOpacity: 58,
  borderOpacity: 50,
  highlight: 40,
  shadow: 34,
  radius: 58,
  depth: 40,
  density: "comfortable",
  wallpaper: { kind: "preset", id: "aurora" },
  wallpaperBlur: 0,
  wallpaperDim: 0,
  wallpaperAnimated: true,
  uiScale: 100,
  sidebarOpacity: 50,
  coverSize: "medium",
  miniPlayer: "auto",
  animations: true,
  reducedMotion: false,
  reducedEffects: false,
  sidebarCollapsed: false,
  sort: "added",
  grid: true,
  volume: 0.7,
  muted: false,
  defaultSpeed: 1,
  rememberPosition: true,
  autoPlayNext: true,
  videoFit: "contain",
  subtitleLang: "auto",
  subtitleSize: 100,
  subtitleOpacity: 90,
  shuffle: false,
  repeat: "off",
  autoLockMinutes: 15,
  lockOnMinimize: false,
  translateProvider: "device",
  translateEndpoint: "",
  translateApiKey: "",
  translateTarget: "en",
  translateConsent: false,
  ocrLang: "eng",
  ocrConsent: false,
  mixer: {},
  mixerBalance: 62,
};

const KEY = "mono.settings.v2";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* corrupted → defaults */
  }
  return DEFAULTS;
}

export const settings = createStore<Settings>(load());

let saveTimer: number | undefined;
export function update(patch: Partial<Settings>) {
  settings.set(patch);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 150);
}
export function saveNow() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings.get()));
  } catch {
    /* quota */
  }
}
/** Restore appearance defaults only (keeps playback, security, library state). */
export function restoreAppearanceDefaults() {
  const d = DEFAULTS;
  update({
    theme: d.theme, customTone: d.customTone, customContrast: d.customContrast,
    blur: d.blur, glassOpacity: d.glassOpacity, borderOpacity: d.borderOpacity,
    highlight: d.highlight, shadow: d.shadow, radius: d.radius, depth: d.depth,
    density: d.density, wallpaper: d.wallpaper, wallpaperBlur: d.wallpaperBlur,
    wallpaperDim: d.wallpaperDim, wallpaperAnimated: d.wallpaperAnimated,
    uiScale: d.uiScale, sidebarOpacity: d.sidebarOpacity, coverSize: d.coverSize,
    miniPlayer: d.miniPlayer, animations: d.animations, reducedMotion: d.reducedMotion,
    reducedEffects: d.reducedEffects,
  });
}
export function restoreAllDefaults() {
  const keep = { onboarded: true };
  update({ ...DEFAULTS, ...keep });
}

/* ---------- Custom wallpaper blobs ---------- */
export async function saveCustomWallpaper(kind: "image" | "video", file: Blob, name: string) {
  const ok = await idbSet("blobs", "wallpaper", file);
  if (!ok) return false;
  update({ wallpaper: { kind, name } });
  return true;
}
export async function loadCustomWallpaper(): Promise<Blob | undefined> {
  return idbGet<Blob>("blobs", "wallpaper");
}
export async function clearCustomWallpaper() {
  await idbDelete("blobs", "wallpaper");
}

/* ---------- CSS variable application ---------- */
const lerp = (a: number, b: number, t: number) => a + (b - a) * (t / 100);
const gray = (v: number) => {
  const h = Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
};

export function applyToDocument(s: Settings, root: HTMLElement) {
  const st = root.style;
  const set = (k: string, v: string) => st.setProperty(k, v);
  // Defaults map to the original design values (blur 44px, border .105, highlight .07, shadow .4 ...)
  set("--blur", `${((s.blur * 44) / 72).toFixed(1)}px`);
  set("--glass-opacity", `${s.glassOpacity}%`);
  set("--glass-k", `${(s.glassOpacity / 58).toFixed(3)}`);
  set("--border-alpha", `${(0.002 + (s.borderOpacity / 50) * 0.103).toFixed(3)}`);
  set("--hl-alpha", `${((s.highlight / 40) * 0.07).toFixed(3)}`);
  set("--shadow-alpha", `${Math.min(1, (s.shadow / 34) * 0.4).toFixed(3)}`);
  set("--depth-k", `${(s.depth / 40).toFixed(3)}`);
  set("--radius-scale", `${(s.radius / 58).toFixed(3)}`);
  set("--sidebar-alpha", `${(s.sidebarOpacity / 100).toFixed(3)}`);
  set("--wall-blur", `${lerp(0, 60, s.wallpaperBlur).toFixed(1)}px`);
  set("--wall-dim", `${lerp(0, 0.85, s.wallpaperDim).toFixed(3)}`);
  const cols = s.coverSize === "small" ? [6, 4, 3] : s.coverSize === "large" ? [3, 2, 2] : [4, 3, 2];
  set("--cover-cols", String(cols[0]));
  set("--cover-cols-md", String(cols[1]));
  set("--cover-cols-sm", String(cols[2]));
  set("--ui-scale", String(s.uiScale / 100));
  set("--density", s.density === "compact" ? "0.8" : "1");
  const custom = ["--bg", "--text", "--text-2", "--surface", "--surface-strong", "--surface-soft", "--line-rgb"];
  if (s.theme === "custom") {
    const tone = lerp(4, 235, s.customTone);
    const light = tone > 128;
    const fg = light ? lerp(40, 0, s.customContrast) : lerp(190, 255, s.customContrast);
    const fg2 = light ? lerp(110, 70, s.customContrast) : lerp(140, 180, s.customContrast);
    set("--bg", gray(tone));
    set("--text", gray(fg));
    set("--text-2", gray(fg2));
    set("--surface", light ? "rgba(255,255,255,0.6)" : "rgba(28,28,30,0.62)");
    set("--surface-strong", light ? "rgba(250,250,252,0.92)" : "rgba(24,24,26,0.9)");
    set("--surface-soft", light ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)");
    set("--line-rgb", light ? "0,0,0" : "255,255,255");
    set("color-scheme", light ? "light" : "dark");
  } else {
    custom.forEach((v) => st.removeProperty(v));
    set("color-scheme", s.theme === "light" ? "light" : "dark");
  }
}
