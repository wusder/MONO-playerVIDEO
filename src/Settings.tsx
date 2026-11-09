import { useState } from "react";
import { Icon, IconButton, ProgressSlider, Toggle, type IconName } from "./ui";
import { settings, update, restoreAppearanceDefaults, restoreAllDefaults, saveCustomWallpaper, clearCustomWallpaper, type Settings as S } from "./lib/settings";
import { WALLPAPERS, WP_CATS, type WpCat } from "./lib/wallpapers";
import { WallpaperArt } from "./components/Wallpaper";
import { clearPassword, hasPassword, setPassword, verifyPassword } from "./lib/security";
import { library, removeItems } from "./lib/library";
import { pickAnyFile } from "./lib/platform";
import { toast } from "./lib/store";
import { hasDeviceTranslator, TARGETS } from "./lib/translate";
import { askConfirm } from "./components/overlays";
import { openFolder } from "./actions";
import { openMenuBelow } from "./components/overlays";
import { setRate } from "./lib/engine";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export function SettingsSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="settings-section glass">
      <div className="settings-section-title">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}
function SettingSlider({ label, value, setValue, suffix = "%", display }: { label: string; value: number; setValue: (n: number) => void; suffix?: string; display?: (v: number) => string }) {
  return (
    <div className="setting-slider">
      <span>{label}<b>{display ? display(value) : `${Math.round(value)}${suffix}`}</b></span>
      <ProgressSlider value={value} onChange={setValue} compact label={label} />
    </div>
  );
}
function SelectRow<T extends string | number>({ title, subtitle, value, options, onPick }: { title: string; subtitle?: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  const cur = options.find(([v]) => v === value)?.[1] ?? String(value);
  return (
    <button className="setting-row" onClick={(e) => openMenuBelow(e.currentTarget, options.map(([v, l]) => ({ label: l, checked: v === value, onClick: () => onPick(v) })))}>
      <span><b>{title}</b>{subtitle && <small>{subtitle}</small>}</span>
      <em>{cur}<Icon name="chevron" size={14} /></em>
    </button>
  );
}
function SwitchRow({ title, subtitle, value, setValue, disabled }: { title: string; subtitle: string; value: boolean; setValue: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`setting-row ${disabled ? "disabled" : ""}`}>
      <span><b>{title}</b><small>{subtitle}</small></span>
      <Toggle checked={value} onChange={(v) => !disabled && setValue(v)} label={title} />
    </div>
  );
}
function SegmentRow<T extends string>({ title, subtitle, value, options, onPick }: { title: string; subtitle: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="setting-row">
      <span><b>{title}</b><small>{subtitle}</small></span>
      <div className="text-segment">
        {options.map(([v, l]) => <button key={v} className={value === v ? "active" : ""} onClick={() => onPick(v)}>{l}</button>)}
      </div>
    </div>
  );
}

export const hotkeys = [
  ["Play / Pause", "Space", "Space", "Global playback"],
  ["Seek backward / forward", "← / →", "← / →", "Player (⇧ = 30 s)"],
  ["Volume up / down", "↑ / ↓", "↑ / ↓", "Player"],
  ["Previous / next", "P / N", "P / N", "Player"],
  ["Subtitles", "S", "S", "Video"],
  ["Quality / details", "Q", "Q", "Player"],
  ["Speed", "[ / ]", "[ / ]", "Player"],
  ["Open file", "Ctrl O", "⌘ O", "Global"],
  ["Open folder", "Ctrl ⇧ O", "⌘ ⇧ O", "Library"],
  ["Search", "Ctrl F", "⌘ F", "Library"],
  ["Mute", "M", "M", "Player"],
  ["Fullscreen", "F", "F", "Video"],
  ["Close / Exit fullscreen", "Esc", "Esc", "Context"],
  ["Settings", "Ctrl ,", "⌘ ,", "Global"],
];
export function HotkeyTable({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`hotkey-table ${compact ? "compact" : ""}`}>
      <div className="table-head"><span>Action</span><span>Windows</span><span>macOS</span><span>Context</span></div>
      {hotkeys.map((r) => (
        <div key={r[0]}><span>{r[0]}</span><kbd>{r[1]}</kbd><kbd>{r[2]}</kbd><small>{r[3]}</small></div>
      ))}
    </div>
  );
}

