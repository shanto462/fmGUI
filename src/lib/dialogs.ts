// Native macOS open and save panels.

import { open, save } from "@tauri-apps/plugin-dialog";

/** Image types the fm CLI reads with --image. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "heic", "heif", "gif", "webp", "tif", "tiff", "bmp"];

interface FileFilter {
  title?: string;
  /** Name of the file type in the panel, like "Images". */
  name?: string;
  extensions?: string[];
}

const filters = (opts: FileFilter) =>
  opts.extensions ? [{ name: opts.name ?? "Files", extensions: opts.extensions }] : undefined;

/** Open panel for one file. Returns null when the user cancels. */
export async function pickFile(opts: FileFilter = {}): Promise<string | null> {
  const result = await open({ title: opts.title, multiple: false, directory: false, filters: filters(opts) });
  return typeof result === "string" ? result : null;
}

/** Open panel for many files. Returns [] when the user cancels. */
export async function pickFiles(opts: FileFilter = {}): Promise<string[]> {
  const result = await open({ title: opts.title, multiple: true, directory: false, filters: filters(opts) });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

/** Open panel for one folder. Returns null when the user cancels. */
export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title, defaultPath: defaultPath || undefined });
  return typeof picked === "string" ? picked : null;
}

/** Save panel. Returns null when the user cancels. */
export async function pickSavePath(opts: FileFilter & { defaultPath?: string }): Promise<string | null> {
  const result = await save({ title: opts.title, defaultPath: opts.defaultPath, filters: filters(opts) });
  return result ?? null;
}
