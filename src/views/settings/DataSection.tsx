// Settings: data folders with "Show in Finder" buttons. OWNER: agent "ui-shell".

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FileCog, FolderOpen, History, MessageSquare, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Callout, Section, Spinner } from "../../components/ui";
import { errorMessage, getPaths } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { PathsInfo } from "../../lib/types";
import { tildify, type TileColor } from "../overview/shared";
import { SettingRow } from "./SettingRow";

const ROWS: { key: keyof PathsInfo; label: string; hint: string; icon: ReactNode; color: TileColor }[] = [
  { key: "dataDir", label: "App data", hint: "Everything fmGUI saves.", icon: <FolderOpen />, color: "blue" },
  { key: "chatsDir", label: "Chats", hint: "Your chats with tools.", icon: <MessageSquare />, color: "green" },
  { key: "skillsDir", label: "Skills", hint: "One folder per skill.", icon: <Sparkles />, color: "orange" },
  {
    key: "cliSessionsDir",
    label: "CLI sessions",
    hint: "Shared with fm chat in Terminal.",
    icon: <History />,
    color: "indigo",
  },
  { key: "configFile", label: "Settings file", hint: "This page, saved as JSON.", icon: <FileCog />, color: "gray" },
];

export default function DataSection() {
  const storePaths = useApp((s) => s.paths);
  const toast = useApp((s) => s.toast);
  const [paths, setPaths] = useState<PathsInfo | null>(storePaths);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (storePaths) {
      setPaths(storePaths);
      return;
    }
    let alive = true;
    getPaths()
      .then((p) => alive && setPaths(p))
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [storePaths]);

  const reveal = async (path: string) => {
    try {
      await revealItemInDir(path);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <Section title="Data">
      {error && <Callout tone="error">{error}</Callout>}
      {!paths && !error && (
        <div className="row muted small">
          <Spinner /> Loading folders…
        </div>
      )}
      {paths && (
        <div className="group">
          {ROWS.map((r) => (
            <SettingRow
              key={r.key}
              icon={r.icon}
              color={r.color}
              label={r.label}
              hint={
                <>
                  {r.hint}{" "}
                  <span className="mono selectable settings-path" title={paths[r.key]}>
                    {tildify(paths[r.key], paths.homeDir)}
                  </span>
                </>
              }
            >
              <Button size="sm" onClick={() => reveal(paths[r.key])}>
                Show in Finder
              </Button>
            </SettingRow>
          ))}
        </div>
      )}
    </Section>
  );
}
