import { type Item, addToPlaylist, createPlaylist, describeImport, getItem, importPicked, library, relink, removeFromPlaylist, removeItems, toggleFavorite } from "./lib/library";
import { enqueue, loadSubtitleFile, player, playIds, playOne } from "./lib/engine";
import { type Picked, kindOf, pickFolder, pickMediaFiles } from "./lib/platform";
import { toast } from "./lib/store";
import { type MenuItem, askConfirm, askText } from "./components/overlays";

/** Imports picked files and (for explicit opens/drops) starts playing them. */
export async function handlePicked(picked: Picked[], play: boolean) {
  if (!picked.length) return;
  const media = picked.filter((p) => { const k = kindOf(p.ext); return k === "audio" || k === "video"; });
  const subs = picked.filter((p) => kindOf(p.ext) === "sub");
  if (!media.length && subs.length) {
    const cur = player.get().currentId && getItem(player.get().currentId!);
    if (cur && cur.kind === "video") await loadSubtitleFile(subs[0]);
    else toast("Open a video first, then add its subtitles.");
    return;
  }
  const r = await importPicked(picked);
  toast(describeImport(r));
  if (play && r.ids.length) {
    const playable = r.ids.filter((id) => getItem(id));
    if (playable.length) await playIds(playable, 0);
  }
}
export async function openFiles() {
  try { await handlePicked(await pickMediaFiles(), true); } catch (e) { toast(`Could not open files: ${(e as Error).message}`); }
}
export async function openFolder() {
  try { await handlePicked(await pickFolder(), false); } catch (e) { toast(`Could not open folder: ${(e as Error).message}`); }
}
export async function locateItem(id: string) {
  const picked = await pickMediaFiles();
  const p = picked.find((x) => kindOf(x.ext) !== "sub");
  if (p) await relink(id, p);
}
export async function newPlaylistWith(ids: string[]) {
  const name = await askText("New playlist", "", "Create");
  if (!name) return;
  createPlaylist(name, ids);
  toast(`Playlist “${name}” created`);
}

export function itemMenu(it: Item, opts: { context?: string[]; playlistId?: string } = {}): MenuItem[] {
  const pls = library.get().playlists;
  const fresh = () => getItem(it.id) ?? it;
  return [
    { label: "Play", icon: "play", onClick: () => void playOne(it.id, opts.context ?? [it.id]) },
    { label: "Play next", icon: "queue", onClick: () => enqueue([it.id], true) },
    { label: "Add to queue", icon: "plus", onClick: () => enqueue([it.id]) },
    { separator: true, label: "" },
    {
      label: "Add to playlist", icon: "playlist",
      children: [
        { label: "New playlist…", icon: "plus", onClick: () => void newPlaylistWith([it.id]) },
        ...pls.map((p) => ({ label: p.name, checked: p.items.includes(it.id), onClick: () => { const n = addToPlaylist(p.id, [it.id]); toast(n ? `Added to ${p.name}` : `Already in ${p.name}`); } })),
      ],
    },
    { label: fresh().favorite ? "Remove from favorites" : "Add to favorites", icon: "heart", onClick: () => toggleFavorite(it.id) },
    ...(fresh().missing ? [{ label: "Locate file…", icon: "folder" as const, onClick: () => void locateItem(it.id) }] : []),
    { separator: true, label: "" },
    ...(opts.playlistId ? [{ label: "Remove from playlist", icon: "close" as const, onClick: () => removeFromPlaylist(opts.playlistId!, it.id) }] : []),
    {
      label: "Remove from library", icon: "trash", danger: true,
      onClick: async () => {
        if (await askConfirm("Remove from library?", `“${it.title}” will be removed from Mono. The file on your computer is not deleted.`, "Remove", true)) await removeItems([it.id]);
      },
    },
  ];
}
