import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteObject, listObjects } from "./b2";
import { MEDIA_ROUTE_PREFIX, storagePathFromMediaUrl } from "./storage-paths";
import { assetPreviewUrl } from "./creative/remotion";

/**
 * The media gallery: every file in a user's storage folder, with what each one
 * is and what still uses it.
 *
 * The listing comes from storage itself, not the database, so it shows what
 * is really there - including files nothing points at any more, which are
 * exactly the ones worth deleting. Database rows only label them.
 */

export type MediaType = "image" | "video" | "audio" | "font" | "other";

export interface MediaUse {
  kind: "asset" | "preview" | "render" | "video" | "character";
  label: string;
  projectId: string | null;
  projectTitle: string | null;
}

export interface MediaItem {
  path: string;
  /** Same-origin URL; the media route signs it on request. */
  url: string;
  name: string;
  folder: string;
  type: MediaType;
  size: number;
  modifiedMs: number;
  uses: MediaUse[];
  /** Projects whose timeline places this file. It cannot be deleted while any do. */
  placedIn: Array<{ id: string; title: string }>;
}

export interface MediaRows {
  assets: Array<{ id: string; url: string | null; kind: string | null; asset_class: string | null; filename: string | null; project_id: string | null; metadata: unknown }>;
  renders: Array<{ id: string; output_url: string | null; project_id: string | null }>;
  videos: Array<{ id: string; video_url: string | null; prompt: string | null; characters: unknown }>;
  projects: Array<{ id: string; title: string | null; document: unknown }>;
}

export interface StoredFile {
  key: string;
  size: number;
  lastModifiedMs: number;
}

const EXTENSION_TYPES: Array<[RegExp, MediaType]> = [
  [/\.(png|jpe?g|webp|gif|avif|svg)$/i, "image"],
  [/\.(mp4|mov|webm|m4v|mkv)$/i, "video"],
  [/\.(mp3|wav|m4a|aac|ogg|opus|flac)$/i, "audio"],
  [/\.(ttf|otf|woff2?)$/i, "font"],
];

const FOLDER_TYPES: Record<string, MediaType> = {
  videos: "video",
  renders: "video",
  audio: "audio",
  images: "image",
  characters: "image",
};

/** Whether `path` is a file the user may delete: inside their folder, nothing climbing out. */
export function isOwnedMediaPath(userId: string, path: unknown): path is string {
  if (typeof path !== "string" || !userId) return false;
  const prefix = `${userId}/`;
  if (!path.startsWith(prefix) || path.length === prefix.length) return false;
  return !path.slice(prefix.length).split("/").some((segment) => segment === ".." || segment === "." || segment === "");
}

function mediaTypeFor(path: string, folder: string, assetKind: string | null | undefined): MediaType {
  if (assetKind === "image" || assetKind === "video" || assetKind === "audio" || assetKind === "font") return assetKind;
  for (const [pattern, type] of EXTENSION_TYPES) if (pattern.test(path)) return type;
  return FOLDER_TYPES[folder] ?? "other";
}

function assetLabel(asset: MediaRows["assets"][number]): string | null {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? (asset.metadata as Record<string, unknown>) : {};
  const label = typeof metadata.label === "string" ? metadata.label.trim() : "";
  return label || asset.filename || null;
}

function characterUrls(characters: unknown): string[] {
  if (!Array.isArray(characters)) return [];
  return characters.map((character) => String((character as { url?: unknown } | null)?.url ?? "")).filter(Boolean);
}

