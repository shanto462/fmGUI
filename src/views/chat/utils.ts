// Small helpers shared by the Chat and CLI Sessions views.

import { newId } from "../../lib/api";
import { pickFiles } from "../../lib/dialogs";
import type { ChatMessage } from "../../lib/types";

/** Image types Chat and CLI Sessions accept. */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "heic", "gif", "webp", "tiff"];

export function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

/** Opens the system file picker for images. Returns [] when the user cancels. */
export function pickImagePaths(): Promise<string[]> {
  return pickFiles({ name: "Images", extensions: IMAGE_EXTENSIONS });
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
