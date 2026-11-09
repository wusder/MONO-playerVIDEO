import { useEffect, useState } from "react";
import { settings, loadCustomWallpaper, type WallpaperRef } from "../lib/settings";
import { FOG_TILE, wpById } from "../lib/wallpapers";

function LiveLayers({ kind }: { kind: "aurora" | "fog" | "liquid" | "orbit" }) {
  if (kind === "fog")
    return (
      <>
        {[0, 1, 2].map((i) => (
          <i key={i} className={`fog-layer fl${i}`} style={{ backgroundImage: FOG_TILE }} />
        ))}
      </>
    );
  if (kind === "liquid")
    return (
      <>
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={`blob b${i}`} />
        ))}
      </>
    );
  if (kind === "orbit")
    return (
      <>
        <i className="ring r1" />
        <i className="ring r2" />
        <i className="ring r3" />
      </>
    );
  return null;
}

/** Renders a wallpaper reference. `animated` freezes live wallpapers when false. */
export function WallpaperArt({ wp, animated, blob }: { wp: WallpaperRef; animated: boolean; blob?: string }) {
  if (wp.kind === "image" && blob) return <img className="wp-media" src={blob} alt="" draggable={false} />;
  if (wp.kind === "video" && blob)
    return animated ? (
      <video className="wp-media" src={blob} autoPlay muted loop playsInline />
    ) : (
      <video className="wp-media" src={blob} muted playsInline preload="metadata" />
    );
  if (wp.kind === "preset") {
    const p = wpById(wp.id);
    if (!p || p.follow) return null;
    return (
      <div className={`wp-art ${p.live ? `live-${p.live}` : ""}`} style={{ background: p.bg }}>
        {p.live && <LiveLayers kind={p.live} />}
      </div>
    );
  }
  return null;
}

export function useCustomWallpaperUrl(wp: WallpaperRef): string | undefined {
  const [url, setUrl] = useState<string>();
  const key = wp.kind === "image" || wp.kind === "video" ? wp.name : "";
  useEffect(() => {
    let made: string | undefined;
    let alive = true;
    setUrl(undefined);
    if (wp.kind === "image" || wp.kind === "video")
      loadCustomWallpaper().then((b) => {
        if (b && alive) { made = URL.createObjectURL(b); setUrl(made); }
      });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wp.kind, key]);
  return url;
}

export function WallpaperLayer() {
  const wp = settings.use((s) => s.wallpaper);
  const animated = settings.use((s) => s.wallpaperAnimated && !s.reducedEffects && !s.reducedMotion);
  const url = useCustomWallpaperUrl(wp);
  const isDefault = wp.kind === "preset" && !!wpById(wp.id)?.follow;
  const flat = wp.kind === "none";
  return (
    <div className={`wallpaper ${flat ? "wp-flat" : isDefault ? "" : "wp-custom"} ${animated ? "" : "wp-static"}`} aria-hidden="true">
      {!isDefault && !flat && (
        <div className="wp-inner">
          <WallpaperArt wp={wp} animated={animated} blob={url} />
        </div>
      )}
      <div className="wp-dim" />
    </div>
  );
}
