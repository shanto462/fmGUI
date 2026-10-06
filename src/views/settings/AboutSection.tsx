// Settings: run setup again, and About. OWNER: agent "ui-shell".

import { getVersion } from "@tauri-apps/api/app";
import { BookOpen, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Section } from "../../components/ui";
import { useApp } from "../../lib/store";
import { IconTile } from "../overview/shared";
import { SettingRow } from "./SettingRow";

const FALLBACK_VERSION = "0.1.0";

export function SetupSection() {
  const updateConfig = useApp((s) => s.updateConfig);
  const navigate = useApp((s) => s.navigate);

  const runAgain = async () => {
    const saved = await updateConfig((c) => {
      c.setupCompleted = false;
    });
    if (saved) navigate("setup");
  };

  return (
    <Section title="Setup">
      <div className="group">
        <SettingRow
          icon={<Wand2 />}
          color="pink"
          label="Setup Guide"
          hint="Walk through the checks again: fm, the model, the license and the chat engine."
        >
          <Button size="sm" onClick={runAgain}>
            Run setup again
          </Button>
        </SettingRow>
      </div>
    </Section>
  );
}

export function AboutSection() {
  const navigate = useApp((s) => s.navigate);
  const [version, setVersion] = useState(FALLBACK_VERSION);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  return (
    <Section title="About">
      <div className="card settings-about">
        <IconTile color="accent" size="xl">
          <Sparkles />
        </IconTile>
        <div className="settings-about__name">fmGUI</div>
        <div className="small muted">Version {version}</div>
        <p className="settings-about__text">
          A Mac app for Apple's on-device Foundation Models. It runs the fm tool that comes with macOS 27. Everything
          stays on this Mac.
        </p>
        <Button icon={<BookOpen size={14} />} onClick={() => navigate("docs")}>
          Read the docs
        </Button>
      </div>
    </Section>
  );
}
