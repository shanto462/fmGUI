// Image attachments of the composer, shared by the Chat page and Quick Chat:
// from the file picker, a dropped file path, or a pasted image.

import { useCallback, useState } from "react";
import { errorMessage, newId, readImageDataUrl } from "../../lib/api";
import { baseName } from "../../lib/paths";
import { useApp } from "../../lib/store";
import type { ComposerAttachment } from "./Composer";
import { pickImagePaths, readFileAsDataUrl } from "./utils";

export interface AttachmentOptions {
  /** Wraps the file picker (Quick Chat keeps its window open while the panel has the focus). */
  aroundPick?: (pick: () => Promise<string[]>) => Promise<string[]>;
}

export function useAttachments(options: AttachmentOptions = {}) {
  const toast = useApp((s) => s.toast);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const { aroundPick } = options;

  /** Shows a loading thumbnail for each item, then its image (or drops it with a toast). */
  const load = useCallback(
    (items: ComposerAttachment[], read: (index: number) => Promise<string>) => {
      setAttachments((a) => [...a, ...items]);
      items.forEach((item, i) => {
        read(i)
          .then((src) => setAttachments((a) => a.map((x) => (x.id === item.id ? { ...x, src, loading: false } : x))))
          .catch((err) => {
            setAttachments((a) => a.filter((x) => x.id !== item.id));
            toast(`Could not read ${item.name}. ${errorMessage(err)}`, "error");
          });
      });
    },
    [toast],
  );

  const addImagePaths = useCallback(
    (paths: string[]) =>
      load(
        paths.map((p) => ({ id: newId(), src: null, name: baseName(p), loading: true })),
        (i) => readImageDataUrl(paths[i]),
      ),
    [load],
  );

  const addFiles = useCallback(
    (files: File[]) =>
      load(
        files.map((f) => ({ id: newId(), src: null, name: f.name || "Pasted image", loading: true })),
        (i) => readFileAsDataUrl(files[i]),
      ),
    [load],
  );

  const pickImages = useCallback(async () => {
    try {
      const paths = await (aroundPick ? aroundPick(pickImagePaths) : pickImagePaths());
      if (paths.length) addImagePaths(paths);
    } catch (err) {
      toast(`Could not open the file picker. ${errorMessage(err)}`, "error");
    }
  }, [addImagePaths, aroundPick, toast]);

  const remove = useCallback((id: string) => setAttachments((a) => a.filter((x) => x.id !== id)), []);
  const clear = useCallback(() => setAttachments([]), []);

  /** Data URLs of the images that finished loading. */
  const images = attachments.filter((a) => a.src).map((a) => a.src!);

  return { attachments, images, addImagePaths, addFiles, pickImages, remove, clear };
}
