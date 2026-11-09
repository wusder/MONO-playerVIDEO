/** Subtitle translation (on-device Translator API or a user-configured LibreTranslate-style endpoint) and OCR. */
import { settings } from "./settings";

type TranslatorApi = {
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<{ translate(t: string): Promise<string> }>;
  availability?(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
};
type DetectorApi = { create(): Promise<{ detect(t: string): Promise<{ detectedLanguage: string; confidence: number }[]> }> };
const g = globalThis as unknown as { Translator?: TranslatorApi; LanguageDetector?: DetectorApi; TextDetector?: new () => { detect(i: CanvasImageSource): Promise<{ rawValue: string }[]> } };

export const hasDeviceTranslator = () => typeof g.Translator?.create === "function";
export const hasTextDetector = () => typeof g.TextDetector === "function";

export const TARGETS: [string, string][] = [
  ["en", "English"], ["ru", "Russian"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["it", "Italian"],
  ["pt", "Portuguese"], ["uk", "Ukrainian"], ["pl", "Polish"], ["tr", "Turkish"], ["ja", "Japanese"], ["zh", "Chinese"], ["ko", "Korean"],
];

export async function detectLanguage(text: string): Promise<string | null> {
  try {
    if (g.LanguageDetector?.create) {
      const d = await g.LanguageDetector.create();
      const r = await d.detect(text);
      if (r[0]?.confidence > 0.4) return r[0].detectedLanguage.split("-")[0];
    }
  } catch { /* fall through */ }
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  if (/[\u3040-\u30FF]/.test(text)) return "ja";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko";
  return null;
}

export type TranslateResult = { ok: true; text: string; from: string } | { ok: false; reason: string };

const withTimeout = <T,>(p: Promise<T>, ms: number, msg: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

export async function translate(text: string): Promise<TranslateResult> {
  const s = settings.get();
  const to = s.translateTarget;
  const from = (await detectLanguage(text)) ?? "en";
  if (from === to) return { ok: true, text, from };
  if (s.translateProvider === "device") {
    if (!hasDeviceTranslator()) return { ok: false, reason: "On-device translation is not available in this browser engine. Choose a translation service in Settings → Playback → Translation." };
    try {
      const t = await withTimeout(g.Translator!.create({ sourceLanguage: from, targetLanguage: to }), 10000, "the language pack is not available offline");
      return { ok: true, text: await withTimeout(t.translate(text), 15000, "translation timed out"), from };
    } catch (e) {
      return { ok: false, reason: `On-device translation failed (${(e as Error).message || "language pair unavailable"}).` };
    }
  }
  if (!s.translateEndpoint) return { ok: false, reason: "No translation service is configured. Add a LibreTranslate-compatible URL in Settings → Playback → Translation." };
  if (!s.translateConsent) return { ok: false, reason: "Sending text to an external service requires your consent. Enable it in Settings → Playback → Translation." };
  try {
    const r = await fetch(s.translateEndpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source: "auto", target: to, format: "text", api_key: s.translateApiKey || undefined }),
    });
    if (!r.ok) return { ok: false, reason: `The translation service answered ${r.status}.` };
    const j = await r.json();
    if (typeof j.translatedText !== "string") return { ok: false, reason: "The translation service returned an unexpected response." };
    return { ok: true, text: j.translatedText, from: j.detectedLanguage?.language ?? from };
  } catch {
    return { ok: false, reason: "Could not reach the translation service." };
  }
}

export type OcrResult = { ok: true; text: string; engine: string } | { ok: false; reason: string };
export async function ocr(canvas: HTMLCanvasElement): Promise<OcrResult> {
  const s = settings.get();
  if (hasTextDetector()) {
    try {
      const found = await new g.TextDetector!().detect(canvas);
      const text = found.map((f) => f.rawValue).join("\n").trim();
      if (text) return { ok: true, text, engine: "System text detector" };
    } catch { /* try tesseract */ }
  }
  if (!s.ocrConsent) return { ok: false, reason: "OCR needs a recognition engine. Enable the Tesseract engine in Settings → Playback → Translation (it downloads language data from a CDN on first use)." };
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(s.ocrLang);
    const { data } = await worker.recognize(canvas);
    await worker.terminate();
    const text = data.text.trim();
    return text ? { ok: true, text, engine: "Tesseract" } : { ok: false, reason: "No text was recognised in the selected region." };
  } catch (e) {
    return { ok: false, reason: `OCR could not start (${(e as Error).message || "offline?"}). Language data is downloaded on first use.` };
  }
}
