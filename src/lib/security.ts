/**
 * Optional password lock. Only a salted PBKDF2-SHA256 hash is stored — never the password.
 * (A native build can additionally move the hash into the OS credential vault; see README.)
 */
const KEY = "mono.security.v1";
const ITER = 310_000;

type Record = { salt: string; hash: string; iter: number };
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pw: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt.slice().buffer as ArrayBuffer, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}
const read = (): Record | null => {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
};
export const hasPassword = () => !!read();

export async function setPassword(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pw, salt, ITER);
  localStorage.setItem(KEY, JSON.stringify({ salt: b64(salt), hash: b64(hash), iter: ITER } satisfies Record));
}
export async function verifyPassword(pw: string): Promise<boolean> {
  const r = read();
  if (!r) return true;
  const h = await derive(pw, unb64(r.salt), r.iter);
  const want = unb64(r.hash);
  let diff = h.length ^ want.length;
  for (let i = 0; i < h.length; i++) diff |= h[i] ^ (want[i] ?? 0);
  return diff === 0;
}
export const clearPassword = () => localStorage.removeItem(KEY);