function GlassPreview() {
  return (
    <div className="glass-preview" aria-hidden="true">
      <div className="gp-backdrop"><i /><i /><i /></div>
      <div className="gp-card glass">
        <span className="gp-cover" />
        <span className="gp-text"><b>Preview</b><small>Blur, opacity and depth update live</small></span>
        <ProgressSlider value={42} readOnly compact />
      </div>
    </div>
  );
}

function Appearance() {
  const s = settings.use((x) => x);
  const set = (p: Partial<S>) => update(p);
  return (
    <>
      <SettingsSection title="Theme" description="One visual system, three expressions.">
        <div className="theme-options">
          {([["dark", "Dark Mono", "moon"], ["light", "Light Mono", "sun"], ["custom", "Custom", "sliders"]] as [S["theme"], string, IconName][]).map(([id, label, icon]) => (
            <button key={id} className={s.theme === id ? "selected" : ""} onClick={() => set({ theme: id })}>
              <span className={`theme-preview ${id}`} style={id === "custom" ? { background: `linear-gradient(135deg, hsl(0 0% ${s.customTone / 2.4}%), hsl(0 0% ${Math.min(95, s.customTone / 2.4 + 22)}%))` } : undefined}><i /><i /></span>
              <b><Icon name={icon} />{label}</b>
              {s.theme === id && <Icon name="check" />}
            </button>
          ))}
        </div>
        {s.theme === "custom" && (
          <>
            <SettingSlider label="Background tone" value={s.customTone} setValue={(v) => set({ customTone: v })} />
            <SettingSlider label="Text contrast" value={s.customContrast} setValue={(v) => set({ customContrast: v })} />
          </>
        )}
      </SettingsSection>

      <SettingsSection title="Mono Glass" description="Changes are applied to the interface instantly.">
        <GlassPreview />
        <SettingSlider label="Blur strength" value={s.blur} setValue={(v) => set({ blur: v })} />
        <SettingSlider label="Glass opacity" value={s.glassOpacity} setValue={(v) => set({ glassOpacity: v })} />
        <SettingSlider label="Border opacity" value={s.borderOpacity} setValue={(v) => set({ borderOpacity: v })} />
        <SettingSlider label="Highlight intensity" value={s.highlight} setValue={(v) => set({ highlight: v })} />
        <SettingSlider label="Shadow strength" value={s.shadow} setValue={(v) => set({ shadow: v })} />
        <SettingSlider label="Glass depth" value={s.depth} setValue={(v) => set({ depth: v })} />
        <SettingSlider label="Corner radius" value={s.radius} setValue={(v) => set({ radius: v })} />
        <SegmentRow title="Interface density" subtitle="Spacing and control sizing" value={s.density} options={[["comfortable", "Comfortable"], ["compact", "Compact"]]} onPick={(v) => set({ density: v })} />
      </SettingsSection>

      <SettingsSection title="Interface" description="Size, motion and effects.">
        <SettingSlider label="Interface size" value={((s.uiScale - 80) / 50) * 100} setValue={(v) => set({ uiScale: Math.round(80 + (v / 100) * 50) })} display={() => `${s.uiScale}%`} />
        <SettingSlider label="Sidebar opacity" value={s.sidebarOpacity} setValue={(v) => set({ sidebarOpacity: v })} />
        <SegmentRow title="Cover size" subtitle="Albums and videos per row" value={s.coverSize} options={[["small", "Small"], ["medium", "Medium"], ["large", "Large"]]} onPick={(v) => set({ coverSize: v })} />
        <SegmentRow title="Mini player" subtitle="Auto shows it while something is loaded" value={s.miniPlayer} options={[["auto", "Auto"], ["always", "Always"], ["hidden", "Hidden"]]} onPick={(v) => set({ miniPlayer: v })} />
        <SwitchRow title="Interface animations" subtitle="Springs, fades and hover motion" value={s.animations} setValue={(v) => set({ animations: v })} />
        <SwitchRow title="Reduced motion" subtitle="Removes movement, keeps simple fades" value={s.reducedMotion} setValue={(v) => set({ reducedMotion: v })} />
        <SwitchRow title="Reduced effects" subtitle="Turns off blur and animated wallpapers to save GPU" value={s.reducedEffects} setValue={(v) => set({ reducedEffects: v })} />
        <div className="setting-actions">
          <button className="soft-button" onClick={() => { restoreAppearanceDefaults(); toast("Appearance reset to defaults"); }}><Icon name="repeat" /> Reset to Default</button>
          <small className="saved-note"><Icon name="check" size={13} /> Saved automatically on this device</small>
        </div>
      </SettingsSection>
    </>
  );
}

