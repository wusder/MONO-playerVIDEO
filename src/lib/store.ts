import { useSyncExternalStore } from "react";

/** Minimal external store used by the engine, library and settings. */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    use<S>(selector: (s: T) => S): S {
      return useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => selector(state),
      );
    },
  };
}

/** Tiny promise-based IndexedDB key/value helper (stores: kv, handles, blobs). */
const DB_NAME = "mono-player";
let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const s of ["kv", "handles", "blobs"]) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
export type StoreName = "kv" | "handles" | "blobs";
export async function idbGet<V = unknown>(store: StoreName, key: string): Promise<V | undefined> {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const r = d.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => res(r.result as V | undefined);
      r.onerror = () => rej(r.error);
    });
  } catch {
    return undefined;
  }
}
export async function idbSet(store: StoreName, key: string, value: unknown): Promise<boolean> {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const tx = d.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    return false;
  }
}
export async function idbDelete(store: StoreName, key: string) {
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

export function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Toast notifications. */
export type Toast = { id: number; text: string; action?: { label: string; run: () => void } };
export const toasts = createStore<{ list: Toast[] }>({ list: [] });
let toastId = 1;
export function toast(text: string, action?: Toast["action"], ms = 5200) {
  const id = toastId++;
  toasts.set((s) => ({ list: [...s.list, { id, text, action }] }));
  setTimeout(() => toasts.set((s) => ({ list: s.list.filter((t) => t.id !== id) })), ms);
}
