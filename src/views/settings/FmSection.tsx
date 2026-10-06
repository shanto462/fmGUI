// Settings: fm binary path and context size. OWNER: agent "ui-shell".

import { Gauge, RefreshCw, TerminalSquare } from "lucide-react";
import { useRef } from "react";
import { Button, Chip, Section, StatusDot, TextInput, formatNumber } from "../../components/ui";
import { useApp } from "../../lib/store";
import type { AppConfig } from "../../lib/types";
import { macosLabel, useSaveConfig } from "../overview/shared";
import { SettingRow, useDraft } from "./SettingRow";

const DEFAULT_PATH = "/usr/bin/fm";
const MIN_CONTEXT = 1024;
const MAX_CONTEXT = 65536;

export default function FmSection(props: { config: AppConfig }) {
  const { config } = props;
  const status = useApp((s) => s.status);
  const loading = useApp((s) => s.statusLoading);
  const refreshStatus = useApp((s) => s.refreshStatus);
  const toast = useApp((s) => s.toast);
  const save = useSaveConfig();

  const [path, setPath] = useDraft(config.fmPath);
  const [context, setContext] = useDraft(String(config.contextSize));
  const savingPath = useRef<string | null>(null);

  /** Saves the path when it changed, then checks fm again. */
  const savePath = async () => {
    const next = path.trim() || DEFAULT_PATH;
    setPath(next);
    if (next === config.fmPath || savingPath.current === next) return;
    savingPath.current = next;
    const saved = await save((c) => {
      c.fmPath = next;
    });
    savingPath.current = null;
    if (saved) await refreshStatus();
  };

  const recheck = async () => {
    // A blur may have started the save already; it re-checks on its own.
    if (savingPath.current) return;
    const next = path.trim() || DEFAULT_PATH;
    if (next !== config.fmPath) await savePath();
    else await refreshStatus();
  };

  const resetPath = async () => {
    setPath(DEFAULT_PATH);
    const saved = await save((c) => {
      c.fmPath = DEFAULT_PATH;
    });
    if (saved) await refreshStatus();
  };

  const saveContext = async (raw: string) => {
    const n = Number(raw.replace(/[,\s]/g, ""));
    if (!Number.isInteger(n) || n < MIN_CONTEXT || n > MAX_CONTEXT) {
      toast(`Enter a whole number between ${formatNumber(MIN_CONTEXT)} and ${formatNumber(MAX_CONTEXT)}.`, "error");
      setContext(String(config.contextSize));
      return;
    }
    setContext(String(n));
    if (n !== config.contextSize) {
      await save((c) => {
        c.contextSize = n;
      });
    }
  };

  return (
    <Section title="fm tool and model">
      <div className="group">
        <SettingRow
          icon={<TerminalSquare />}
          color="gray"
          label="fm path"
          hint={`Where the fm command line tool lives. The default is ${DEFAULT_PATH}.`}
          stacked
        >
          <div className="row">
            <TextInput
              className="mono"
              value={path}
              placeholder={DEFAULT_PATH}
              onChange={(e) => setPath(e.target.value)}
              onBlur={() => void savePath()}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <Button icon={<RefreshCw size={13} />} loading={loading} onClick={recheck}>
              Check again
            </Button>
          </div>
          <div className="row small settings-status">
            {loading ? (
              <span className="muted">Checking…</span>
            ) : !status ? (
              <span className="muted">Not checked yet. Click Check again.</span>
            ) : status.binaryFound ? (
              <>
                <StatusDot tone="green" />
                <span>Found. {macosLabel(status)}.</span>
              </>
            ) : (
              <>
                <StatusDot tone="red" />
                <span>Not found at this path. fm ships with macOS 27.</span>
              </>
            )}
            <div className="spacer" />
            {config.fmPath !== DEFAULT_PATH && (
              <Button size="sm" variant="plain" onClick={resetPath}>
                Use default
              </Button>
            )}
          </div>
        </SettingRow>

        <SettingRow
          icon={<Gauge />}
          color="yellow"
          label="Context size"
          hint="Tokens the model can see at once. Most Macs use 8,192. Some Macs use 4,096. Chat trims old messages to fit."
        >
          <Chip on={config.contextSize === 4096} onClick={() => void saveContext("4096")}>
            4,096
          </Chip>
          <Chip on={config.contextSize === 8192} onClick={() => void saveContext("8192")}>
            8,192
          </Chip>
          <TextInput
            className="settings-number"
            inputMode="numeric"
            value={context}
            aria-label="Context size in tokens"
            onChange={(e) => setContext(e.target.value)}
            onBlur={(e) => void saveContext(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </SettingRow>
      </div>
    </Section>
  );
}