function Playback() {
  const s = settings.use((x) => x);
  const set = (p: Partial<S>) => update(p);
  const tOptions = TARGETS as [string, string][];
  return (
    <>
      <SettingsSection title="Playback" description="Defaults for audio and video.">
        <SelectRow title="Default playback speed" value={s.defaultSpeed} options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => [v, `${v}×`] as [number, string])} onPick={(v) => { set({ defaultSpeed: v }); setRate(v); }} />
        <SelectRow title="Subtitle language" subtitle="Used when a file offers several tracks" value={s.subtitleLang} options={[["auto", "Automatic"], ["off", "Off"], ["en", "English"], ["ru", "Russian"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["ja", "Japanese"]]} onPick={(v) => set({ subtitleLang: v })} />
        <SegmentRow title="Video scaling" subtitle="Fit keeps the whole frame, Fill crops to the window" value={s.videoFit} options={[["contain", "Fit"], ["cover", "Fill"]]} onPick={(v) => set({ videoFit: v })} />
        <SwitchRow title="Remember playback position" subtitle="Resume where you left off" value={s.rememberPosition} setValue={(v) => set({ rememberPosition: v })} />
        <SwitchRow title="Auto play next" subtitle="Continue within the current collection" value={s.autoPlayNext} setValue={(v) => set({ autoPlayNext: v })} />
      </SettingsSection>
      <SettingsSection title="Translation & OCR" description="Used by “Translate this moment”. Nothing leaves your device unless you allow it.">
        <SegmentRow title="Translation engine" subtitle={hasDeviceTranslator() ? "On-device translation is available" : "On-device translation is not available in this engine"} value={s.translateProvider} options={[["device", "On-device"], ["endpoint", "Service"]]} onPick={(v) => set({ translateProvider: v })} />
        <SelectRow title="Translate into" value={s.translateTarget} options={tOptions} onPick={(v) => set({ translateTarget: v })} />
        {s.translateProvider === "endpoint" && (
          <>
            <label className="field-row"><b>Service URL</b><small>LibreTranslate-compatible, e.g. https://host/translate</small>
              <input className="text-input" value={s.translateEndpoint} placeholder="https://" onChange={(e) => set({ translateEndpoint: e.target.value.trim() })} /></label>
            <label className="field-row"><b>API key (optional)</b>
              <input className="text-input" type="password" value={s.translateApiKey} onChange={(e) => set({ translateApiKey: e.target.value })} /></label>
            <SwitchRow title="Allow sending text to this service" subtitle="Subtitle text is sent only when you press Translate" value={s.translateConsent} setValue={(v) => set({ translateConsent: v })} />
          </>
        )}
        <SelectRow title="OCR language" value={s.ocrLang} options={[["eng", "English"], ["rus", "Russian"], ["deu", "German"], ["fra", "French"], ["spa", "Spanish"], ["jpn", "Japanese"], ["chi_sim", "Chinese (Simplified)"]]} onPick={(v) => set({ ocrLang: v })} />
        <SwitchRow title="Enable Tesseract OCR" subtitle="Downloads recognition data from a CDN the first time you use it" value={s.ocrConsent} setValue={(v) => set({ ocrConsent: v })} />
      </SettingsSection>
    </>
  );
}

