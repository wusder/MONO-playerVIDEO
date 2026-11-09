import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, IconButton, Logo, type IconName } from "../ui";
import { createStore, toasts } from "../lib/store";
import { hasPassword, verifyPassword } from "../lib/security";

/* ---------------- context menu ---------------- */
export type MenuItem = {
  label: string;
  icon?: IconName;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  children?: MenuItem[];
  separator?: boolean;
};
const menu = createStore<{ open: { x: number; y: number; items: MenuItem[] } | null }>({ open: null });
export function openMenu(x: number, y: number, items: MenuItem[]) {
  menu.set({ open: { x, y, items } });
}
export function openMenuFromEvent(e: React.MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  openMenu(e.clientX, e.clientY, items);
}
export function openMenuBelow(el: HTMLElement, items: MenuItem[]) {
  const r = el.getBoundingClientRect();
  openMenu(r.left, r.bottom + 6, items);
}

export function ContextMenu() {
  const open = menu.use((s) => s.open);
  const [stack, setStack] = useState<MenuItem[][]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => { setStack(open ? [open.items] : []); }, [open]);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(open.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(open.y, window.innerHeight - r.height - 8)),
    });
  }, [open, stack]);
  useEffect(() => {
    if (!open) return;
    const close = () => menu.set({ open: null });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("blur", close); window.removeEventListener("resize", close); window.removeEventListener("keydown", onKey, true); };
  }, [open]);
  if (!open) return null;
  const items = stack[stack.length - 1] ?? [];
  return (
    <div className="menu-backdrop" onMouseDown={() => menu.set({ open: null })} onContextMenu={(e) => { e.preventDefault(); menu.set({ open: null }); }}>
      <div ref={ref} className="popover context-menu" role="menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
        {stack.length > 1 && (
          <button className="menu-back" onClick={() => setStack(stack.slice(0, -1))}>
            <Icon name="chevron" size={14} /> Back
          </button>
        )}
        <div className="menu-list">
          {items.map((it, i) =>
            it.separator ? (
              <hr key={i} />
            ) : (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                className={it.danger ? "danger" : ""}
                onClick={() => {
                  if (it.children) setStack([...stack, it.children]);
                  else { menu.set({ open: null }); it.onClick?.(); }
                }}
              >
                {it.icon && <Icon name={it.icon} size={15} />}
                <span>{it.label}</span>
                {it.checked && <Icon name="check" size={14} />}
                {it.children && <Icon name="chevron" size={14} />}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- dialogs ---------------- */
type DialogState =
  | { kind: "text"; title: string; initial: string; confirm: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; title: string; body: string; confirm: string; danger?: boolean; resolve: (v: boolean) => void }
  | null;
const dialog = createStore<{ d: DialogState }>({ d: null });
export const askText = (title: string, initial = "", confirm = "Save") =>
  new Promise<string | null>((resolve) => dialog.set({ d: { kind: "text", title, initial, confirm, resolve } }));
export const askConfirm = (title: string, body: string, confirm = "Confirm", danger = false) =>
  new Promise<boolean>((resolve) => dialog.set({ d: { kind: "confirm", title, body, confirm, danger, resolve } }));

export function DialogHost() {
  const d = dialog.use((s) => s.d);
  const [val, setVal] = useState("");
  useEffect(() => { if (d?.kind === "text") setVal(d.initial); }, [d]);
  if (!d) return null;
  const close = (v: string | boolean | null) => {
    dialog.set({ d: null });
    (d.resolve as (v: string | boolean | null) => void)(d.kind === "text" ? (v as string | null) : !!v);
  };
  return (
    <div className="modal-backdrop" onMouseDown={() => close(d.kind === "text" ? null : false)}>
      <div className="popover dialog" role="dialog" aria-label={d.title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="popover-title">
          <div><p>{d.title}</p></div>
          <IconButton icon="close" label="Close" onClick={() => close(d.kind === "text" ? null : false)} />
        </div>
        {d.kind === "text" ? (
          <input
            className="text-input"
            autoFocus
            value={val}
            maxLength={80}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) close(val.trim()); if (e.key === "Escape") close(null); }}
          />
        ) : (
          <p className="dialog-body">{d.body}</p>
        )}
        <div className="dialog-actions">
          <button className="soft-button" onClick={() => close(d.kind === "text" ? null : false)}>Cancel</button>
          <button
            className={`primary-button ${d.kind === "confirm" && d.danger ? "danger" : ""}`}
            disabled={d.kind === "text" && !val.trim()}
            onClick={() => close(d.kind === "text" ? val.trim() : true)}
          >
            {d.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- toasts ---------------- */
export function Toasts() {
  const list = toasts.use((s) => s.list);
  if (!list.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {list.map((t) => (
        <div className="toast glass" key={t.id}>
          <Icon name="info" size={15} />
          <span>{t.text}</span>
          {t.action && (
            <button className="soft-button" onClick={() => { t.action!.run(); toasts.set((s) => ({ list: s.list.filter((x) => x.id !== t.id) })); }}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- lock screen ---------------- */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const fails = useRef(0);
  const submit = async () => {
    if (busy || !pw) return;
    setBusy(true);
    const ok = await verifyPassword(pw);
    if (ok) { fails.current = 0; setPw(""); setBusy(false); onUnlock(); return; }
    fails.current++;
    setBad(true);
    setPw("");
    window.setTimeout(() => setBad(false), 420);
    // gentle brute-force slowdown
    await new Promise((r) => setTimeout(r, Math.min(4000, 300 * fails.current ** 2)));
    setBusy(false);
  };
  return (
    <div className="onboarding lock-screen" role="dialog" aria-label="Mono is locked">
      <div className="onboard-visual">
        <div className="onboard-orbit o1" />
        <div className="onboard-orbit o2" />
        <Logo />
      </div>
      <section className={`onboard-card glass ${bad ? "shake" : ""}`}>
        <p className="eyebrow">LOCKED</p>
        <h1>Welcome back.</h1>
        <p>Enter your password to unlock Mono.</p>
        <input
          className={`text-input ${bad ? "invalid" : ""}`}
          type="password"
          autoFocus
          placeholder="Password"
          aria-label="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
        />
        <button className="primary-button wide" disabled={busy || !pw} onClick={() => void submit()}>
          {busy && !bad ? "Checking…" : "Unlock"} <Icon name="chevron" />
        </button>
        {bad && <p className="lock-error">Incorrect password.</p>}
      </section>
    </div>
  );
}
export { hasPassword };
