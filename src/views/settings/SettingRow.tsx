// Row layout for grouped settings, plus a draft-value hook. OWNER: agent "ui-shell".

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "../../components/ui";
import { IconTile, type TileColor } from "../overview/shared";

export function SettingRow(props: {
  icon?: ReactNode;
  color?: TileColor;
  label: ReactNode;
  hint?: ReactNode;
  /** Control under the label instead of on the right (for wide inputs). */
  stacked?: boolean;
  children?: ReactNode;
}) {
  const head = (
    <>
      {props.icon && (
        <IconTile color={props.color ?? "gray"} size="sm">
          {props.icon}
        </IconTile>
      )}
      <div className="group__label">
        <div className="settings-row__label">{props.label}</div>
        {props.hint && <div className="group__hint">{props.hint}</div>}
      </div>
    </>
  );
  if (props.stacked) {
    return (
      <div className={cx("group__row", "settings-row--stacked")}>
        <div className="settings-row__head">{head}</div>
        {props.children}
      </div>
    );
  }
  return (
    <div className="group__row">
      {head}
      {props.children != null && <div className="settings-row__control">{props.children}</div>}
    </div>
  );
}

/** Local copy of a saved value. It resets when the saved value changes. */
export function useDraft<T>(value: T): [T, (v: T) => void] {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return [draft, setDraft];
}
