// Playground: build and run `fm respond` with every option.
// Layout: options inspector on the left, command + streamed output on the right.
// State lives in ./playground/store.ts so a run keeps going when you switch pages.

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button, Page } from "../components/ui";
import { DEFAULT_FM_PATH } from "../lib/fmArgs";
import { useApp } from "../lib/store";
import { PlaygroundForm } from "./playground/PlaygroundForm";
import { PlaygroundOutput } from "./playground/PlaygroundOutput";
import { startRun, stopRun, usePlayground } from "./playground/store";
import { Workbench } from "./playground/workbench";
import "./playground/playground.css";

export default function PlaygroundView() {
  const takeHandoff = useApp((s) => s.takeHandoff);
  const toast = useApp((s) => s.toast);
  const setForm = usePlayground((s) => s.setForm);
  const reset = usePlayground((s) => s.reset);
  const running = usePlayground((s) => s.running);

  // Schema Builder → Playground hand-off.
  useEffect(() => {
    const h = takeHandoff();
    if (h.playgroundSchema) {
      setForm({ schemaMode: "paste", schemaText: h.playgroundSchema });
      toast("Schema added to Structured output.", "success");
    }
  }, [takeHandoff, setForm, toast]);

  // ⌘↩ runs, ⌘. stops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const { config, paths } = useApp.getState();
        startRun(paths?.tmpDir ?? null, config?.fmPath || DEFAULT_FM_PATH);
      } else if (e.key === ".") {
        e.preventDefault();
        stopRun().then((err) => err && toast(err, "error"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast]);

  return (
    <Page title="Playground" subtitle="Run fm respond with every option and see the exact command." flush>
      <Workbench
        side={<PlaygroundForm />}
        sideFooter={
          <>
            <span className="xsmall muted" style={{ flex: 1 }}>
              ⌘↩ to run
            </span>
            <Button size="sm" icon={<RotateCcw size={12} />} onClick={reset} disabled={running}>
              Reset options
            </Button>
          </>
        }
      >
        <PlaygroundOutput />
      </Workbench>
    </Page>
  );
}
