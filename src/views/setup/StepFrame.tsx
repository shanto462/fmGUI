// Common layout for one setup step: big icon, title, lead text, content.

import type { ReactNode } from "react";
import { IconTile, type TileColor } from "../overview/shared";

export function StepFrame(props: {
  icon: ReactNode;
  color: TileColor;
  title: ReactNode;
  lead: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="setup-step">
      <div className="setup-step__hero">
        <IconTile color={props.color} size="lg">
          {props.icon}
        </IconTile>
        <h1 className="setup-step__title">{props.title}</h1>
        <p className="setup-step__lead">{props.lead}</p>
      </div>
      {props.children && <div className="setup-step__content">{props.children}</div>}
    </div>
  );
}

/** A numbered list of simple instructions. */
export function HowTo(props: { items: { title: ReactNode; text?: ReactNode }[] }) {
  return (
    <ol className="setup-howto">
      {props.items.map((item, i) => (
        <li key={i}>
          <div>
            <div className="setup-howto__title">{item.title}</div>
            {item.text && <div className="setup-howto__text">{item.text}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
