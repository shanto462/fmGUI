// Settings: folders the file tools may use.

import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Folder, FolderPlus, Minus, Search } from "lucide-react";
import { Button, Callout, IconButton, Section } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { baseName, tildePath } from "../../lib/paths";
import { useApp } from "../../lib/store";
import type { AppConfig } from "../../lib/types";
import { useSaveConfig } from "../overview/hooks";
import { IconTile } from "../overview/shared";

export default function FoldersSection(props: { config: AppConfig }) {
  const folders = props.config.allowedFolders;
  const home = useApp((s) => s.paths?.homeDir);
  const toast = useApp((s) => s.toast);
  const save = useSaveConfig();

  const add = async () => {
    try {
      const picked = await open({
        directory: true,
        multiple: true,
        title: "Choose folders for file tools",
        defaultPath: home ?? undefined,
      });
      if (!picked) return;
      const list = Array.isArray(picked) ? picked : [picked];
      const fresh = list.filter((p) => !folders.includes(p));
      if (!fresh.length) {
        toast("That folder is already in the list.", "info");
        return;
      }
      await save(
        (c) => {
          c.allowedFolders = [...c.allowedFolders, ...fresh.filter((p) => !c.allowedFolders.includes(p))];
        },
        fresh.length === 1 ? "Folder added" : `${fresh.length} folders added`,
      );
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const remove = (path: string) =>
    save((c) => {
      c.allowedFolders = c.allowedFolders.filter((f) => f !== path);
    }, "Folder removed");

  const reveal = async (path: string) => {
    try {
      await revealItemInDir(path);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const tooWide = folders.some(
    (f) => f === "/" || (home != null && f.replace(/\/+$/, "") === home.replace(/\/+$/, "")),
  );

  return (
    <Section title="Allowed folders">
      <div className="group">
        {folders.length === 0 && (
          <div className="group__row">
            <IconTile color="gray" size="sm">
              <Folder />
            </IconTile>
            <div className="group__label">
              <div>No folders yet</div>
              <div className="group__hint">File tools cannot read or write any files until you add a folder.</div>
            </div>
          </div>
        )}
        {folders.map((f) => (
          <div key={f} className="group__row">
            <IconTile color="blue" size="sm">
              <Folder />
            </IconTile>
            <div className="group__label">
              <div className="truncate">{baseName(f)}</div>
              <div className="group__hint truncate mono selectable" title={tildePath(f, home)}>
                {tildePath(f, home)}
              </div>
            </div>
            <IconButton label="Show in Finder" onClick={() => reveal(f)}>
              <Search size={14} />
            </IconButton>
            <IconButton label="Remove folder" onClick={() => void remove(f)}>
              <Minus size={15} />
            </IconButton>
          </div>
        ))}
        <div className="group__row">
          <Button size="sm" icon={<FolderPlus size={13} />} onClick={add}>
            Add folder…
          </Button>
        </div>
      </div>
      <p className="settings-note">File tools can only read and write inside these folders and the folders in them.</p>
      {tooWide && (
        <Callout tone="warning">
          One folder is your whole home folder or the whole disk. File tools can then reach all of your files. Pick
          smaller folders if you can.
        </Callout>
      )}
    </Section>
  );
}