function Security() {
  const s = settings.use((x) => x);
  const [has, setHas] = useState(hasPassword());
  const [mode, setMode] = useState<"" | "set" | "off">("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const reset = () => { setMode(""); setPw(""); setPw2(""); setErr(""); };
  const save = async () => {
    if (pw.length < 4) return setErr("Use at least 4 characters.");
    if (pw !== pw2) return setErr("The passwords do not match.");
    await setPassword(pw); setHas(true); reset(); toast("Password protection enabled");
  };
  const disable = async () => {
    if (!(await verifyPassword(pw))) return setErr("Incorrect password.");
    clearPassword(); setHas(false); reset(); toast("Password protection disabled");
  };
  return (
    <SettingsSection title="Security" description="Protection is optional and local to this device.">
      <SwitchRow title="Password protection" subtitle="Lock Mono when you are away" value={has || mode === "set"} setValue={(v) => { if (v && !has) setMode("set"); else if (!v && has) setMode("off"); else reset(); }} />
      {mode === "set" && (
        <div className="pw-fields">
          <input className="text-input" type="password" autoFocus placeholder="New password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} aria-label="New password" />
          <input className="text-input" type="password" placeholder="Repeat password" value={pw2} onChange={(e) => { setPw2(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && void save()} aria-label="Repeat password" />
          {err && <p className="lock-error">{err}</p>}
          <div className="dialog-actions"><button className="soft-button" onClick={reset}>Cancel</button><button className="primary-button" onClick={() => void save()}>Enable</button></div>
        </div>
      )}
      {mode === "off" && (
        <div className="pw-fields">
          <input className="text-input" type="password" autoFocus placeholder="Current password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && void disable()} aria-label="Current password" />
          {err && <p className="lock-error">{err}</p>}
          <div className="dialog-actions"><button className="soft-button" onClick={reset}>Cancel</button><button className="primary-button" onClick={() => void disable()}>Disable protection</button></div>
        </div>
      )}
      <SelectRow title="Auto lock" subtitle="After no interaction" value={has ? s.autoLockMinutes : 0} options={has ? [[0, "Disabled"], [1, "After 1 minute"], [5, "After 5 minutes"], [15, "After 15 minutes"], [30, "After 30 minutes"], [60, "After 1 hour"]] : [[0, "Disabled"]]} onPick={(v) => update({ autoLockMinutes: v })} />
      <SwitchRow title="Lock when minimized" subtitle="Requires password protection" value={has && s.lockOnMinimize} disabled={!has} setValue={(v) => update({ lockOnMinimize: v })} />
      {has && <div className="setting-actions"><button className="soft-button" onClick={() => window.dispatchEvent(new Event("mono:lock"))}><Icon name="lock" /> Lock now</button></div>}
      <div className="native-note">
        <Icon name="lock" />
        <span>
          <b>How your password is stored</b>
          <small>Only a salted PBKDF2-SHA256 hash is saved on this device, never the password itself. Windows Hello / Touch ID are not part of this build.</small>
        </span>
      </div>
    </SettingsSection>
  );
}

function Wallpapers() {
  const s = settings.use((x) => x);
  const [cat, setCat] = useState<WpCat>(() => (s.wallpaper.kind === "preset" ? WALLPAPERS.find((w) => w.id === (s.wallpaper as { id: string }).id)?.cat ?? "Minimal" : "Minimal"));
  const [preview, setPreview] = useState<string>(s.wallpaper.kind === "preset" ? s.wallpaper.id : "aurora");
  const list = WALLPAPERS.filter((w) => w.cat === cat);
  const pv = WALLPAPERS.find((w) => w.id === preview);
  const applied = s.wallpaper.kind === "preset" && s.wallpaper.id === preview;
  const animated = s.wallpaperAnimated && !s.reducedEffects && !s.reducedMotion;
  const custom = async (kind: "image" | "video") => {
    const f = await pickAnyFile(kind === "image" ? ["jpg", "jpeg", "png", "webp", "avif", "gif"] : ["mp4", "webm", "mov", "m4v"], kind === "image" ? "Images" : "Videos");
    if (!f) return;
    if (f.size > 400 * 1024 * 1024) return toast("That file is too large for a wallpaper (400 MB max).");
    if (await saveCustomWallpaper(kind, f, f.name)) toast(`${kind === "image" ? "Image" : "Video"} wallpaper applied`);
    else toast("Could not store the wallpaper on this device.");
  };
  return (
    <>
      <SettingsSection title="Wallpapers" description="Monochrome scenes behind every glass surface.">
        <div className="text-segment wp-cats" role="tablist">
          {WP_CATS.map((c) => <button key={c} className={cat === c ? "active" : ""} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <div className="wallpaper-grid">
          {list.map((w) => {
            const active = s.wallpaper.kind === "preset" && s.wallpaper.id === w.id;
            return (
              <button key={w.id} className={preview === w.id ? "selected" : ""} onClick={() => setPreview(w.id)} aria-label={w.name}>
                <span className={`wp-thumb ${w.follow ? "default" : ""}`} style={w.follow ? undefined : { background: w.bg }}>
                  {w.live && <i className="live-badge">LIVE</i>}
                </span>
                <span>{w.name}</span>
                {active && <Icon name="check" />}
              </button>
            );
          })}
        </div>
        {pv && (
          <div className="wp-preview">
            <div className="wp-preview-stage">
              <div className={`wallpaper preview ${pv.follow ? "" : "wp-custom"} ${animated ? "" : "wp-static"}`}>
                {!pv.follow && <div className="wp-inner"><WallpaperArt wp={{ kind: "preset", id: pv.id }} animated={animated} /></div>}
              </div>
              <div className="gp-card glass"><span className="gp-cover" /><span className="gp-text"><b>{pv.name}</b><small>{pv.cat}{pv.live ? " · live" : ""}</small></span></div>
            </div>
            <div className="wp-preview-actions">
              <button className="primary-button" disabled={applied} onClick={() => { update({ wallpaper: { kind: "preset", id: pv.id } }); toast(`${pv.name} applied`); }}>{applied ? "Applied" : "Apply"}</button>
              <button className="soft-button" disabled={s.wallpaper.kind === "none"} onClick={() => { update({ wallpaper: { kind: "none" } }); void clearCustomWallpaper(); toast("Wallpaper removed"); }}><Icon name="close" /> Remove</button>
            </div>
          </div>
        )}
        <div className="setting-actions">
          <button className="soft-button" onClick={() => void custom("image")}><Icon name="image" /> Custom image…</button>
          <button className="soft-button" onClick={() => void custom("video")}><Icon name="video" /> Custom video…</button>
        </div>
        {(s.wallpaper.kind === "image" || s.wallpaper.kind === "video") && (
          <p className="prototype-note"><Icon name="info" size={14} /> Using your {s.wallpaper.kind}: {s.wallpaper.name}</p>
        )}
        <SettingSlider label="Wallpaper blur" value={s.wallpaperBlur} setValue={(v) => update({ wallpaperBlur: v })} />
        <SettingSlider label="Wallpaper dimming" value={s.wallpaperDim} setValue={(v) => update({ wallpaperDim: v })} />
      </SettingsSection>
      <SettingsSection title="Energy saving">
        <SwitchRow title="Disable animated wallpapers" subtitle="Use a still frame to reduce GPU usage" value={!s.wallpaperAnimated} setValue={(v) => update({ wallpaperAnimated: !v })} />
      </SettingsSection>
    </>
  );
}

function LibraryTab({ onReplayOnboarding }: { onReplayOnboarding: () => void }) {
  const count = library.use((s) => s.items.length);
  const lists = library.use((s) => s.playlists.length);
  return (
    <SettingsSection title="Library & data" description="Everything is stored locally on this device.">
      <div className="setting-row"><span><b>Library</b><small>{count} items · {lists} playlists</small></span>
        <button className="soft-button" onClick={() => void openFolder()}><Icon name="folder" /> Add folder</button></div>
      <div className="setting-row"><span><b>Clear library</b><small>Removes the records only. Your files are never deleted.</small></span>
        <button className="soft-button" disabled={!count} onClick={async () => { if (await askConfirm("Clear the library?", "All items and playlists are removed from Mono. Files on your computer are not touched.", "Clear library", true)) await removeItems(library.get().items.map((i) => i.id)); }}><Icon name="trash" /> Clear</button></div>
      <div className="setting-row"><span><b>Welcome tour</b><small>Show the first-launch screens again</small></span>
        <button className="soft-button" onClick={onReplayOnboarding}>Replay</button></div>
      <div className="setting-row"><span><b>Restore all defaults</b><small>Resets every setting. Library and password stay.</small></span>
        <button className="soft-button" onClick={async () => { if (await askConfirm("Restore all defaults?", "Appearance, playback and mixer settings return to their defaults.", "Restore")) { restoreAllDefaults(); toast("Defaults restored"); } }}>Restore</button></div>
    </SettingsSection>
  );
}

const TABS: [string, IconName][] = [["Appearance", "spark"], ["Playback", "play"], ["Security", "lock"], ["Wallpapers", "layers"], ["Library", "folder"], ["Hotkeys", "command"]];
export function Settings({ onReplayOnboarding }: { onReplayOnboarding: () => void }) {
  const [tab, setTab] = useState("Appearance");
  void isMac; void IconButton;
  return (
    <main className="content settings-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MONO PLAYER</p>
          <h1>Settings</h1>
          <p>Make the player feel entirely yours.</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav glass">
          {TABS.map(([t, icon]) => (
            <button className={tab === t ? "active" : ""} onClick={() => setTab(t)} key={t}><Icon name={icon} />{t}</button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "Appearance" && <Appearance />}
          {tab === "Playback" && <Playback />}
          {tab === "Security" && <Security />}
          {tab === "Wallpapers" && <Wallpapers />}
          {tab === "Library" && <LibraryTab onReplayOnboarding={onReplayOnboarding} />}
          {tab === "Hotkeys" && <HotkeyTable compact />}
        </div>
      </div>
    </main>
  );
}
