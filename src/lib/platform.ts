/**
 * Platform layer: the same UI runs in a Tauri 2 desktop shell (native dialogs, real file paths,
 * native window controls) and in a plain browser (File System Access API with graceful fallbacks).
 */
import { type RangeSource, blobSource, urlSource } from "./metadata";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const AUDIO_EXT = ["mp3", "flac", "wav", "wave", "m4a", "alac", "aac", "ogg", "oga", "opus", "dsf", "dff"];
export const VIDEO_EXT = ["mp4", "m4v", "mkv", "webm", "mov", "ogv", "avi"];
export const SUB_EXT = ["srt", "ass", "ssa", "vtt"];
export const MEDIA_EXT = [...AUDIO_EXT, ...VIDEO_EXT];

export const extOf = (name: string) => (name.split(".").pop() || "").toLowerCase();
export const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
export const kindOf = (ext: string): "audio" | "video" | "sub" | null =>
  AUDIO_EXT.includes(ext) ? "audio" : VIDEO_EXT.includes(ext) ? "video" : SUB_EXT.includes(ext) ? "sub" : null;

/** Where the bytes live. At most one of these is set. */
export type Source = { file?: File; handle?: FileSystemFileHandle; path?: string };
export type Picked = { name: string; size: number; ext: string; dir: string; src: Source };

/* ---------------- native / browser access ---------------- */
type FsHandle = FileSystemFileHandle & {
  queryPermission?: (d: { mode: "read" }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: "read" }) => Promise<PermissionState>;
};
const w = window as unknown as {
  showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle>;
};
export const hasFsAccess = !isTauri && typeof w.showOpenFilePicker === "function";

export async function ensureHandlePermission(h: FileSystemFileHandle): Promise<boolean> {
  const hh = h as FsHandle;
  try {
    if (!hh.queryPermission) return true;
    if ((await hh.queryPermission({ mode: "read" })) === "granted") return true;
    return (await hh.requestPermission?.({ mode: "read" })) === "granted";
  } catch {
    return false;
  }
}

async function tauriConvert(path: string): Promise<string> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(path);
}

export async function resolveFile(src: Source): Promise<File> {
  if (src.file) return src.file;
  if (src.handle) {
    if (!(await ensureHandlePermission(src.handle))) throw new Error("permission");
    return src.handle.getFile();
  }
  throw new Error("no-source");
}

export async function mediaUrl(src: Source, ext: string): Promise<{ url: string; revoke: () => void }> {
  if (src.path) return { url: await tauriConvert(src.path), revoke: () => {} };
  const f = await resolveFile(src);
  // Chromium demuxes Matroska through its WebM path; give it a hint it accepts.
  const blob = ext === "mkv" ? f.slice(0, f.size, "video/webm") : f;
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

export async function rangeSource(src: Source, size: number): Promise<RangeSource> {
  if (src.path) return urlSource(await tauriConvert(src.path), size);
  return blobSource(await resolveFile(src));
}

export async function readText(src: Source): Promise<ArrayBuffer> {
  if (src.path) {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const u8 = await readFile(src.path);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  }
  return (await resolveFile(src)).arrayBuffer();
}

export async function sourceExists(src: Source): Promise<boolean> {
  try {
    if (src.path) {
      const { exists } = await import("@tauri-apps/plugin-fs");
      return await exists(src.path);
    }
    if (src.handle) {
      const hh = src.handle as FsHandle;
      if (hh.queryPermission && (await hh.queryPermission({ mode: "read" })) !== "granted") return true; // unknown → not "missing"
      await src.handle.getFile();
      return true;
    }
    return !!src.file;
  } catch (e) {
    return (e as DOMException)?.name !== "NotFoundError" ? true : false;
  }
}

/* ---------------- pickers ---------------- */
const pickedFromFile = (file: File, dir: string, handle?: FileSystemFileHandle): Picked => ({
  name: file.name, size: file.size, ext: extOf(file.name), dir, src: handle ? { handle } : { file },
});

function pickWithInput(accept: string, multiple: boolean, directory = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple || directory;
    if (accept) input.accept = accept;
    if (directory) (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = () => { resolve(Array.from(input.files || [])); input.remove(); };
    input.addEventListener("cancel", () => { resolve([]); input.remove(); });
    input.click();
  });
}

