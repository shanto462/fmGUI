// Settings, grouped like System Settings. Changes save right away. OWNER: agent "ui-shell".

import { Page } from "../components/ui";
import { useApp } from "../lib/store";
import { AboutSection, SetupSection } from "./settings/AboutSection";
import ChatSection from "./settings/ChatSection";
import DataSection from "./settings/DataSection";
import EngineSection from "./settings/EngineSection";
import FmSection from "./settings/FmSection";
import FoldersSection from "./settings/FoldersSection";
import "./SettingsView.css";

export default function SettingsView() {
  const config = useApp((s) => s.config);
  if (!config) return null;

  return (
    <Page title="Settings" subtitle="Changes save right away">
      <div className="settings">
        <FmSection config={config} />
        <ChatSection config={config} />
        <FoldersSection config={config} />
        <EngineSection />
        <DataSection />
        <SetupSection />
        <AboutSection />
      </div>
    </Page>
  );
}
