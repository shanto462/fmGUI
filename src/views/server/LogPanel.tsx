// Monospaced, auto-scrolling log panel for the public `fm serve`. OWNER: agent "ui-build".

import { ScrollText } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Empty } from "../../components/ui";
import type { LogLine } from "../../lib/types";
import { stripAnsi } from "../playground/workbench";

function time(ts: number): string {
  const ms = ts < 1e12 ? ts * 1000 : ts; // seconds or milliseconds
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function LogPanel(props: { logs: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [props.logs]);

  if (props.logs.length === 0) {
    return (
      <Empty icon={<ScrollText size={28} />} title="No logs yet">
        Start the server. Everything fm serve prints shows up here.
      </Empty>
    );
  }

  return (
    <div
      ref={ref}
      className="sv-logs selectable"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
      }}
    >
      {props.logs.map((l, i) => (
        <div key={i} className="sv-log">
          <span className="sv-log__ts">{time(l.ts)}</span>
          <span className="sv-log__line">{stripAnsi(l.line)}</span>
        </div>
      ))}
    </div>
  );
}