/** Which rows point at each stored path, keyed by path. */
function indexRows(rows: MediaRows) {
  const titles = new Map(rows.projects.map((project) => [project.id, project.title || "Untitled creative"]));
  // An asset is placed on a project when its id appears anywhere in that
  // project's document: elements, audio clips, fonts, nested composites.
  // Ids are UUIDs, so a text match cannot misfire.
  const documents = rows.projects.map((project) => ({ id: project.id, text: JSON.stringify(project.document ?? null) }));

  const uses = new Map<string, MediaUse[]>();
  const placed = new Map<string, Map<string, string>>();
  const assetIds = new Map<string, string[]>();
  const renderIds = new Map<string, string[]>();
  const videoIds = new Map<string, string[]>();
  const companions = new Map<string, string[]>();
  const add = <T>(map: Map<string, T[]>, path: string, value: T) => map.set(path, [...(map.get(path) ?? []), value]);

  for (const asset of rows.assets) {
    const path = storagePathFromMediaUrl(asset.url);
    if (!path) continue;
    add(assetIds, path, asset.id);
    add(uses, path, {
      kind: "asset",
      label: asset.asset_class ?? asset.kind ?? "asset",
      projectId: asset.project_id,
      projectTitle: asset.project_id ? titles.get(asset.project_id) ?? null : null,
    });
    // A large video's small preview copy belongs to it: labelled with it,
    // locked with it, and deleted with it.
    const previewPath = storagePathFromMediaUrl(assetPreviewUrl(asset.metadata));
    if (previewPath) {
      add(uses, previewPath, {
        kind: "preview",
        label: "preview copy",
        projectId: asset.project_id,
        projectTitle: asset.project_id ? titles.get(asset.project_id) ?? null : null,
      });
      add(companions, path, previewPath);
    }
    for (const document of documents) {
      if (!document.text.includes(asset.id)) continue;
      for (const target of previewPath ? [path, previewPath] : [path]) {
        const projects = placed.get(target) ?? new Map<string, string>();
        projects.set(document.id, titles.get(document.id) ?? "Untitled creative");
        placed.set(target, projects);
      }
    }
  }
  for (const render of rows.renders) {
    const path = storagePathFromMediaUrl(render.output_url);
    if (!path) continue;
    add(renderIds, path, render.id);
    add(uses, path, {
      kind: "render",
      label: "render",
      projectId: render.project_id,
      projectTitle: render.project_id ? titles.get(render.project_id) ?? null : null,
    });
  }
  for (const video of rows.videos) {
    const path = storagePathFromMediaUrl(video.video_url);
    if (path) {
      add(videoIds, path, video.id);
      add(uses, path, { kind: "video", label: "generated video", projectId: null, projectTitle: null });
    }
    for (const url of characterUrls(video.characters)) {
      const characterPath = storagePathFromMediaUrl(url);
      if (characterPath) add(uses, characterPath, { kind: "character", label: "video reference", projectId: null, projectTitle: null });
    }
  }
  return { uses, placed, assetIds, renderIds, videoIds, companions };
}

/** Every stored file of the user's, newest first, labelled by the rows that use it. */
export function buildMediaLibrary(userId: string, files: StoredFile[], rows: MediaRows): MediaItem[] {
  const index = indexRows(rows);
  const names = new Map<string, string>();
  for (const asset of rows.assets) {
    const path = storagePathFromMediaUrl(asset.url);
    const label = assetLabel(asset);
    if (path && label && !names.has(path)) names.set(path, label);
  }
  const assetKinds = new Map(rows.assets.map((asset) => [storagePathFromMediaUrl(asset.url), asset.kind]));

  return files
    .filter((file) => isOwnedMediaPath(userId, file.key))
    .map((file) => {
      const relative = file.key.slice(userId.length + 1);
      const folder = relative.includes("/") ? relative.slice(0, relative.indexOf("/")) : "";
      const placedIn = [...(index.placed.get(file.key) ?? new Map()).entries()].map(([id, title]) => ({ id, title }));
      return {
        path: file.key,
        url: `${MEDIA_ROUTE_PREFIX}${file.key.split("/").map(encodeURIComponent).join("/")}`,
        name: names.get(file.key) ?? relative.slice(relative.lastIndexOf("/") + 1),
        folder,
        type: mediaTypeFor(file.key, folder, assetKinds.get(file.key)),
        size: file.size,
        modifiedMs: file.lastModifiedMs,
        uses: index.uses.get(file.key) ?? [],
        placedIn,
      };
    })
    .sort((a, b) => b.modifiedMs - a.modifiedMs);
}

export interface MediaDeletionPlan {
  deletable: string[];
  blocked: Array<{ path: string; projects: string[] }>;
  rejected: string[];
  assetIds: string[];
  renderIds: string[];
  videoIds: string[];
}

