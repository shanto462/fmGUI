// Settings: data folders with "Show in Finder" buttons.

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FileCog, FolderOpen, History, MessageSquare, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Section } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { tildePath } from "../../lib/paths";
import { useApp } from "../../lib/store";
import type { PathsInfo } from "../../lib/types";
import type { TileColor } from "../overview/shared";
import { SettingRow } from "./SettingRow";

type PathKey = "dataDir" | "chatsDir" | "skillsDir" | "cliSessionsDir" | "configFile";

const ROWS: { key: PathKey; label: string; hint: string; icon: ReactNode; color: TileColor }[] = [
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
  // The store loads the paths before any page opens.
  const paths: PathsInfo | null = useApp((s) => s.paths);
  const toast = useApp((s) => s.toast);

  const reveal = async (path: string) => {
    try {
      await revealItemInDir(path);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <Section title="Data">
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
                  <span className="mono selectable settings-path" title={tildePath(paths[r.key], paths.homeDir)}>
                    {tildePath(paths[r.key], paths.homeDir)}
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
