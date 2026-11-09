import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, IconButton, Logo, ProgressSlider, Toggle, type IconName } from "./ui";
import type { Popover, Screen } from "./types";
import { fmtBytes, fmtTime, toast } from "./lib/store";
import { settings, update, applyToDocument } from "./lib/settings";
import {
  type Album, type Item, buildAlbums, deletePlaylist, importPicked, removeItems, library, initLibrary,
  movePlaylistItem, qualityInfo, removeFromPlaylist, renamePlaylist, sortItems, toggleFavorite,
} from "./lib/library";
import {
  media, player, setNavigator, playIds, playOne, toggle, play, pause, seek, seekBy, seekPct, next, prev, setVolume, toggleMute,
  setRate, toggleShuffle, cycleRepeat, enqueue, removeFromQueue, moveInQueue, clearQueue, jumpTo, setSubtitle, setAudioTrack,
  loadSubtitleFile, togglePip, supportsAudioTracks, initEngine,
} from "./lib/engine";
import { BUILTIN, addCustomSound, initMixer, mixerState, removeCustomSound, setBalance, setSound, setSoundVolume, toggleSoundMute } from "./lib/mixer";
import { hasPassword, setPassword } from "./lib/security";
import {
  isTauri, onNativeDrop, pickFolder, pickSubtitleFile, pickedFromDataTransfer, setFullscreen as setNativeFullscreen, windowControls,
} from "./lib/platform";
import { LANG_NAMES } from "./lib/subtitles";
import { TARGETS, ocr, translate } from "./lib/translate";
import { WallpaperLayer } from "./components/Wallpaper";
import { ContextMenu, DialogHost, LockScreen, Toasts, askConfirm, askText, openMenuBelow, openMenuFromEvent } from "./components/overlays";
import { handlePicked, itemMenu, locateItem, newPlaylistWith, openFiles, openFolder } from "./actions";
import { HotkeyTable, Settings, SettingsSection } from "./Settings";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

const nav: { id: Screen; label: string; icon: IconName }[] = [
  { id: "home", label: "Library", icon: "home" },
  { id: "music", label: "Music", icon: "music" },
  { id: "video", label: "Video", icon: "video" },
  { id: "playlists", label: "Playlists", icon: "playlist" },
  { id: "settings", label: "Settings", icon: "settings" },
];

/* ---------- small shared pieces ---------- */
function Cover({ src, kind = "audio" }: { src?: string; kind?: "audio" | "video" }) {
  return src ? <img src={src} alt="" loading="lazy" draggable={false} /> : (
    <span className="cover-ph"><Icon name={kind === "video" ? "video" : "music"} size={28} /></span>
  );
}
const itemSubtitle = (it: Item) => it.kind === "video" ? [it.height ? `${it.height}p` : "", it.duration ? fmtTime(it.duration) : ""].filter(Boolean).join(" · ") : [it.artist || "Unknown artist", it.album].filter(Boolean).join(" · ");
const greeting = () => { const h = new Date().getHours(); return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

function WindowChrome() {
  return (
    <header className="window-chrome" data-tauri-drag-region>
      <div className="traffic">
        <button aria-label="Close" onClick={() => void windowControls.close()} disabled={!isTauri} />
        <button aria-label="Minimize" onClick={() => void windowControls.minimize()} disabled={!isTauri} />
        <button aria-label="Maximize" onClick={() => void windowControls.toggleMaximize()} />
      </div>
      <span className="window-title" data-tauri-drag-region>MONO PLAYER</span>
      <div className="windows-actions">
        <button aria-label="Minimize" onClick={() => void windowControls.minimize()} disabled={!isTauri}>—</button>
        <button aria-label="Maximize" onClick={() => void windowControls.toggleMaximize()}>□</button>
        <button aria-label="Close" onClick={() => void windowControls.close()} disabled={!isTauri}>×</button>
      </div>
    </header>
  );
}

function Sidebar({ screen, setScreen }: { screen: Screen; setScreen: (s: Screen) => void }) {
  const collapsed = settings.use((s) => s.sidebarCollapsed);
  const curId = player.use((s) => s.currentId);
  const cur = library.use((s) => s.items.find((i) => i.id === curId));
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-brand">
        <div className="logo-lockup"><Logo compact={collapsed} /></div>
        <IconButton icon="panel" label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => update({ sidebarCollapsed: !collapsed })} />
      </div>
      <nav>
        {nav.map((item) => (
          <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => setScreen(item.id)} data-tip={collapsed ? item.label : undefined}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        {!collapsed && cur && (
          <>
            <p>NOW PLAYING</p>
            <button className="side-track" onClick={() => setScreen(cur.kind === "video" ? "video" : "music")}>
              {cur.cover ? <img src={cur.cover} alt="" /> : <span className="side-ph"><Icon name="music" size={16} /></span>}
              <span>
                <strong>{cur.title}</strong>
                <small>{cur.kind === "video" ? "Video" : cur.artist || "Unknown artist"}</small>
              </span>
            </button>
          </>
        )}
        <button className="nav-specs" onClick={() => setScreen("specs")} data-tip={collapsed ? "Product specs" : undefined}>
          <Icon name="command" />
          {!collapsed && <span>Product specs</span>}
        </button>
      </div>
    </aside>
  );
}

/* ---------- library ---------- */
type Filter = "all" | "music" | "video" | "favorites" | "recent";
const FILTERS: [Filter, string][] = [["all", "All"], ["music", "Music"], ["video", "Video"], ["favorites", "Favorites"], ["recent", "Recent"]];
const SORTS: [typeof settings extends never ? never : "added" | "title" | "artist" | "year", string][] = [["added", "Recently added"], ["title", "Title"], ["artist", "Artist"], ["year", "Year"]];

function Toolbar({ search, setSearch }: { search: string; setSearch: (s: string) => void }) {
  const grid = settings.use((s) => s.grid);
  const sort = settings.use((s) => s.sort);
  return (
    <div className="toolbar glass">
      <label className="search">
        <Icon name="search" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your library" aria-label="Search library" />
        {search && (
          <button onClick={() => setSearch("")} aria-label="Clear search"><Icon name="close" size={14} /></button>
        )}
        <kbd>{MOD} F</kbd>
      </label>
      <div className="toolbar-actions">
        <div className="segmented">
          <IconButton icon="grid" label="Grid view" active={grid} onClick={() => update({ grid: true })} />
          <IconButton icon="list" label="List view" active={!grid} onClick={() => update({ grid: false })} />
        </div>
        <button
          className="soft-button"
          onClick={(e) => openMenuBelow(e.currentTarget, SORTS.map(([id, label]) => ({ label, checked: sort === id, onClick: () => update({ sort: id }) })))}
        >
          <Icon name="sliders" /> <span>Sort</span>
        </button>
        <button
          className="primary-button"
          onClick={(e) => openMenuBelow(e.currentTarget, [
            { label: "Open files…", icon: "music", onClick: () => void openFiles() },
            { label: "Add folder to library…", icon: "folder", onClick: () => void openFolder() },
          ])}
        >
          <Icon name="plus" /> <span>Add files</span>
        </button>
      </div>
    </div>
  );
}

function AlbumCard({ album, grid }: { album: Album; grid: boolean }) {
  const items = library.use((s) => s.items);
  const play1 = () => void playIds(album.ids, 0);
  const menuItems = (): import("./components/overlays").MenuItem[] => [
    { label: "Play album", icon: "play", onClick: play1 },
    { label: "Play next", icon: "queue", onClick: () => enqueue(album.ids, true) },
    { label: "Add to queue", icon: "plus", onClick: () => enqueue(album.ids) },
    { label: "Add to new playlist…", icon: "playlist", onClick: () => void newPlaylistWith(album.ids) },
    { separator: true, label: "" },
    { label: "Remove from library", icon: "trash", danger: true, onClick: async () => {
        if (await askConfirm("Remove album from library?", `${album.ids.length} track(s) will be removed from Mono. Files on your computer are not deleted.`, "Remove", true)) {
          await removeItems(album.ids);
        }
      } },
  ];
  const menu = (e: React.MouseEvent) => openMenuFromEvent(e, menuItems());
  void items;
  return (
    <article className="album-card" onDoubleClick={play1} onContextMenu={menu} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") play1(); }}>
      <div className="cover">
        <Cover src={album.cover} />
        <button onClick={play1} aria-label={`Play ${album.album}`}><Icon name="play" size={22} /></button>
        <IconButton icon="more" label="Album menu" onClick={(e) => { e.stopPropagation(); openMenuBelow(e.currentTarget, menuItems()); }} />
      </div>
      <div>
        <strong>{album.album}</strong>
        <span>{album.artist}</span>
        <small>{album.ids.length} {album.ids.length === 1 ? "track" : "tracks"}{!grid && album.duration ? ` · ${fmtTime(album.duration)}` : ""}</small>
      </div>
    </article>
  );
}

function TrackRow({ item, context, index, playlistId, extra, draggable, onDragStart, onDrop }: {
  item: Item; context: string[]; index?: number; playlistId?: string; extra?: React.ReactNode;
  draggable?: boolean; onDragStart?: () => void; onDrop?: () => void;
}) {
  const curId = player.use((s) => s.currentId);
  const playing = player.use((s) => s.playing);
  const active = curId === item.id;
  const q = item.kind === "audio" ? qualityInfo(item) : null;
  return (
    <div
      className={`track-row ${active ? "active" : ""} ${item.missing ? "missing" : ""} ${!item.playable ? "unplayable" : ""}`}
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart?.(); }}
      onDragOver={(e) => { if (draggable) e.preventDefault(); }}
      onDrop={(e) => { if (draggable) { e.preventDefault(); e.stopPropagation(); onDrop?.(); } }}
      onClick={() => void playOne(item.id, context)}
      onKeyDown={(e) => { if (e.key === "Enter") void playOne(item.id, context); }}
      onContextMenu={(e) => openMenuFromEvent(e, itemMenu(item, { context, playlistId }))}
    >
      <span className="row-index">{active && playing ? <i className="playing-dot" /> : index !== undefined ? index + 1 : <Icon name={item.kind === "video" ? "video" : "music"} size={14} />}</span>
      <span className="row-cover"><Cover src={item.cover} kind={item.kind} /></span>
      <span className="row-meta">
        <strong>{item.title}</strong>
        <small>{itemSubtitle(item)}</small>
      </span>
      {item.missing && <em className="row-badge">MISSING</em>}
      {!item.missing && !item.playable && <em className="row-badge" data-tip="This format needs the native decoder">NO DECODER</em>}
      {q && item.playable && !item.missing && <em className="row-badge quiet">{q.tier}</em>}
      <span className="row-time">{item.duration ? fmtTime(item.duration) : "—"}</span>
      {extra}
      <IconButton icon="heart" label={item.favorite ? "Remove favorite" : "Favorite"} active={item.favorite} onClick={() => toggleFavorite(item.id)} className="row-btn" />
      <button className="icon-button row-btn" aria-label="More" onClick={(e) => { e.stopPropagation(); openMenuBelow(e.currentTarget, itemMenu(item, { context, playlistId })); }}>
        <Icon name="more" />
      </button>
    </div>
  );
}