export async function pickMediaFiles(): Promise<Picked[]> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({
      multiple: true,
      filters: [
        { name: "Media", extensions: MEDIA_EXT },
        { name: "Subtitles", extensions: SUB_EXT },
      ],
    });
    if (!sel) return [];
    return tauriPicked(Array.isArray(sel) ? sel : [sel]);
  }
  if (hasFsAccess) {
    try {
      const handles = await w.showOpenFilePicker!({
        multiple: true,
        types: [{ description: "Media and subtitles", accept: {
          "audio/*": AUDIO_EXT.map((e) => `.${e}`),
          "video/*": VIDEO_EXT.map((e) => `.${e}`),
          "text/plain": SUB_EXT.map((e) => `.${e}`),
        } }],
      });
      return Promise.all(handles.map(async (h) => pickedFromFile(await h.getFile(), "", h)));
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return [];
      throw e;
    }
  }
  const files = await pickWithInput([...MEDIA_EXT, ...SUB_EXT].map((e) => `.${e}`).join(","), true);
  return files.map((f) => pickedFromFile(f, ""));
}

export async function pickSubtitleFile(): Promise<Picked | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ multiple: false, filters: [{ name: "Subtitles", extensions: SUB_EXT }] });
    if (!sel || Array.isArray(sel)) return null;
    return (await tauriPicked([sel]))[0] ?? null;
  }
  const files = await pickWithInput(SUB_EXT.map((e) => `.${e}`).join(","), false);
  return files[0] ? pickedFromFile(files[0], "") : null;
}

export async function pickAnyFile(accept: string[], description: string): Promise<File | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ multiple: false, filters: [{ name: description, extensions: accept }] });
    if (!sel || Array.isArray(sel)) return null;
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(sel);
    return new File([bytes.slice().buffer as ArrayBuffer], baseName(sel));
  }
  const files = await pickWithInput(accept.map((e) => `.${e}`).join(","), false);
  return files[0] ?? null;
}

export async function pickFolder(): Promise<Picked[]> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, multiple: false, recursive: true });
    if (!dir || Array.isArray(dir)) return [];
    return scanTauriDir(dir, "");
  }
  if (typeof w.showDirectoryPicker === "function") {
    try {
      const dh = await w.showDirectoryPicker({ mode: "read" });
      const out: Picked[] = [];
      await walkDirHandle(dh, "", out);
      return out;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return [];
      throw e;
    }
  }
  const files = await pickWithInput("", true, true);
  return files
    .filter((f) => kindOf(extOf(f.name)))
    .map((f) => {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      return pickedFromFile(f, rel.split("/").slice(0, -1).join("/"));
    });
}