/**
 * What deleting `paths` takes with it. A file a project's timeline still
 * places is refused, not pulled out from under the project: the editor and
 * every render would break on the missing asset. Everything else goes with
 * the rows that describe it, so no list shows a file that is gone.
 */
export function planMediaDeletion(userId: string, paths: string[], rows: MediaRows): MediaDeletionPlan {
  const index = indexRows(rows);
  const plan: MediaDeletionPlan = { deletable: [], blocked: [], rejected: [], assetIds: [], renderIds: [], videoIds: [] };
  for (const path of new Set(paths)) {
    if (!isOwnedMediaPath(userId, path)) {
      plan.rejected.push(String(path));
      continue;
    }
    const projects = index.placed.get(path);
    if (projects && projects.size > 0) {
      plan.blocked.push({ path, projects: [...projects.values()] });
      continue;
    }
    if (!plan.deletable.includes(path)) plan.deletable.push(path);
    for (const companion of index.companions.get(path) ?? []) {
      if (!plan.deletable.includes(companion)) plan.deletable.push(companion);
    }
    plan.assetIds.push(...(index.assetIds.get(path) ?? []));
    plan.renderIds.push(...(index.renderIds.get(path) ?? []));
    plan.videoIds.push(...(index.videoIds.get(path) ?? []));
  }
  return plan;
}

export async function loadMediaRows(supabase: SupabaseClient, userId: string): Promise<MediaRows> {
  const [assets, renders, videos, projects] = await Promise.all([
    supabase.from("creative_assets").select("id, url, kind, asset_class, filename, project_id, metadata").eq("user_id", userId),
    supabase.from("creative_render_jobs").select("id, output_url, project_id").eq("user_id", userId),
    supabase.from("video_generations").select("id, video_url, prompt, characters").eq("user_id", userId),
    supabase.from("creative_projects").select("id, title, document").eq("user_id", userId),
  ]);
  for (const result of [assets, renders, videos, projects]) {
    if (result.error) throw new Error(result.error.message);
  }
  return {
    assets: (assets.data ?? []) as MediaRows["assets"],
    renders: (renders.data ?? []) as MediaRows["renders"],
    videos: (videos.data ?? []) as MediaRows["videos"],
    projects: (projects.data ?? []) as MediaRows["projects"],
  };
}

export async function loadMediaLibrary(supabase: SupabaseClient, userId: string): Promise<MediaItem[]> {
  const [files, rows] = await Promise.all([listObjects(`${userId}/`), loadMediaRows(supabase, userId)]);
  return buildMediaLibrary(userId, files, rows);
}

/**
 * Deletes files from the gallery. Rows go first, then files: a file that then
 * fails to delete is only wasted space, while the other order could leave a
 * row pointing at nothing.
 */
export async function deleteMediaPaths(
  supabase: SupabaseClient,
  userId: string,
  paths: string[],
): Promise<{ deleted: number; blocked: MediaDeletionPlan["blocked"]; failed: number }> {
  const rows = await loadMediaRows(supabase, userId);
  const plan = planMediaDeletion(userId, paths, rows);
  if (plan.rejected.length > 0) throw new Error("Some of those files are not in your storage");

  const removals = [
    plan.assetIds.length ? supabase.from("creative_assets").delete().in("id", plan.assetIds).eq("user_id", userId) : null,
    plan.renderIds.length ? supabase.from("creative_render_jobs").delete().in("id", plan.renderIds).eq("user_id", userId) : null,
    plan.videoIds.length ? supabase.from("video_generations").delete().in("id", plan.videoIds).eq("user_id", userId) : null,
  ];
  for (const result of await Promise.all(removals)) {
    if (result?.error) throw new Error(result.error.message);
  }

  let deleted = 0;
  const queue = [...plan.deletable];
  await Promise.all(
    Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (let path = queue.shift(); path; path = queue.shift()) {
        const ok = await deleteObject(path).catch((cause) => {
          console.error(`[media] could not delete ${path}: ${cause instanceof Error ? cause.message : cause}`);
          return false;
        });
        if (ok) deleted += 1;
      }
    }),
  );
  return { deleted, blocked: plan.blocked, failed: plan.deletable.length - deleted };
}
