/** Procedural monochrome wallpapers (no image assets: crisp at any resolution, tiny to ship). */
export type WpCat = "Minimal" | "Gradient" | "Fog" | "Liquid" | "Texture" | "Abstract" | "Live";
export const WP_CATS: WpCat[] = ["Minimal", "Gradient", "Fog", "Liquid", "Texture", "Abstract", "Live"];
export type WpLive = "aurora" | "fog" | "liquid" | "orbit";
export type Wp = { id: string; name: string; cat: WpCat; bg: string; live?: WpLive; follow?: boolean };

const svg = (inner: string, vb = "0 0 1200 800", par = "none") =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${vb}' preserveAspectRatio='${par}'>${inner}</svg>`,
  )}")`;
const turb = (freq: string, oct: number, seed: number, matrix: string, tile = true) =>
  svg(`<filter id='f' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='${oct}' seed='${seed}' ${tile ? "stitchTiles='stitch'" : ""}/><feColorMatrix type='matrix' values='${matrix}'/></filter><rect width='100%' height='100%' filter='url(#f)'/>`);

const FOG_LIGHT = "0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.9 -.62";
const FOG_SOFT = "0 0 0 0 .86  0 0 0 0 .86  0 0 0 0 .88  0 0 0 1.5 -.5";
const SMOKE = "0 0 0 0 .75  0 0 0 0 .75  0 0 0 0 .78  0 0 0 2.2 -.8";
export const FOG_TILE = turb(".0035 .006", 4, 3, FOG_LIGHT);

export const WALLPAPERS: Wp[] = [
  { id: "aurora", name: "Mono Aurora", cat: "Live", bg: "", live: "aurora", follow: true },

  { id: "void", name: "Void", cat: "Minimal", bg: "radial-gradient(ellipse at 50% 120%, #161616, #030303 70%)" },
  { id: "graphite", name: "Graphite", cat: "Minimal", bg: "radial-gradient(circle at 30% 20%, #2a2a2c, #151516 60%, #0c0c0d)" },
  { id: "paper", name: "Paper", cat: "Minimal", bg: "radial-gradient(circle at 70% 0%, #ffffff, #d9d9de 70%)" },

  { id: "dusk", name: "Dusk", cat: "Gradient", bg: "linear-gradient(160deg, #0a0a0b 0%, #232325 45%, #4a4a4e 100%)" },
  { id: "silver", name: "Silver Fade", cat: "Gradient", bg: "linear-gradient(145deg, #f4f4f7 0%, #c2c2c8 55%, #8b8b92 100%)" },
  { id: "spotlight", name: "Spotlight", cat: "Gradient", bg: "radial-gradient(ellipse at 50% -10%, #6a6a6e 0%, #1b1b1d 45%, #050505 80%)" },

  { id: "fog-morning", name: "Morning Fog", cat: "Fog", bg: `${FOG_TILE} 0 0/100% 100%, linear-gradient(180deg, #2b2b2e, #0d0d0e)` },
  { id: "fog-dense", name: "Dense Fog", cat: "Fog", bg: `${turb(".005 .009", 5, 11, FOG_SOFT)} 0 0/100% 100%, linear-gradient(180deg, #1d1d1f, #070707)` },
  { id: "smoke", name: "Soft Smoke", cat: "Fog", bg: `${turb(".0028 .0045", 3, 27, SMOKE)} 0 0/100% 100%, radial-gradient(circle at 20% 80%, #3a3a3d, #0a0a0b 70%)` },

  { id: "mercury", name: "Mercury", cat: "Liquid", bg: "radial-gradient(circle at 25% 30%, rgba(255,255,255,.34), transparent 28%), radial-gradient(circle at 70% 65%, rgba(255,255,255,.22), transparent 32%), radial-gradient(circle at 45% 85%, rgba(255,255,255,.14), transparent 30%), #101011" },
  { id: "ink", name: "Ink", cat: "Liquid", bg: "radial-gradient(ellipse at 80% 20%, #3a3a3c, transparent 40%), radial-gradient(ellipse at 15% 75%, #262628, transparent 45%), radial-gradient(ellipse at 55% 55%, #161617, transparent 60%), #050505" },
  { id: "pearl", name: "Pearl", cat: "Liquid", bg: "radial-gradient(circle at 30% 30%, #ffffff, transparent 35%), radial-gradient(circle at 75% 70%, #bdbdc4, transparent 40%), radial-gradient(circle at 50% 100%, #8e8e96, transparent 45%), #d6d6db" },

  { id: "grain", name: "Grain", cat: "Texture", bg: `${turb(".85", 3, 4, "0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 -.1")} 0 0/260px 260px, radial-gradient(circle at 50% 30%, #262628, #080808)` },
  { id: "steel", name: "Brushed Steel", cat: "Texture", bg: `${turb(".0015 .9", 3, 8, "0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .7 -.25")} 0 0/100% 100%, linear-gradient(115deg, #3a3a3d, #1a1a1c 35%, #444447 60%, #1d1d1f)` },
  { id: "concrete", name: "Concrete", cat: "Texture", bg: `${turb(".055", 5, 15, "0 0 0 0 .8  0 0 0 0 .8  0 0 0 0 .82  0 0 0 1.4 -.45")} 0 0/420px 420px, linear-gradient(160deg, #3b3b3e, #232325)` },

  { id: "orbit", name: "Orbit", cat: "Abstract", bg: "conic-gradient(from 210deg at 70% 40%, transparent, rgba(255,255,255,.22), transparent 30%), conic-gradient(from 20deg at 25% 75%, transparent, rgba(255,255,255,.12), transparent 25%), #060606" },
  { id: "monolith", name: "Monolith", cat: "Abstract", bg: "linear-gradient(100deg, transparent 0 18%, rgba(255,255,255,.06) 18% 40%, transparent 40% 52%, rgba(255,255,255,.1) 52% 68%, transparent 68%), linear-gradient(180deg, #19191b, #050505)" },
  { id: "waves", name: "Waves", cat: "Abstract", bg: "repeating-radial-gradient(circle at 80% 110%, rgba(255,255,255,.08) 0 2px, transparent 2px 36px), linear-gradient(180deg, #0f0f10, #1f1f21)" },

  { id: "live-fog", name: "Drifting Fog", cat: "Live", bg: "linear-gradient(180deg, #2b2b2e, #0d0d0e)", live: "fog" },
  { id: "live-liquid", name: "Liquid Motion", cat: "Live", bg: "#070707", live: "liquid" },
  { id: "live-orbit", name: "Slow Orbit", cat: "Live", bg: "#060606", live: "orbit" },
];

export const wpById = (id: string) => WALLPAPERS.find((w) => w.id === id);