async function walkDirHandle(dh: FileSystemDirectoryHandle, dir: string, out: Picked[]) {
  for await (const [name, h] of (dh as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (h.kind === "directory") await walkDirHandle(h as FileSystemDirectoryHandle, `${dir}/${name}`, out);
    else if (kindOf(extOf(name))) out.push(pickedFromFile(await (h as FileSystemFileHandle).getFile(), dir, h as FileSystemFileHandle));
  }
}

async function tauriPicked(paths: string[]): Promise<Picked[]> {
  const { stat } = await import("@tauri-apps/plugin-fs");
  const out: Picked[] = [];
  for (const p of paths) {
    const name = baseName(p);
    if (!kindOf(extOf(name))) continue;
    try {
      const s = await stat(p);
      out.push({ name, size: s.size, ext: extOf(name), dir: p.slice(0, p.length - name.length), src: { path: p } });
    } catch { /* unreadable */ }
  }
  return out;
}

async function scanTauriDir(root: string, rel: string): Promise<Picked[]> {
  const { readDir, stat } = await import("@tauri-apps/plugin-fs");
  const sep = root.includes("\\") ? "\\" : "/";
  const out: Picked[] = [];
  const walk = async (dir: string, relDir: string) => {
    for (const e of await readDir(dir)) {
      const full = `${dir}${sep}${e.name}`;
      if (e.isDirectory) await walk(full, `${relDir}/${e.name}`);
      else if (kindOf(extOf(e.name))) {
        try { out.push({ name: e.name, size: (await stat(full)).size, ext: extOf(e.name), dir: relDir, src: { path: full } }); } catch { /* skip */ }
      }
    }
  };
  await walk(root, rel);
  return out;
}

/** HTML5 drag & drop (browser). Prefers real handles so the library survives restarts. */
export async function pickedFromDataTransfer(dt: DataTransfer): Promise<Picked[]> {
  const out: Picked[] = [];
  const items = Array.from(dt.items || []).filter((i) => i.kind === "file");
  const walkEntry = async (entry: FileSystemEntry, dir: string): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      if (kindOf(extOf(f.name))) out.push(pickedFromFile(f, dir));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walkEntry(e, `${dir}/${entry.name}`);
      }
    }
  };
  // Collect synchronously first: DataTransfer is cleared after the first await.
  const jobs = items.map((i) => ({
    handleP: (i as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.(),
    entry: i.webkitGetAsEntry?.() ?? null,
    file: i.getAsFile(),
  }));
  for (const j of jobs) {
    let handle: FileSystemHandle | null = null;
    try { handle = (await j.handleP) ?? null; } catch { handle = null; }
    if (handle?.kind === "file") {
      const f = await (handle as FileSystemFileHandle).getFile();
      if (kindOf(extOf(f.name))) out.push(pickedFromFile(f, "", handle as FileSystemFileHandle));
    } else if (handle?.kind === "directory") {
      await walkDirHandle(handle as FileSystemDirectoryHandle, `/${handle.name}`, out);
    } else if (j.entry) await walkEntry(j.entry, "");
    else if (j.file && kindOf(extOf(j.file.name))) out.push(pickedFromFile(j.file, ""));
  }
  return out;
}

/** Tauri delivers dropped files as paths through the webview, not as HTML5 events. */
export async function onNativeDrop(handlers: {
  over: (v: boolean) => void;
  drop: (items: Picked[]) => void;
}): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const { readDir } = await import("@tauri-apps/plugin-fs");
  return getCurrentWebview().onDragDropEvent(async (e) => {
    const p = e.payload;
    if (p.type === "enter" || p.type === "over") handlers.over(true);
    else if (p.type === "leave") handlers.over(false);
    else if (p.type === "drop") {
      handlers.over(false);
      const files: Picked[] = [];
      for (const path of p.paths) {
        let isDir = false;
        try { await readDir(path); isDir = true; } catch { /* file */ }
        if (isDir) files.push(...(await scanTauriDir(path, "")));
        else files.push(...(await tauriPicked([path])));
      }
      handlers.drop(files);
    }
  });
}

/* ---------------- window ---------------- */
export const windowControls = {
  async minimize() { if (isTauri) (await import("@tauri-apps/api/window")).getCurrentWindow().minimize(); },
  async toggleMaximize() {
    if (isTauri) (await import("@tauri-apps/api/window")).getCurrentWindow().toggleMaximize();
    else if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  },
  async close() { if (isTauri) (await import("@tauri-apps/api/window")).getCurrentWindow().close(); },
};

export async function setFullscreen(on: boolean) {
  if (isTauri) {
    try { await (await import("@tauri-apps/api/window")).getCurrentWindow().setFullscreen(on); } catch { /* ignore */ }
  } else if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.().catch(() => {});
  else if (!on && document.fullscreenElement) await document.exitFullscreen().catch(() => {});
}