function ImportBanner() {
  const imp = library.use((s) => s.importing);
  if (!imp) return null;
  return (
    <div className="import-banner glass" role="status">
      <i className="playing-dot" /> Importing {imp.done} / {imp.total}
      <span className="import-bar"><span style={{ width: `${(imp.done / imp.total) * 100}%` }} /></span>
    </div>
  );
}

function Home({ setScreen, search, setSearch }: { setScreen: (s: Screen) => void; search: string; setSearch: (s: string) => void }) {
  const items = library.use((s) => s.items);
  const playlists = library.use((s) => s.playlists);
  const loaded = library.use((s) => s.loaded);
  const grid = settings.use((s) => s.grid);
  const sort = settings.use((s) => s.sort);
  const [filter, setFilter] = useState<Filter>("all");
  const [more, setMore] = useState(false);
  const q = search.trim().toLowerCase();

  const view = useMemo(() => {
    let list = items;
    if (q) list = list.filter((i) => `${i.title} ${i.artist} ${i.album} ${i.name}`.toLowerCase().includes(q));
    if (filter === "music") list = list.filter((i) => i.kind === "audio");
    if (filter === "video") list = list.filter((i) => i.kind === "video");
    if (filter === "favorites") list = list.filter((i) => i.favorite);
    if (filter === "recent") list = list.filter((i) => i.lastPlayed).sort((a, b) => b.lastPlayed! - a.lastPlayed!);
    else list = sortItems(list, sort);
    return list;
  }, [items, q, filter, sort]);
  const audio = view.filter((i) => i.kind === "audio");
  const videos = view.filter((i) => i.kind === "video");
  const albums = useMemo(() => buildAlbums(audio), [audio]);
  const flat = filter === "favorites" || filter === "recent" || !!q;

  const lastAudio = [...items].filter((i) => i.kind === "audio").sort((a, b) => (b.lastPlayed ?? b.addedAt) - (a.lastPlayed ?? a.addedAt))[0];
  const lastVideo = [...items].filter((i) => i.kind === "video").sort((a, b) => (b.lastPlayed ?? b.addedAt) - (a.lastPlayed ?? a.addedAt))[0];
  const favCount = items.filter((i) => i.favorite).length;
  const recentCount = items.filter((i) => i.lastPlayed).length;
  const ctxIds = (list: Item[]) => list.map((i) => i.id);

  return (
    <main className="content home-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">LOCAL LIBRARY · {items.length} {items.length === 1 ? "ITEM" : "ITEMS"}</p>
          <h1>{search ? "Search" : greeting()}</h1>
          <p>{search ? `${view.length} results for “${search}”` : "Everything you want to hear, in one quiet place."}</p>
        </div>
        <span className="sync-pill"><i /> Local only</span>
      </div>
      <Toolbar search={search} setSearch={setSearch} />
      <ImportBanner />
      {loaded && items.length > 0 && (
        <div className="filter-row">
          <div className="text-segment" role="tablist">
            {FILTERS.map(([id, label]) => (
              <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)} role="tab" aria-selected={filter === id}>{label}</button>
            ))}
          </div>
          {filter === "favorites" && <small>{favCount} favorites</small>}
          {filter === "recent" && <small>{recentCount} recently played</small>}
        </div>
      )}
      {loaded && items.length === 0 ? (
        <div className="empty-state glass">
          <span className="empty-icon"><Icon name="upload" size={30} /></span>
          <h2>Your library is empty</h2>
          <p>Open files or add a folder — or drop media anywhere in this window.</p>
          <div className="empty-actions">
            <button className="primary-button" onClick={() => void openFiles()}><Icon name="plus" /> Open files</button>
            <button className="soft-button" onClick={() => void openFolder()}><Icon name="folder" /> Add folder</button>
          </div>
          <small className="format-note">MP3 · FLAC · WAV · ALAC · DSD · MP4 · MKV · WebM</small>
        </div>
      ) : view.length === 0 ? (
        <div className="empty-state glass">
          <span className="empty-icon"><Icon name="search" size={30} /></span>
          <h2>Nothing found</h2>
          <p>{q ? "Try another title, artist, or album." : "Nothing here yet."}</p>
          {(q || filter !== "all") && <button className="soft-button" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</button>}
        </div>
      ) : (
        <>
          {!q && filter === "all" && (lastAudio || lastVideo) && (
            <section>
              <div className="section-heading">
                <h2>Recent</h2>
                <button onClick={() => setFilter("recent")}>See all <Icon name="chevron" size={14} /></button>
              </div>
              <div className="recent-grid" style={!lastAudio || !lastVideo ? { gridTemplateColumns: "1fr" } : undefined}>
                {lastAudio && (
                  <button className="recent-feature" onClick={() => void playOne(lastAudio.id, ctxIds(items.filter((i) => i.kind === "audio" && i.album === lastAudio.album)))}>
                    {lastAudio.cover ? <img src={lastAudio.cover} alt="" /> : <span className="feature-ph" />}
                    <span className="recent-overlay">
                      <i className="media-type">{lastAudio.album ? "ALBUM" : "TRACK"}</i>
                      <strong>{lastAudio.title}</strong>
                      <small>{lastAudio.artist || "Unknown artist"}{lastAudio.duration ? ` · ${fmtTime(lastAudio.duration)}` : ""}</small>
                    </span>
                    <span className="play-disc"><Icon name="play" /></span>
                  </button>
                )}
                {lastVideo && (
                  <button className="recent-video" onClick={() => void playOne(lastVideo.id, [lastVideo.id])}>
                    {lastVideo.cover ? <img src={lastVideo.cover} alt="" /> : <span className="feature-ph" />}
                    <span>
                      <i className="media-type">VIDEO</i>
                      <strong>{lastVideo.title}</strong>
                      <small>{lastVideo.position && lastVideo.position > 5 ? `Continue at ${fmtTime(lastVideo.position)}` : lastVideo.duration ? fmtTime(lastVideo.duration) : "Ready to play"}</small>
                      {lastVideo.position && lastVideo.duration ? <ProgressSlider value={(lastVideo.position / lastVideo.duration) * 100} compact readOnly label="Watched" /> : null}
                    </span>
                  </button>
                )}
              </div>
            </section>
          )}

          {!flat && albums.length > 0 && filter !== "video" && (
            <section>
              <div className="section-heading">
                <h2>Albums</h2>
                <button onClick={(e) => openMenuBelow(e.currentTarget, SORTS.map(([id, label]) => ({ label, checked: sort === id, onClick: () => update({ sort: id }) })))}>
                  {SORTS.find(([id]) => id === sort)![1]} <Icon name="chevron" size={14} />
                </button>
              </div>
              <div className={`album-grid ${!grid ? "list-view" : ""}`}>
                {albums.map((a) => <AlbumCard key={a.key} album={a} grid={grid} />)}
              </div>
            </section>
          )}

          {(flat ? view : audio).filter((i) => i.kind === "audio").length > 0 && (flat || filter !== "video") && (
            <section>
              <div className="section-heading"><h2>{flat ? "Results" : "Tracks"}</h2><span className="count-pill">{(flat ? view : audio).length}</span></div>
              <div className="track-list">
                {(flat ? view : audio).slice(0, more || flat ? undefined : 60).map((it, i) => (
                  <TrackRow key={it.id} item={it} index={i} context={ctxIds(flat ? view : audio)} />
                ))}
              </div>
              {!flat && audio.length > 60 && !more && <button className="soft-button show-more" onClick={() => setMore(true)}>Show all {audio.length} tracks</button>}
            </section>
          )}

          {!flat && videos.length > 0 && filter !== "music" && (
            <section>
              <div className="section-heading"><h2>Videos</h2><span className="count-pill">{videos.length}</span></div>
              <div className={`album-grid video-grid ${!grid ? "list-view" : ""}`}>
                {videos.map((v) => (
                  <article key={v.id} className={`album-card ${v.missing ? "missing" : ""}`} tabIndex={0}
                    onClick={() => void playOne(v.id, ctxIds(videos))} onKeyDown={(e) => { if (e.key === "Enter") void playOne(v.id, ctxIds(videos)); }}
                    onContextMenu={(e) => openMenuFromEvent(e, itemMenu(v, { context: ctxIds(videos) }))}>
                    <div className="cover wide">
                      <Cover src={v.cover} kind="video" />
                      <button aria-label={`Play ${v.title}`}><Icon name="play" size={22} /></button>
                      {v.position && v.duration ? <span className="cover-progress"><span style={{ width: `${(v.position / v.duration) * 100}%` }} /></span> : null}
                    </div>
                    <div>
                      <strong>{v.title}</strong>
                      <span>{v.missing ? "Missing file" : !v.playable ? "May need a different decoder" : itemSubtitle(v)}</span>
                      <small>{fmtBytes(v.size)}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {!q && filter === "all" && (
            <section>
              <div className="section-heading">
                <h2>Made for stillness</h2>
                <button onClick={() => setScreen("playlists")}>All playlists <Icon name="chevron" size={14} /></button>
              </div>
              <div className="playlist-row">
                {[{ id: "recent", name: "Recently Played", n: recentCount, icon: "repeat" as IconName },
                  { id: "fav", name: "Favorites", n: favCount, icon: "heart" as IconName },
                  ...playlists.slice(0, 2).map((p) => ({ id: p.id, name: p.name, n: p.items.length, icon: "playlist" as IconName }))].map((p, i) => (
                  <button key={p.id} onClick={() => setScreen("playlists")} className="playlist-tile">
                    <span className={`art-${i}`}><Icon name={p.icon} size={26} /></span>
                    <strong>{p.name}</strong>
                    <small>{p.n} {p.n === 1 ? "item" : "items"}</small>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

/* ---------- music player ---------- */
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const fmtRate = (r: number) => `${+r.toFixed(2)}×`;

function PlaybackCluster({ large = false }: { large?: boolean }) {
  const playing = player.use((s) => s.playing);
  const loading = player.use((s) => s.loading);
  const shuffle = settings.use((s) => s.shuffle);
  const repeat = settings.use((s) => s.repeat);
  return (
    <div className={`playback-cluster ${large ? "large" : ""}`}>
      <IconButton icon="shuffle" label={shuffle ? "Shuffle on" : "Shuffle off"} active={shuffle} onClick={toggleShuffle} />
      <IconButton icon="prev" label="Previous" onClick={() => void prev()} />
      <button className={`play-button ${loading ? "busy" : ""}`} onClick={() => toggle()} aria-label={playing ? "Pause" : "Play"}>
        <Icon name={playing ? "pause" : "play"} size={large ? 28 : 20} />
      </button>
      <IconButton icon="next" label="Next" onClick={() => void next()} />
      <span className="repeat-wrap">
        <IconButton icon="repeat" label={repeat === "off" ? "Repeat off" : repeat === "all" ? "Repeat all" : "Repeat one"} active={repeat !== "off"} onClick={cycleRepeat} />
        {repeat === "one" && <b className="repeat-one">1</b>}
      </span>
    </div>
  );
}

function EmptyPlayer({ kind, setScreen }: { kind: "audio" | "video"; setScreen: (s: Screen) => void }) {
  return (
    <main className="content empty-player">
      <div className="empty-state glass">
        <span className="empty-icon"><Icon name={kind === "video" ? "video" : "music"} size={30} /></span>
        <h2>{kind === "video" ? "No video playing" : "Nothing playing"}</h2>
        <p>Open a {kind === "video" ? "video" : "song"} from your computer, or pick something from the library.</p>
        <div className="empty-actions">
          <button className="primary-button" onClick={() => void openFiles()}><Icon name="plus" /> Open file</button>
          <button className="soft-button" onClick={() => setScreen("home")}><Icon name="home" /> Library</button>
        </div>
      </div>
    </main>
  );
}

function VolumeControl({ compact = false }: { compact?: boolean }) {
  const volume = settings.use((s) => s.volume);
  const muted = settings.use((s) => s.muted);
  const shown = muted ? 0 : volume * 100;
  return (
    <div className={compact ? "volume-control mini" : "volume-control"}>
      <button className="icon-button" aria-label={muted ? "Unmute" : "Mute"} data-tip={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
        <Icon name={muted || volume === 0 ? "mute" : "volume"} />
      </button>
      <ProgressSlider value={shown} onChange={(v) => setVolume(v / 100)} compact label="Volume" step={5} />
    </div>
  );
}

function MusicPlayer({ setPopover, setMixer, setScreen }: { setPopover: (p: Popover) => void; setMixer: (v: boolean) => void; setScreen: (s: Screen) => void }) {
  const curId = player.use((s) => s.currentId);
  const item = library.use((s) => s.items.find((i) => i.id === curId));
  const playing = player.use((s) => s.playing);
  const time = player.use((s) => s.time);
  const duration = player.use((s) => s.duration);
  const buffered = player.use((s) => s.buffered);
  const error = player.use((s) => s.error);
  const rate = player.use((s) => s.rate);
  if (!item || item.kind !== "audio") return <EmptyPlayer kind="audio" setScreen={setScreen} />;
  const q = qualityInfo(item);
  const pct = duration ? (time / duration) * 100 : 0;
  const speedMenu = SPEEDS.map((r) => ({ label: fmtRate(r), checked: Math.abs(rate - r) < 0.01, onClick: () => setRate(r) }));
  return (
    <main className="content music-view">
      <div className="now-playing-label">
        <span>
          <i className={playing ? "playing-dot" : ""} />
          {error ? "UNAVAILABLE" : playing ? "NOW PLAYING" : "PAUSED"}
        </span>
        <IconButton icon="more" label="Track options" onClick={(e) => openMenuBelow(e.currentTarget, [
          { label: `Playback speed · ${fmtRate(rate)}`, icon: "gauge", children: speedMenu },
          { label: "Queue", icon: "queue", onClick: () => setPopover("queue") },
          { label: "Audio details", icon: "info", onClick: () => setPopover("audio") },
          { separator: true, label: "" },
          ...itemMenu(item, { context: [item.id] }).filter((m) => m.label !== "Play" && m.label !== "Play next"),
        ])} />
      </div>
      <div className="music-layout">
        <div className="artwork-stage">
          <div className={`hero-art ${playing ? "is-playing" : ""}`}>
            {item.cover ? <img src={item.cover} alt={`${item.album || item.title} artwork`} /> : <span className="hero-ph"><Icon name="music" size={96} /></span>}
            <span className="art-shine" />
          </div>
          <div className="art-shadow" />
        </div>
        <div className="track-panel">
          <p className="eyebrow">{[item.album || "SINGLE", item.year].filter(Boolean).join(" · ").toUpperCase()}</p>
          <h1>{item.title}</h1>
          <h2>{item.artist || "Unknown artist"}</h2>
          <div className="quality-row">
            <button className="quality-badge" onClick={() => setPopover("audio")} aria-label="Audio details">
              {q.short.map((p, i) => <span key={i}>{i > 0 && <i />}{p}</span>)}
              {item.lossless && q.hires && <b>HI-RES</b>}
            </button>
            <IconButton icon="heart" label={item.favorite ? "Remove favorite" : "Favorite"} active={item.favorite} onClick={() => toggleFavorite(item.id)} />
            <IconButton icon="queue" label="Queue" onClick={() => setPopover("queue")} />
          </div>
          {error && (
            <p className="prototype-note error-note">
              <Icon name="info" size={14} /> {error}
              {item.missing && <button className="soft-button" onClick={() => void locateItem(item.id)}>Locate…</button>}
            </p>
          )}
          <div className="timeline">
            <ProgressSlider value={pct} buffer={buffered} duration={duration} live={false} onCommit={seekPct} label="Seek" />
            <div>
              <span>{fmtTime(time)}</span>
              <span>−{fmtTime(Math.max(0, duration - time))}</span>
            </div>
          </div>
          <PlaybackCluster large />
          <div className="player-bottom">
            <VolumeControl />
            <button className="mixer-button" onClick={() => setMixer(true)}>
              <span>
                <Icon name="layers" />
                <i /><i /><i />
              </span>
              <b>Background sounds</b>
              <MixerSummary />
              <Icon name="chevron" />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
function MixerSummary() {
  const n = mixerState.use((s) => s.active.length);
  return <small>{n ? `${n} active` : "Mix ambience"}</small>;
}

function QueueDrawer({ close }: { close: () => void }) {
  const queue = player.use((s) => s.queue);
  const order = player.use((s) => s.order);
  const pos = player.use((s) => s.pos);
  const items = library.use((s) => s.items);
  const dragFrom = useRef<number | null>(null);
  const curIdx = order[pos];
  return (
    <div className="drawer-backdrop" onMouseDown={close}>
      <aside className="mixer-drawer glass queue-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="popover-title">
          <div><p>Queue</p><small>{queue.length} {queue.length === 1 ? "item" : "items"} · drag to reorder</small></div>
          <div className="title-actions">
            {queue.length > 1 && <button className="soft-button" onClick={clearQueue}>Clear others</button>}
            <IconButton icon="close" label="Close queue" onClick={close} />
          </div>
        </div>
        {queue.length === 0 && <p className="prototype-note"><Icon name="info" size={14} /> The queue is empty. Play something from the library.</p>}
        <div className="queue-list">
          {queue.map((id, i) => {
            const it = items.find((x) => x.id === id);
            if (!it) return null;
            return (
              <div
                key={`${id}-${i}`}
                className={`queue-row ${i === curIdx ? "active" : ""}`}
                draggable
                onDragStart={() => { dragFrom.current = i; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (dragFrom.current !== null) moveInQueue(dragFrom.current, i); dragFrom.current = null; }}
                onDoubleClick={() => void jumpTo(i)}
              >
                <span className="row-index">{i === curIdx ? <i className="playing-dot" /> : i + 1}</span>
                <span className="row-meta" onClick={() => void jumpTo(i)}><strong>{it.title}</strong><small>{itemSubtitle(it)}</small></span>
                <IconButton icon="up" label="Move up" disabled={i === 0} onClick={() => moveInQueue(i, i - 1)} />
                <IconButton icon="down" label="Move down" disabled={i === queue.length - 1} onClick={() => moveInQueue(i, i + 1)} />
                <IconButton icon="close" label="Remove from queue" onClick={() => removeFromQueue(i)} />
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

/* ---------- video player ---------- */
function ControlButton({ children, onClick, active, label, disabled }: { children: React.ReactNode; onClick?: () => void; active?: boolean; label: string; disabled?: boolean }) {
  return (
    <button className={`video-control ${active ? "active" : ""}`} onClick={onClick} aria-label={label} data-tip={label} disabled={disabled}>
      {children}
    </button>
  );
}

function VideoPlayer({ popover, setPopover, fullscreen, setFullscreen, setScreen }: {
  popover: Popover; setPopover: (p: Popover) => void; fullscreen: boolean; setFullscreen: (v: boolean) => void; setScreen: (s: Screen) => void;
}) {
  const curId = player.use((s) => s.currentId);
  const item = library.use((s) => s.items.find((i) => i.id === curId));
  const playing = player.use((s) => s.playing);
  const loading = player.use((s) => s.loading);
  const time = player.use((s) => s.time);
  const duration = player.use((s) => s.duration);
  const buffered = player.use((s) => s.buffered);
  const rate = player.use((s) => s.rate);
  const vh = player.use((s) => s.videoH);
  const cue = player.use((s) => s.cue);
  const error = player.use((s) => s.error);
  const canPip = player.use((s) => s.canPip);
  const pip = player.use((s) => s.pip);
  const fit = settings.use((s) => s.videoFit);
  const subSize = settings.use((s) => s.subtitleSize);
  const subOpacity = settings.use((s) => s.subtitleOpacity);
  const [translation, setTranslation] = useState(false);
  const [pill, setPill] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>(0);
  const isVideo = item?.kind === "video";

  useEffect(() => {
    const st = stageRef.current;
    if (!st || !isVideo) return;
    st.prepend(media);
    return () => { if (media.parentElement === st) st.removeChild(media); };
  }, [isVideo, curId]);
  useEffect(() => { media.style.objectFit = fit; }, [fit, isVideo]);
  useEffect(() => {
    const t = setTimeout(() => setPill(!playing), 400);
    return () => clearTimeout(t);
  }, [playing]);

  const wake = () => {
    setUiVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setUiVisible(false), 3000);
  };
  useEffect(() => { wake(); return () => window.clearTimeout(hideTimer.current); }, [playing]);
  const hidden = playing && !popover && !translation && !uiVisible;

  if (!item || !isVideo) return <EmptyPlayer kind="video" setScreen={setScreen} />;
  const pct = duration ? (time / duration) * 100 : 0;
  const heightLabel = vh || item.height ? `${vh || item.height}p` : "—";
  return (
    <main className={`content video-view ${fullscreen ? "fullscreen-video" : ""} ${hidden ? "controls-hidden" : ""}`} onMouseMove={wake} onMouseLeave={() => playing && setUiVisible(false)}>
      {!fullscreen && (
        <div className="video-titlebar">
          <div>
            <p className="eyebrow">PLAYING VIDEO</p>
            <strong>{item.title}</strong>
          </div>
          <IconButton icon="more" label="Video options" onClick={(e) => openMenuBelow(e.currentTarget, itemMenu(item, { context: [item.id] }).filter((m) => m.label !== "Play" && m.label !== "Play next"))} />
        </div>
      )}
      <div className="video-stage" ref={stageRef}
        onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("media-element") || (e.target as HTMLElement).classList.contains("video-vignette")) { if (popover) setPopover(null); else toggle(); } }}
        onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest(".video-controls, .translation-panel, .translate-pill")) setFullscreen(!fullscreen); }}
        style={{ "--sub-scale": subSize / 100, "--sub-alpha": subOpacity / 100 } as React.CSSProperties}>
        <div className="video-vignette" />
        {!playing && !error && <span className="paused-word">{loading ? "LOADING" : "PAUSED"}</span>}
        {playing && loading && <span className="paused-word">BUFFERING</span>}
        {error && (
          <div className="video-error">
            <Icon name="info" size={22} />
            <p>{error}</p>
            {item.missing && <button className="soft-button" onClick={() => void locateItem(item.id)}>Locate file…</button>}
          </div>
        )}
        {cue && <div className={`subtitle-overlay ${hidden ? "low" : ""} ${!playing && pill && !translation ? "above-pill" : ""}`}><span>{cue}</span></div>}
        {!playing && pill && !translation && !error && (
          <div className="translate-pill">
            <button onClick={() => setTranslation(true)}><Icon name="translate" /> Translate this moment?</button>
            <IconButton icon="close" label="Dismiss" onClick={() => setPill(false)} />
          </div>
        )}
        {translation && stageRef.current && <TranslationPanel stage={stageRef.current} onClose={() => setTranslation(false)} />}
        <div className="video-controls glass">
          <div className="video-timeline">
            <ProgressSlider value={pct} buffer={buffered} duration={duration} live={false} onCommit={seekPct} label="Seek" />
          </div>
          <div className="video-control-row">
            <ControlButton label={playing ? "Pause" : "Play"} onClick={() => toggle()}><Icon name={playing ? "pause" : "play"} /></ControlButton>
            <ControlButton label="Back 10 seconds" onClick={() => seekBy(-10)}>−10</ControlButton>
            <ControlButton label="Forward 10 seconds" onClick={() => seekBy(10)}>+10</ControlButton>
            <span className="video-time">{fmtTime(time)} <i>/</i> {fmtTime(duration)}</span>
            <span className="control-spacer" />
            <VolumeControl compact />
            <ControlButton label="Resolution" onClick={() => setPopover(popover === "quality" ? null : "quality")} active={popover === "quality"}>{heightLabel}</ControlButton>
            <ControlButton label="Playback speed" onClick={() => setPopover(popover === "speed" ? null : "speed")} active={popover === "speed"}>{fmtRate(rate)}</ControlButton>
            <ControlButton label="Subtitles" onClick={() => setPopover(popover === "subtitles" ? null : "subtitles")} active={popover === "subtitles"}><Icon name="captions" /></ControlButton>
            <ControlButton label="Audio track" onClick={() => setPopover(popover === "audiotrack" ? null : "audiotrack")} active={popover === "audiotrack"}><Icon name="music" /></ControlButton>
            <ControlButton label={canPip ? "Picture in Picture" : "Picture in Picture is not supported here"} onClick={() => void togglePip()} active={pip} disabled={!canPip}><span className="pip">PiP</span></ControlButton>
            <ControlButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={() => setFullscreen(!fullscreen)} active={fullscreen}><Icon name="expand" /></ControlButton>
          </div>
          {popover && ["quality", "speed", "subtitles", "audiotrack"].includes(popover) && (
            <VideoPopover type={popover} close={() => setPopover(null)} item={item} openTranslation={() => { setPopover(null); setTranslation(true); }} />
          )}
        </div>
      </div>
    </main>
  );
}

function VideoPopover({ type, close, item, openTranslation }: { type: Popover; close: () => void; item: Item; openTranslation: () => void }) {
  const rate = player.use((s) => s.rate);
  const subTracks = player.use((s) => s.subTracks);
  const subActive = player.use((s) => s.subActive);
  const audioTracks = player.use((s) => s.audioTracks);
  const vw = player.use((s) => s.videoW);
  const vh = player.use((s) => s.videoH);
  const fit = settings.use((s) => s.videoFit);
  const subSize = settings.use((s) => s.subtitleSize);
  const subOpacity = settings.use((s) => s.subtitleOpacity);
  const w = vw || item.width || 0;
  const h = vh || item.height || 0;
  const titles: Record<string, [string, string]> = {
    quality: ["Resolution", "Source stream"], speed: ["Playback speed", "Fine control"],
    subtitles: ["Subtitles", "Tracks & appearance"], audiotrack: ["Audio track", "Languages in this file"],
  };
  const cycle = <T,>(arr: T[], cur: T) => arr[(arr.indexOf(cur) + 1) % arr.length];
  return (
    <div className={`popover video-popover ${type === "subtitles" ? "wide" : ""}`}>
      <div className="popover-title">
        <div><p>{titles[type as string][0]}</p><small>{titles[type as string][1]}</small></div>
        <IconButton icon="close" label="Close" onClick={close} />
      </div>
      {type === "quality" && (
        <>
          <div className="menu-list">
            <button className="selected"><span>{w && h ? `${w}×${h} · ${h}p` : "Unknown"}</span><small>NOW</small><Icon name="check" /></button>
          </div>
          <div className="fine-adjust">
            <span>Container <b>{item.ext.toUpperCase()}</b></span>
            <span>File size <b>{fmtBytes(item.size)}</b></span>
            {w > 0 && h > 0 && <span>Aspect ratio <b>{+(w / h).toFixed(2)}:1</b></span>}
          </div>
          <div className="popover-section">
            <span>VIDEO FIT</span>
            <div className="text-segment">
              <button className={fit === "contain" ? "active" : ""} onClick={() => update({ videoFit: "contain" })}>Fit</button>
              <button className={fit === "cover" ? "active" : ""} onClick={() => update({ videoFit: "cover" })}>Fill</button>
            </div>
            <small>A local file has a single stream, so there is nothing to switch between.</small>
          </div>
        </>
      )}
      {type === "speed" && (
        <>
          <div className="menu-list">
            {SPEEDS.map((r) => (
              <button key={r} className={Math.abs(rate - r) < 0.01 ? "selected" : ""} onClick={() => setRate(r)}>
                <span>{fmtRate(r)}</span>
                {r === 1 && <small>NORMAL</small>}
                {Math.abs(rate - r) < 0.01 && <Icon name="check" />}
              </button>
            ))}
          </div>
          <div className="fine-adjust">
            <span>Fine adjustment <b>{rate.toFixed(2)}×</b></span>
            <ProgressSlider value={((rate - 0.25) / 1.75) * 100} compact label="Speed" onChange={(v) => setRate(Math.round((0.25 + (v / 100) * 1.75) * 20) / 20)} />
            <button onClick={() => setRate(1)}>Reset to 1×</button>
          </div>
        </>
      )}
      {type === "subtitles" && (
        <>
          <div className="menu-list">
            <button className={subActive === "off" ? "selected" : ""} onClick={() => setSubtitle("off")}><span>Off</span>{subActive === "off" && <Icon name="check" />}</button>
            {subTracks.map((t) => (
              <button key={t.id} className={subActive === t.id ? "selected" : ""} onClick={() => setSubtitle(t.id)}>
                <span>{t.label}</span>
                <small>{t.origin === "embedded" ? "EMBEDDED" : (LANG_NAMES[t.lang] ?? t.lang).toUpperCase().slice(0, 8)}</small>
                {subActive === t.id && <Icon name="check" />}
              </button>
            ))}
            {subTracks.length === 0 && <p className="prototype-note"><Icon name="info" size={14} /> No subtitle tracks found. Add an SRT, ASS or VTT file.</p>}
          </div>
          <div className="popover-section">
            <span>ADD SUBTITLES</span>
            <button className="soft-button" onClick={async () => { const p = await pickSubtitleFile(); if (p) await loadSubtitleFile(p); }}><Icon name="plus" /> Subtitle file</button>
            <small>SRT · ASS · VTT</small>
          </div>
          <div className="popover-section appearance-mini">
            <span>APPEARANCE</span>
            <div>
              <button onClick={() => update({ subtitleSize: cycle([75, 100, 125, 150, 200], subSize) })}>Size <b>{subSize}%</b></button>
              <button onClick={() => update({ subtitleOpacity: cycle([40, 60, 75, 90, 100], subOpacity) })}>Opacity <b>{subOpacity}%</b></button>
            </div>
            <button className="translate-action" onClick={openTranslation}><Icon name="translate" /> Translate current subtitles</button>
          </div>
        </>
      )}
      {type === "audiotrack" && (
        <div className="menu-list">
          {audioTracks.length > 0 ? audioTracks.map((t) => (
            <button key={t.id} className={t.enabled ? "selected" : ""} onClick={() => setAudioTrack(t.id)}>
              <span>{t.label}{t.lang !== "und" ? ` · ${LANG_NAMES[t.lang] ?? t.lang}` : ""}</span>
              {t.enabled && <Icon name="check" />}
            </button>
          )) : (
            <p className="prototype-note">
              <Icon name="info" size={14} /> {supportsAudioTracks() ? "This file has a single audio track." : "This engine cannot list or switch audio tracks. The native libmpv backend can (see README)."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TranslationPanel({ stage, onClose }: { stage: HTMLElement; onClose: () => void }) {
  const target = settings.use((s) => s.translateTarget);
  const [source, setSource] = useState(() => {
    const s = player.get();
    const t = s.subTracks.find((x) => x.id === s.subActive);
    if (s.cue) return s.cue;
    if (!t) return "";
    const past = t.cues.filter((c) => c.start <= media.currentTime).pop();
    return past?.text ?? "";
  });
  const [origin, setOrigin] = useState<"SUBTITLE" | "OCR">("SUBTITLE");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const time = player.use((s) => s.time);

  const stepLine = (dir: -1 | 1) => {
    const s = player.get();
    const t = s.subTracks.find((x) => x.id === s.subActive);
    if (!t || !t.cues.length) { setNote("Turn on a subtitle track to step through lines."); return; }
    let idx = t.cues.findIndex((c) => c.end >= media.currentTime);
    if (idx < 0) idx = t.cues.length - 1;
    const cur = t.cues[idx];
    const j = Math.max(0, Math.min(t.cues.length - 1, idx + (cur && media.currentTime >= cur.start ? dir : dir > 0 ? 0 : -1)));
    seek(t.cues[j].start + 0.05);
    setSource(t.cues[j].text); setOrigin("SUBTITLE"); setResult("");
  };
  const doTranslate = async () => {
    if (!source.trim()) { setNote("There is no text to translate yet."); return; }
    setBusy(true); setNote("");
    const r = await translate(source);
    setBusy(false);
    if (r.ok) setResult(r.text); else { setResult(""); setNote(r.reason); }
  };
  const recognize = async () => {
    if (!rect || rect.w < 0.01 || rect.h < 0.01) { setNote("Drag over the video to select the text area first."); return; }
    setBusy(true); setNote("");
    try {
      const sr = stage.getBoundingClientRect();
      const vw = media.videoWidth, vh = media.videoHeight;
      if (!vw) throw new Error("No video frame available.");
      const scale = Math.min(sr.width / vw, sr.height / vh);
      const cw = vw * scale, ch = vh * scale;
      const ox = (sr.width - cw) / 2, oy = (sr.height - ch) / 2;
      const sx = Math.max(0, ((rect.x * sr.width - ox) / cw) * vw);
      const sy = Math.max(0, ((rect.y * sr.height - oy) / ch) * vh);
      const sw = Math.min(vw - sx, (rect.w * sr.width / cw) * vw);
      const sh = Math.min(vh - sy, (rect.h * sr.height / ch) * vh);
      const up = Math.max(1, Math.min(3, 1400 / Math.max(sw, 1)));
      const c = document.createElement("canvas");
      c.width = Math.round(sw * up); c.height = Math.round(sh * up);
      c.getContext("2d")!.drawImage(media, sx, sy, sw, sh, 0, 0, c.width, c.height);
      c.getContext("2d")!.getImageData(0, 0, 1, 1); // throws if the canvas is tainted
      const r = await ocr(c);
      if (r.ok) { setSource(r.text); setOrigin("OCR"); setResult(""); setNote(`Recognised with ${r.engine}.`); setSelecting(false); }
      else setNote(r.reason);
    } catch (e) {
      setNote(`Could not read this frame: ${(e as Error).message}`);
    }
    setBusy(false);
  };
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast("Copied"), () => toast("Copy failed"));
  const tname = TARGETS.find(([c]) => c === target)?.[1] ?? target;

  return (
    <>
      <div className="translation-panel glass">
        <div className="popover-title">
          <div><p>Moment text</p><small>{origin === "OCR" ? "From the video frame" : "From active subtitles"} · {fmtTime(time)}</small></div>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <button className="language-select" onClick={(e) => openMenuBelow(e.currentTarget, TARGETS.map(([c, n]) => ({ label: n, checked: c === target, onClick: () => update({ translateTarget: c }) })))}>
          AUTO DETECT → {tname.toUpperCase()} <Icon name="chevron" size={14} />
        </button>
        <div className="text-block">
          <span>{origin === "OCR" ? "RECOGNISED TEXT" : "SOURCE TEXT"}</span>
          <textarea className="moment-text" value={source} placeholder="No subtitle text at this moment. Load subtitles, or select a frame region below to read on-screen text." onChange={(e) => { setSource(e.target.value); setResult(""); }} rows={3} />
          <div>
            <button onClick={() => copy(source)} disabled={!source}><Icon name="copy" /> Copy</button>
            <button onClick={() => stepLine(-1)}>Previous line</button>
            <button onClick={() => stepLine(1)}>Next line</button>
          </div>
        </div>
        <div className={`text-block result ${result ? "ready" : ""}`}>
          <span>TRANSLATION</span>
          {result ? <p>{result}</p> : <p className="muted">{busy ? "Working…" : "Press Translate to translate the text above."}</p>}
          <div>
            <button onClick={() => void doTranslate()} disabled={busy}><Icon name="translate" /> {result ? "Translate again" : "Translate"}</button>
            {result && <button onClick={() => copy(result)}><Icon name="copy" /> Copy translation</button>}
          </div>
        </div>
        <button className={`region-button ${selecting ? "active" : ""}`} onClick={() => (selecting && rect ? void recognize() : (setSelecting(!selecting), setRect(null)))} disabled={busy}>
          <Icon name="expand" />
          {selecting ? (rect ? "Read selected region" : "Drag on the video…") : "Select frame region"}
          <small>OCR</small>
        </button>
        {note && <p className="prototype-note"><Icon name="info" size={14} /> {note}</p>}
      </div>
      {selecting && createPortalToStage(stage, (
        <div className="ocr-layer"
          onPointerDown={(e) => { const r = stage.getBoundingClientRect(); drag.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; setRect({ ...drag.current, w: 0, h: 0 }); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (!drag.current) return; const r = stage.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; const d = drag.current; setRect({ x: Math.min(d.x, x), y: Math.min(d.y, y), w: Math.abs(x - d.x), h: Math.abs(y - d.y) }); }}
          onPointerUp={() => { drag.current = null; }}>
          {rect && rect.w > 0 && (
            <div className="ocr-selection" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}>
              <i />
              {rect.w > 0.12 && <span>Text area</span>}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
const createPortalToStage = (stage: HTMLElement, node: React.ReactNode) => createPortal(node, stage);

function AudioPopover({ close }: { close: () => void }) {
  const curId = player.use((s) => s.currentId);
  const it = library.use((s) => s.items.find((i) => i.id === curId));
  if (!it) return null;
  const q = qualityInfo(it);
  const rows: [string, string, string?, string?][] = [
    ["Format", `${it.codec ?? it.ext.toUpperCase()} · .${it.ext}`, q.tier, it.lossless ? "No quality loss" : "Compressed"],
    ...(it.sampleRate ? [["Sample rate", it.codec === "DSD" ? q.dsdRate! : q.khz!] as [string, string]] : []),
    ...(q.bits ? [["Bit depth", q.bits] as [string, string]] : []),
    ...(q.avgKbps ? [["Average bitrate", `${q.avgKbps} kbps`] as [string, string]] : []),
    ...(it.channels ? [["Channels", it.channels === 1 ? "Mono" : it.channels === 2 ? "Stereo" : `${it.channels} channels`] as [string, string]] : []),
    ...(it.duration ? [["Duration", fmtTime(it.duration)] as [string, string]] : []),
    ["File size", fmtBytes(it.size)],
  ];
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="audio-popover popover" onMouseDown={(e) => e.stopPropagation()}>
        <div className="popover-title">
          <div><p>Audio quality</p><small>Measured from the file you are playing</small></div>
          <IconButton icon="close" label="Close" onClick={close} />
        </div>
        {rows.map(([k, v, tag, note]) => (
          <div className="quality-option static" key={k}>
            <span><b>{k}</b><small>{v}</small></span>
            <em>{tag ?? ""}</em>
            <i>{note ?? ""}</i>
          </div>
        ))}
        <p className="prototype-note"><Icon name="info" size={14} /> Mono plays this file as it is. Quality cannot be improved beyond the original recording.</p>
      </div>
    </div>
  );
}

/* ---------- playlists ---------- */
function Playlists({ setScreen }: { setScreen: (s: Screen) => void }) {
  const playlists = library.use((s) => s.playlists);
  const items = library.use((s) => s.items);
  const [open, setOpen] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const recent = useMemo(() => items.filter((i) => i.lastPlayed).sort((a, b) => b.lastPlayed! - a.lastPlayed!).slice(0, 100), [items]);
  const favs = useMemo(() => items.filter((i) => i.favorite), [items]);
  const lists: { id: string; name: string; ids: string[]; system: boolean; icon: IconName }[] = [
    { id: "recent", name: "Recently Played", ids: recent.map((i) => i.id), system: true, icon: "repeat" },
    { id: "fav", name: "Favorites", ids: favs.map((i) => i.id), system: true, icon: "heart" },
    ...playlists.map((p) => ({ id: p.id, name: p.name, ids: p.items, system: false, icon: "playlist" as IconName })),
  ];
  const cur = lists.find((l) => l.id === open);
  const minutes = (ids: string[]) => Math.round(ids.reduce((n, id) => n + (byId.get(id)?.duration ?? 0), 0) / 60);

  if (open && !cur) setOpen(null);
  if (cur) {
    const rows = cur.ids.map((id) => byId.get(id)).filter(Boolean) as Item[];
    const ctx = rows.map((r) => r.id);
    return (
      <main className="content generic-view">
        <div className="page-heading">
          <div>
            <button className="back-link" onClick={() => setOpen(null)}><Icon name="chevron" size={14} /> Playlists</button>
            <h1>{cur.name}</h1>
            <p>{rows.length} {rows.length === 1 ? "item" : "items"}{minutes(ctx) ? ` · ${minutes(ctx)} min` : ""}</p>
          </div>
          <div className="heading-actions">
            {!cur.system && (
              <>
                <IconButton icon="edit" label="Rename playlist" onClick={async () => { const n = await askText("Rename playlist", cur.name, "Rename"); if (n) renamePlaylist(cur.id, n); }} />
                <IconButton icon="trash" label="Delete playlist" onClick={async () => { if (await askConfirm("Delete playlist?", `“${cur.name}” will be deleted. Your media files are not affected.`, "Delete", true)) { deletePlaylist(cur.id); setOpen(null); } }} />
              </>
            )}
            <button className="soft-button" disabled={!rows.length} onClick={() => { if (!settings.get().shuffle) toggleShuffle(); void playIds(ctx, Math.floor(Math.random() * Math.max(1, ctx.length))); }}><Icon name="shuffle" /> Shuffle</button>
            <button className="primary-button" disabled={!rows.length} onClick={() => void playIds(ctx, 0)}><Icon name="play" /> Play</button>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state glass">
            <span className="empty-icon"><Icon name={cur.icon} size={30} /></span>
            <h2>{cur.id === "fav" ? "No favorites yet" : cur.id === "recent" ? "Nothing played yet" : "This playlist is empty"}</h2>
            <p>{cur.system ? "Items appear here automatically." : "Right-click any track and choose Add to playlist."}</p>
            <button className="soft-button" onClick={() => setScreen("home")}>Open library</button>
          </div>
        ) : (
          <div className="track-list">
            {rows.map((it, i) => (
              <TrackRow key={it.id} item={it} index={i} context={ctx} playlistId={cur.system ? undefined : cur.id}
                draggable={!cur.system} onDragStart={() => { dragFrom.current = i; }}
                onDrop={() => { if (dragFrom.current !== null) movePlaylistItem(cur.id, dragFrom.current, i); dragFrom.current = null; }}
                extra={!cur.system ? (
                  <>
                    <IconButton icon="up" label="Move up" disabled={i === 0} onClick={(e) => { e.stopPropagation(); movePlaylistItem(cur.id, i, i - 1); }} className="row-btn" />
                    <IconButton icon="down" label="Move down" disabled={i === rows.length - 1} onClick={(e) => { e.stopPropagation(); movePlaylistItem(cur.id, i, i + 1); }} className="row-btn" />
                    <IconButton icon="close" label="Remove from playlist" onClick={(e) => { e.stopPropagation(); removeFromPlaylist(cur.id, it.id); }} className="row-btn" />
                  </>
                ) : undefined} />
            ))}
          </div>
        )}
      </main>
    );
  }
  return (
    <main className="content generic-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">COLLECTIONS</p>
          <h1>Playlists</h1>
          <p>Spaces for every kind of listening.</p>
        </div>
        <button className="primary-button" onClick={() => void newPlaylistWith([])}><Icon name="plus" /> New playlist</button>
      </div>
      <div className="playlist-large-grid">
        {lists.map((p, i) => (
          <button className="large-playlist glass" onClick={() => setOpen(p.id)} key={p.id}
            onContextMenu={(e) => { if (p.system) return; openMenuFromEvent(e, [
              { label: "Play", icon: "play", disabled: !p.ids.length, onClick: () => void playIds(p.ids, 0) },
              { label: "Rename…", icon: "edit", onClick: async () => { const n = await askText("Rename playlist", p.name, "Rename"); if (n) renamePlaylist(p.id, n); } },
              { label: "Delete", icon: "trash", danger: true, onClick: async () => { if (await askConfirm("Delete playlist?", `“${p.name}” will be deleted. Your media files are not affected.`, "Delete", true)) deletePlaylist(p.id); } },
            ]); }}>
            <div className={`playlist-art gradient-${i % 6}`}><Icon name={p.icon} size={34} /></div>
            <span>
              <strong>{p.name}</strong>
              <small>{p.ids.length} {p.ids.length === 1 ? "item" : "items"}{minutes(p.ids) ? ` · ${minutes(p.ids)} min` : ""}</small>
            </span>
            <Icon name="chevron" />
          </button>
        ))}
      </div>
      {playlists.length === 0 && <p className="prototype-note"><Icon name="info" size={14} /> Create a playlist, then right-click a track to add it.</p>}
    </main>
  );
}

/* ---------- specs ---------- */
function Specs() {
  return (
    <main className="content specs-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">REFERENCE · VERSION 1.0</p>
          <h1>Product specifications</h1>
          <p>Motion, input, geometry, and production boundaries.</p>
        </div>
      </div>
      <div className="spec-grid">
        <SettingsSection title="Motion system" description="Spring-based movement with reduced-motion fallback.">
          <div className="motion-list">
            {[["Sidebar collapse", "520 ms", "Standard · 30%"], ["Popover open", "520 ms", "Standard · 30%"], ["Button feedback", "450 ms", "Fast · 25%"], ["Liquid morph", "560 ms", "Expressive · 35%"], ["Unlock error", "300 ms", "Feedback · 20%"], ["Theme / wallpaper", "400 ms", "Crossfade"]].map((r) => (
              <div key={r[0]}><b>{r[0]}</b><span>{r[1]}</span><small>{r[2]}</small></div>
            ))}
          </div>
        </SettingsSection>
        <SettingsSection title="Slider geometry" description="One component used throughout the product.">
          <div className="slider-tests">
            {[0, 25, 50, 75, 100].map((v) => (
              <div key={v}><span>{v}%</span><ProgressSlider value={v} readOnly compact buffer={Math.min(100, v + 18)} /></div>
            ))}
          </div>
          <p className="prototype-note"><Icon name="info" size={14} /> Fill end and thumb center share the same position formula, including at both extremes.</p>
        </SettingsSection>
        <SettingsSection title="Hotkeys map"><HotkeyTable /></SettingsSection>
        <SettingsSection title="Implementation notes">
          <div className="dev-columns">
            <div>
              <span>WORKS IN THIS BUILD</span>
              <p>Opening files and folders, drag &amp; drop, real playback of everything the web engine can decode, queue, playlists, favorites, library persistence, subtitles (SRT, ASS, VTT), Picture-in-Picture, background sound mixer, themes, glass and wallpaper customisation, password lock (PBKDF2).</p>
            </div>
            <div>
              <span>NEEDS THE NATIVE BACKEND</span>
              <p>DSD and ALAC on Windows, MKV with unusual codecs, audio-track switching in every container, embedded subtitle tracks from MKV, hardware-decode options. Plan: libmpv inside the Tauri shell (see README).</p>
            </div>
          </div>
          <div className="native-note">
            <Icon name="info" />
            <span>
              <b>Privacy &amp; performance</b>
              <small>Media is processed locally. External translation or OCR download only runs after you opt in. Reduced Effects removes blur and animated wallpapers.</small>
            </span>
          </div>
        </SettingsSection>
        <SettingsSection title="Format boundaries">
          <div className="format-row">
            <span><b>Video</b>MP4 · MKV · WebM</span>
            <span><b>Audio</b>MP3 · FLAC · WAV · ALAC · DSD</span>
            <span><b>Subtitles</b>SRT · ASS · VTT</span>
          </div>
          <p className="prototype-note"><Icon name="info" size={14} /> Container support does not guarantee every codec. Mono checks each file when it is added and flags what the current engine cannot decode.</p>
        </SettingsSection>
      </div>
    </main>
  );
}

/* ---------- mixer ---------- */
const SOUND_ICONS: Record<string, IconName> = { Rain: "rain", Thunderstorm: "spark", Forest: "tree", Cafe: "coffee", Fireplace: "fire", Wind: "wind", "White Noise": "layers" };
function Mixer({ close }: { close: () => void }) {
  const mix = settings.use((s) => s.mixer);
  const balance = settings.use((s) => s.mixerBalance);
  const custom = mixerState.use((s) => s.custom);
  const names = [...BUILTIN as readonly string[], ...custom.map((c) => `custom:${c.id}`)];
  const label = (n: string) => (n.startsWith("custom:") ? custom.find((c) => `custom:${c.id}` === n)?.name ?? "Custom" : n);
  const activeN = names.filter((n) => mix[n]?.on).length;
  return (
    <div className="drawer-backdrop" onMouseDown={close}>
      <aside className="mixer-drawer glass" onMouseDown={(e) => e.stopPropagation()}>
        <div className="popover-title">
          <div><p>Background sounds</p><small>{activeN} active · Mixed locally</small></div>
          <IconButton icon="close" label="Close mixer" onClick={close} />
        </div>
        <div className="balance">
          <span><b>Balance</b><small>Music</small><small>Background</small></span>
          <ProgressSlider value={balance} onChange={setBalance} label="Music and background balance" />
        </div>
        <div className="sound-list">
          {names.map((s) => {
            const m = mix[s] ?? { on: false, vol: 0.5 };
            return (
              <div className={m.on ? "active" : ""} key={s}>
                <span className="sound-icon"><Icon name={SOUND_ICONS[s] ?? "music"} /></span>
                <span className="sound-name"><b>{label(s)}</b><small>{m.on ? (m.muted ? "Muted" : "Playing · Loop") : "Off"}</small></span>
                <div className="sound-volume"><ProgressSlider value={m.vol * 100} onChange={(v) => setSoundVolume(s, v / 100)} compact label={`${label(s)} volume`} /></div>
                <IconButton icon={m.muted ? "mute" : "volume"} label={m.muted ? `Unmute ${label(s)}` : `Mute ${label(s)}`} disabled={!m.on} onClick={() => toggleSoundMute(s)} />
                {s.startsWith("custom:") && <IconButton icon="trash" label="Remove sound" onClick={() => void removeCustomSound(s.slice(7))} />}
                <Toggle checked={!!m.on} onChange={(v) => void setSound(s, v)} label={label(s)} />
              </div>
            );
          })}
        </div>
        <button className="add-sound" onClick={() => void addCustomSound()}>
          <Icon name="plus" />
          <span><b>Add custom sound</b><small>MP3 · WAV · FLAC · OGG</small></span>
        </button>
        <p className="prototype-note"><Icon name="info" size={14} /> Ambient sounds are generated on your device and play together with your music.</p>
      </aside>
    </div>
  );
}

/* ---------- mini player ---------- */
function MiniPlayer({ setScreen, setMixer }: { setScreen: (s: Screen) => void; setMixer: (v: boolean) => void }) {
  const curId = player.use((s) => s.currentId);
  const item = library.use((s) => s.items.find((i) => i.id === curId));
  const playing = player.use((s) => s.playing);
  const time = player.use((s) => s.time);
  const duration = player.use((s) => s.duration);
  const pct = duration ? (time / duration) * 100 : 0;
  return (
    <footer className="mini-player glass">
      {item?.cover ? <img src={item.cover} alt="" /> : <span className="mini-ph"><Icon name={item?.kind === "video" ? "video" : "music"} /></span>}
      <span className="mini-meta">
        <strong>{item?.title ?? "Nothing playing"}</strong>
        <small>{item ? (item.kind === "video" ? "Video" : item.artist || "Unknown artist") : "Open a file to start"}</small>
      </span>
      <div className="mini-controls">
        <IconButton icon="prev" label="Previous" disabled={!item} onClick={() => void prev()} />
        <button className="mini-play" onClick={() => (item ? toggle() : void openFiles())} aria-label={playing ? "Pause" : item ? "Play" : "Open file"}>
          <Icon name={playing ? "pause" : item ? "play" : "plus"} />
        </button>
        <IconButton icon="next" label="Next" disabled={!item} onClick={() => void next()} />
      </div>
      <div className="mini-progress">
        <ProgressSlider value={pct} compact duration={duration} live={false} onCommit={seekPct} label="Seek" readOnly={!item} />
        <span>{fmtTime(time)} / {fmtTime(duration)}</span>
      </div>
      <VolumeControl compact />
      <IconButton icon="layers" label="Background sounds" onClick={() => setMixer(true)} />
      <IconButton icon="expand" label="Open full player" disabled={!item} onClick={() => setScreen(item?.kind === "video" ? "video" : "music")} />
    </footer>
  );
}

/* ---------- onboarding ---------- */
function Onboarding({ step, setStep, finish }: { step: number; setStep: (n: number) => void; finish: () => void }) {
  const [protection, setProtection] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [added, setAdded] = useState<{ label: string; n: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const addFolder = async (label: string) => {
    setBusy(true);
    try {
      const picked = await pickFolder();
      if (picked.length) {
        const r = await importPicked(picked);
        setAdded((a) => [...a, { label, n: r.added + r.duplicates }]);
      }
    } catch (e) { toast(`Could not read the folder: ${(e as Error).message}`); }
    setBusy(false);
  };
  const done = async () => {
    if (protection) {
      if (pw.length < 4) { setErr("Use at least 4 characters."); return; }
      if (pw !== pw2) { setErr("The passwords do not match."); return; }
      await setPassword(pw);
    }
    finish();
  };
  return (
    <div className="onboarding">
      <div className="onboard-visual">
        <div className="onboard-orbit o1" />
        <div className="onboard-orbit o2" />
        <Logo />
      </div>
      <section className="onboard-card glass">
        <div className="step-count">0{step} <span>/ 03</span></div>
        {step === 1 && (
          <>
            <p className="eyebrow">WELCOME</p>
            <h1>Welcome to Mono.</h1>
            <p>A quiet place for every sound and frame you keep.</p>
            <div className="onboard-feature">
              <Icon name="spark" />
              <span><b>Designed around your media</b><small>Private, local, and made for focus.</small></span>
            </div>
            <button className="primary-button wide" onClick={() => setStep(2)}>Continue <Icon name="chevron" /></button>
          </>
        )}
        {step === 2 && (
          <>
            <p className="eyebrow">MEDIA LIBRARY</p>
            <h1>Your media, one place.</h1>
            <p>Choose folders now, or add them at any time.</p>
            <div className="folder-list">
              <button disabled={busy} onClick={() => void addFolder("Music")}>
                <Icon name="music" />
                <span><b>Music folder</b><small>{added.find((a) => a.label === "Music") ? `${added.find((a) => a.label === "Music")!.n} items added` : "Choose a folder…"}</small></span>
                {added.find((a) => a.label === "Music") && <Icon name="check" />}
              </button>
              <button disabled={busy} onClick={() => void addFolder("Videos")}>
                <Icon name="video" />
                <span><b>Video folder</b><small>{added.find((a) => a.label === "Videos") ? `${added.find((a) => a.label === "Videos")!.n} items added` : "Choose a folder…"}</small></span>
                {added.find((a) => a.label === "Videos") && <Icon name="check" />}
              </button>
              <button className="add-folder" disabled={busy} onClick={() => void addFolder("Other")}><Icon name="plus" /> {busy ? "Importing…" : "Add folder"}</button>
            </div>
            <small className="format-note">MP3 · FLAC · WAV · ALAC · DSD · MP4 · MKV · WebM</small>
            <button className="primary-button wide" onClick={() => setStep(3)}>Continue <Icon name="chevron" /></button>
          </>
        )}
        {step === 3 && (
          <>
            <p className="eyebrow">PROTECTION</p>
            <h1>Your space. Your privacy.</h1>
            <p>Add a password now, or enable protection later in Settings.</p>
            <div className="protect-option">
              <span><Icon name="lock" /><b>Enable password protection</b></span>
              <Toggle checked={protection} onChange={setProtection} label="Password protection" />
            </div>
            {protection && (
              <div className="pw-fields">
                <input className="text-input" type="password" placeholder="Password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} aria-label="Password" />
                <input className="text-input" type="password" placeholder="Repeat password" value={pw2} onChange={(e) => { setPw2(e.target.value); setErr(""); }} aria-label="Repeat password" />
                {err && <p className="lock-error">{err}</p>}
              </div>
            )}
            <button className="primary-button wide" onClick={() => void done()}>{protection ? "Enable protection" : "Enter Mono"} <Icon name="chevron" /></button>
            <button className="skip-button" onClick={finish}>Skip for now</button>
          </>
        )}
      </section>
    </div>
  );
}

function DragOverlay({ status, message }: { status: "over" | "working" | "done"; message: string }) {
  return (
    <div className="drag-overlay">
      <div className="drop-zone">
        <span className="drop-icon"><Icon name={status === "done" ? "check" : "upload"} size={34} /></span>
        <h2>{status === "over" ? "Drop media here" : status === "working" ? "Importing…" : "Import complete"}</h2>
        <p>{status === "done" ? message : "Audio, video and subtitle files, or whole folders"}</p>
        <div>MP4 · MKV · WEBM · MP3 · FLAC · WAV · ALAC · DSD · SRT · ASS · VTT</div>
      </div>
    </div>
  );
}

/* ---------- app ---------- */
export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [popover, setPopover] = useState<Popover>(null);
  const [mixer, setMixer] = useState(false);
  const [fullscreen, setFs] = useState(false);
  const [search, setSearch] = useState("");
  const [onboarding, setOnboarding] = useState<number | null>(null);
  const [locked, setLocked] = useState(() => hasPassword());
  const [drag, setDrag] = useState<{ status: "over" | "working" | "done"; message: string } | null>(null);
  const s = settings.use((x) => x);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const dragDepth = useRef(0);

  const setFullscreen = (v: boolean) => { setFs(v); void setNativeFullscreen(v); };

  /* boot */
  useEffect(() => {
    setNavigator((k) => setScreen(k));
    initEngine();
    void initLibrary();
    void initMixer();
    if (!settings.get().onboarded) setOnboarding(1);
    const loc = (e: Event) => void locateItem((e as CustomEvent<string>).detail);
    window.addEventListener("mono:locate", loc);
    const onFs = () => { if (!document.fullscreenElement && !isTauri) setFs(false); };
    document.addEventListener("fullscreenchange", onFs);
    const unmuteNav = () => { void 0; };
    return () => { window.removeEventListener("mono:locate", loc); document.removeEventListener("fullscreenchange", onFs); unmuteNav(); };
  }, []);

  /* appearance */
  useEffect(() => { applyToDocument(s, document.documentElement); }, [s]);

  /* import from drag & drop */
  const importDropped = async (get: () => Promise<import("./lib/platform").Picked[]>) => {
    setDrag({ status: "working", message: "" });
    try {
      const picked = await get();
      if (!picked.length) { setDrag({ status: "done", message: "No supported media found" }); }
      else { await handlePicked(picked, true); setDrag({ status: "done", message: `${picked.length} file${picked.length === 1 ? "" : "s"} processed` }); }
    } catch (e) { setDrag({ status: "done", message: `Import failed: ${(e as Error).message}` }); }
    window.setTimeout(() => setDrag(null), 900);
  };
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => { if (!hasFiles(e) || locked) return; e.preventDefault(); dragDepth.current++; setDrag((d) => d ?? { status: "over", message: "" }); };
    const over = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDrag((d) => (d?.status === "over" ? null : d)); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || isTauri) return;
      e.preventDefault(); dragDepth.current = 0;
      if (locked) return;
      const dt = e.dataTransfer!;
      void importDropped(() => pickedFromDataTransfer(dt));
    };
    window.addEventListener("dragenter", enter); window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave); window.addEventListener("drop", drop);
    let off: (() => void) | undefined;
    void onNativeDrop({
      over: (v) => setDrag((d) => (v ? d ?? { status: "over", message: "" } : d?.status === "over" ? null : d)),
      drop: (list) => void importDropped(async () => list),
    }).then((f) => (off = f));
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); off?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  /* auto lock */
  useEffect(() => {
    if (locked || !hasPassword()) return;
    let t: number;
    const reset = () => {
      window.clearTimeout(t);
      const m = settings.get().autoLockMinutes;
      if (m > 0) t = window.setTimeout(() => setLocked(true), m * 60_000);
    };
    const vis = () => { if (document.hidden && settings.get().lockOnMinimize) setLocked(true); };
    const evs = ["pointerdown", "keydown", "mousemove", "wheel"] as const;
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    document.addEventListener("visibilitychange", vis);
    reset();
    return () => { window.clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, reset)); document.removeEventListener("visibilitychange", vis); };
  }, [locked, s.autoLockMinutes]);
  useEffect(() => {
    const lock = () => setLocked(true);
    window.addEventListener("mono:lock", lock);
    return () => window.removeEventListener("mono:lock", lock);
  }, []);

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (locked || onboarding) return;
      const t = e.target as HTMLElement;
      const typing = !!t?.closest?.("input, textarea, [contenteditable], select");
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "o") { e.preventDefault(); void (e.shiftKey ? openFolder() : openFiles()); return; }
      if (mod && k === "f") { e.preventDefault(); setScreen("home"); setTimeout(() => document.querySelector<HTMLInputElement>(".search input")?.focus(), 50); return; }
      if (mod && e.key === ",") { e.preventDefault(); setScreen("settings"); return; }
      if (typing || mod || e.altKey) return;
      if (e.key === "Escape") { setPopover(null); setMixer(false); if (fullscreen) setFullscreen(false); return; }
      const onSlider = !!t?.closest?.("[role=slider]");
      const onButton = !!t?.closest?.("button, [role=menuitem], .track-row, .album-card");
      if (e.code === "Space") { if (onButton) return; if (toggle()) e.preventDefault(); return; }
      if (e.key === "ArrowLeft" && !onSlider) { e.preventDefault(); seekBy(e.shiftKey ? -30 : -5); }
      else if (e.key === "ArrowRight" && !onSlider) { e.preventDefault(); seekBy(e.shiftKey ? 30 : 5); }
      else if (e.key === "ArrowUp" && !onSlider && screenRef.current !== "home" && screenRef.current !== "settings") { e.preventDefault(); setVolume(settings.get().volume + 0.05); }
      else if (e.key === "ArrowDown" && !onSlider && screenRef.current !== "home" && screenRef.current !== "settings") { e.preventDefault(); setVolume(settings.get().volume - 0.05); }
      else if (k === "m") toggleMute();
      else if (k === "f") setFullscreen(!fullscreen);
      else if (k === "s") { if (screenRef.current === "video") setPopover((p) => (p === "subtitles" ? null : "subtitles")); }
      else if (k === "q") setPopover((p) => (p ? null : screenRef.current === "video" ? "quality" : "audio"));
      else if (e.key === "[") setRate(player.get().rate - 0.25);
      else if (e.key === "]") setRate(player.get().rate + 0.25);
      else if (k === "n") void next();
      else if (k === "p") void prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, onboarding, fullscreen]);

  const mini = s.miniPlayer;
  const showMini = !fullscreen && mini !== "hidden" && screen !== "music" && screen !== "video" && (mini === "always" || !!player.get().currentId || true) ;
  const hasCurrent = player.use((p) => !!p.currentId);
  const miniVisible = showMini && (mini === "always" || hasCurrent);

  const cls = [
    "app", `theme-${s.theme === "custom" ? "custom" : s.theme}`,
    fullscreen ? "is-fullscreen" : "",
    s.reducedEffects ? "reduce-effects" : "", s.reducedMotion ? "reduced-motion" : "", !s.animations ? "no-anim" : "",
    s.density === "compact" ? "compact" : "",
  ].join(" ");

  return (
    <div className={cls} onContextMenu={(e) => { if (!(e.target as HTMLElement).closest("input, textarea")) e.preventDefault(); }}>
      {!fullscreen && <WindowChrome />}
      <WallpaperLayer />
      <div className="noise" />
      <div className="app-shell">
        {!fullscreen && <Sidebar screen={screen} setScreen={setScreen} />}
        <div className="main-column">
          {screen === "home" && <Home setScreen={setScreen} search={search} setSearch={setSearch} />}
          {screen === "music" && <MusicPlayer setPopover={setPopover} setMixer={setMixer} setScreen={setScreen} />}
          {screen === "video" && <VideoPlayer popover={popover} setPopover={setPopover} fullscreen={fullscreen} setFullscreen={setFullscreen} setScreen={setScreen} />}
          {screen === "playlists" && <Playlists setScreen={setScreen} />}
          {screen === "settings" && <Settings onReplayOnboarding={() => setOnboarding(1)} />}
          {screen === "specs" && <Specs />}
          {miniVisible && <MiniPlayer setScreen={setScreen} setMixer={setMixer} />}
        </div>
      </div>
      {popover === "audio" && <AudioPopover close={() => setPopover(null)} />}
      {popover === "queue" && <QueueDrawer close={() => setPopover(null)} />}
      {mixer && <Mixer close={() => setMixer(false)} />}
      <ContextMenu />
      <DialogHost />
      <Toasts />
      {onboarding && <Onboarding step={onboarding} setStep={setOnboarding} finish={() => { update({ onboarded: true }); setOnboarding(null); }} />}
      {drag && <DragOverlay status={drag.status} message={drag.message} />}
      {locked && <LockScreen onUnlock={() => setLocked(false)} />}
    </div>
  );
}
