// Small components shared by the Setup, Overview and Settings views.

import { AlertCircle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Spinner } from "../../components/ui";
import { cx } from "../../lib/cx";
import type { CheckState } from "./status";
import "./shared.css";

export type TileColor =
  "accent" | "blue" | "indigo" | "purple" | "pink" | "red" | "orange" | "yellow" | "green" | "teal" | "gray";

/** A colored rounded square with a white glyph, like the icons in System Settings. */
export function IconTile(props: { color: TileColor; size?: "sm" | "md" | "lg" | "xl"; children: ReactNode }) {
  return (
    <span className={cx("shell-tile", `shell-tile--${props.color}`, `shell-tile--${props.size ?? "md"}`)} aria-hidden>
      {props.children}
    </span>
  );
}

function CheckIcon(props: { state: CheckState }) {
  switch (props.state) {
    case "ok":
      return <CheckCircle2 size={18} className="shell-check shell-check--ok" />;
    case "warn":
      return <AlertCircle size={18} className="shell-check shell-check--warn" />;
    case "bad":
      return <XCircle size={18} className="shell-check shell-check--bad" />;
    case "pending":
      return <Spinner />;
    default:
      return <CircleDashed size={18} className="shell-check" />;
  }
}

/** A `.group__row` with a check icon, a label and a value on the right. */
export function CheckRow(props: {
  state: CheckState;
  label: ReactNode;
  hint?: ReactNode;
  value?: ReactNode;
  mono?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="group__row shell-check-row">
      <CheckIcon state={props.state} />
      <div className="group__label">
        <div>{props.label}</div>
        {props.hint && <div className="group__hint">{props.hint}</div>}
      </div>
      {props.value != null && props.value !== "" && (
        <div className={cx("shell-check-row__value selectable", props.mono && "mono")}>{props.value}</div>
      )}
      {props.action}
    </div>
  );
}
