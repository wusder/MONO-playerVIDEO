import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { fmtTime } from "./lib/store";

export type IconName =
  | "home"
  | "music"
  | "video"
  | "playlist"
  | "settings"
  | "search"
  | "grid"
  | "list"
  | "plus"
  | "more"
  | "play"
  | "pause"
  | "next"
  | "prev"
  | "volume"
  | "heart"
  | "shuffle"
  | "repeat"
  | "expand"
  | "captions"
  | "gauge"
  | "layers"
  | "chevron"
  | "lock"
  | "folder"
  | "sun"
  | "moon"
  | "sliders"
  | "copy"
  | "translate"
  | "close"
  | "check"
  | "rain"
  | "fire"
  | "tree"
  | "coffee"
  | "wind"
  | "spark"
  | "upload"
  | "panel"
  | "command"
  | "info"
  | "mute"
  | "trash"
  | "edit"
  | "image"
  | "queue"
  | "up"
  | "down"
  | "download";

export const paths: Record<IconName, React.ReactNode> = {
  home: (
    <>
      <path d="M3 10.8 12 3l9 7.8" />
      <path d="M5.5 9.3V21h13V9.3M9 21v-7h6v7" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m10 9 5 3-5 3Z" />
    </>
  ),
  playlist: (
    <>
      <path d="M4 6h10M4 11h10M4 16h7" />
      <path d="M18 12v8M15 15h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.1A1.7 1.7 0 0 0 4.7 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.5 4.7a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.38.3.6.76.6 1.25v3.5c0 .49-.22.95-.6 1.25Z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r=".8" fill="currentColor" />
      <circle cx="4.5" cy="12" r=".8" fill="currentColor" />
      <circle cx="4.5" cy="18" r=".8" fill="currentColor" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7Z" />,
  pause: (
    <>
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  next: (
    <>
      <path d="m6 5 9 7-9 7Z" />
      <path d="M18 5v14" />
    </>
  ),
  prev: (
    <>
      <path d="m18 5-9 7 9 7Z" />
      <path d="M6 5v14" />
    </>
  ),
  volume: (
    <>
      <path d="M5 10v4h4l5 4V6L9 10Z" />
      <path d="M17 9a5 5 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  heart: (
    <path d="M20.8 5.8a5.5 5.5 0 0 0-7.8 0L12 6.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 22l7.8-7.3 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
  ),
  shuffle: (
    <>
      <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M14.5 14.5 21 21M4 4l5 5" />
    </>
  ),
  repeat: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </>
  ),
  expand: (
    <>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </>
  ),
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M10 10a2 2 0 1 0 0 4M17 10a2 2 0 1 0 0 4" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 18a9 9 0 1 1 16 0" />
      <path d="m12 15 4-5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 2 9 5-9 5-9-5Z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  folder: <path d="M3 6h7l2 2h9v11H3Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />,
  sliders: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V4H4v12h4" />
    </>
  ),
  translate: (
    <>
      <path d="M4 5h8M8 3v2M6 5c0 4 2 7 6 9M11 5c0 4-2 7-6 9M14 20l4-9 4 9M15.5 17h5" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4L19 6" />,
  rain: (
    <>
      <path d="M7 16a4 4 0 1 1 1-7.9A5 5 0 0 1 18 9a3.5 3.5 0 0 1-1 7H7Z" />
      <path d="m8 19-1 2M13 19l-1 2M18 19l-1 2" />
    </>
  ),
  fire: (
    <path d="M12 22c4 0 7-3 7-7 0-5-4-8-7-13 0 5-7 6-7 13 0 4 3 7 7 7Zm0-2c-2 0-3.5-1.5-3.5-3.5 0-2 2-3.5 3.5-5.5.2 2 3.5 3 3.5 5.5S14 20 12 20Z" />
  ),
  tree: (
    <>
      <path d="m12 3-5 7h3l-5 7h14l-5-7h3Z" />
      <path d="M12 17v5" />
    </>
  ),
  coffee: (
    <>
      <path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z" />
      <path d="M17 10h2a3 3 0 0 1 0 6h-2M7 4v2M11 3v3M15 4v2" />
    </>
  ),
  wind: (
    <>
      <path d="M3 8h12a3 3 0 1 0-3-3M3 12h16M3 16h11a3 3 0 1 1-3 3" />
    </>
  ),
  spark: <path d="m12 2 1.5 6.5L20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5Z" />,
  upload: (
    <>
      <path d="M12 16V4m0 0L7 9m5-5 5 5" />
      <path d="M4 15v5h16v-5" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </>
  ),
  command: (
    <>
      <path d="M9 6v12M15 6v12M6 9h12M6 15h12" />
      <path d="M9 6H7a3 3 0 1 0 0 6h10a3 3 0 1 0 0-6h-2M9 18H7a3 3 0 1 1 0-6h10a3 3 0 1 1 0 6h-2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  mute: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4Z" />
      <path d="m16 9 5 6M21 9l-5 6" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 18 5-5 4 4 3-3 4 4" />
    </>
  ),
  queue: (
    <>
      <path d="M4 6h12M4 11h12M4 16h7" />
      <path d="m16 14 5 3-5 3Z" />
    </>
  ),
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  download: (
    <>
      <path d="M12 4v11M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="logo-lockup">
      <span className="logo-mark">
        <i />
        <i />
        <i />
      </span>
      {!compact && <strong>Mono</strong>}
    </div>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  className = "",
}: {
  icon: IconName;
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-tip={label}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function ProgressSlider({
  value,
  onChange,
  onCommit,
  buffer,
  compact = false,
  label = "Progress",
  duration,
  readOnly = false,
  live = true,
  step = 2,
}: {
  value: number;
  /** Called continuously while dragging (and on keys) when `live` is true. */
  onChange?: (v: number) => void;
  /** Called once when the user releases the pointer / presses a key. */
  onCommit?: (v: number) => void;
  buffer?: number;
  compact?: boolean;
  label?: string;
  /** When set (seconds), previews and the scrub bubble show real times instead of percentages. */
  duration?: number;
  readOnly?: boolean;
  live?: boolean;
  step?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const pct = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(100, ((event.clientX - rect.left - 8) / (rect.width - 16)) * 100));
  };
  const shown = drag ?? value;
  const fmt = (v: number) => (duration ? fmtTime((v / 100) * duration) : `${Math.round(v)}%`);
  const keyMove = (v: number) => {
    const nv = Math.max(0, Math.min(100, v));
    onChange?.(nv);
    onCommit?.(nv);
  };
  return (
    <div
      ref={ref}
      className={`progress-slider ${compact ? "compact" : ""} ${drag !== null ? "scrubbing" : ""} ${readOnly ? "readonly" : ""}`}
      style={{ "--value": shown, "--buffer": buffer ?? shown } as React.CSSProperties}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={duration ? fmt(shown) : undefined}
      aria-readonly={readOnly || undefined}
      tabIndex={readOnly ? -1 : 0}
      onKeyDown={(e) => {
        if (readOnly) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); keyMove(value - step); }
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); keyMove(value + step); }
        if (e.key === "Home") keyMove(0);
        if (e.key === "End") keyMove(100);
      }}
      onPointerDown={(e) => {
        if (readOnly) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = pct(e);
        setDrag(v);
        if (live) onChange?.(v);
      }}
      onPointerMove={(e) => {
        if (readOnly) return;
        const v = pct(e);
        if (drag !== null) {
          setDrag(v);
          if (live) onChange?.(v);
        } else setHover(v);
      }}
      onPointerUp={(e) => {
        if (readOnly || drag === null) return;
        const v = pct(e);
        setDrag(null);
        if (!live) onChange?.(v);
        onCommit?.(v);
      }}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => {
        if (drag === null) setHover(null);
      }}
      onClick={(e) => { if (!readOnly) e.stopPropagation(); }}
    >
      <div className="slider-track">
        <span className="slider-buffer" />
        <span className="slider-fill" />
      </div>
      <span className="slider-thumb" />
      {hover !== null && drag === null && !readOnly && (
        <span className="slider-preview" style={{ left: `calc(8px + (100% - 16px) * ${hover / 100})` }}>
          {fmt(hover)}
        </span>
      )}
      {drag !== null && <span className="slider-bubble">{fmt(drag)}</span>}
    </div>
  );
}
