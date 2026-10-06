// Small helpers shared by the Chat and CLI Sessions views. OWNER: agent "ui-chat".

import { open } from "@tauri-apps/plugin-dialog";
import { newId } from "../../lib/api";
import type { ChatMessage } from "../../lib/types";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "heic", "gif", "webp", "tiff"];

export function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Opens the system file picker for images. Returns [] when the user cancels. */
export async function pickImagePaths(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
  });
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

/** Image files from a paste or drop. */
export function imageFiles(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((f) => f.type.startsWith("image/"));
}

export function prettyJson(value: unknown): string {
  if (value === undefined || value === null) return "{}";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function isEmptyArgs(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "object" && !Array.isArray(value)) return Object.keys(value as object).length === 0;
  return false;
}

export function blankMessage(role: ChatMessage["role"], patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `temp-${newId()}`,
    role,
    text: "",
    images: [],
    steps: [],
    skillsUsed: [],
    createdAt: Date.now(),
    usage: null,
    durationMs: null,
    error: null,
    ...patch,
  };
}

export const isTempId = (id: string) => id.startsWith("temp-");

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
