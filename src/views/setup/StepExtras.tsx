// Setup step 6 (optional): tools, MCP servers, skills. OWNER: agent "ui-shell".

import { ArrowRight, Gauge, Plug, Sparkles, Wand2, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { formatNumber } from "../../components/ui";
import { useApp, type Route } from "../../lib/store";
import { IconTile, type TileColor } from "../overview/shared";
import { StepFrame } from "./StepFrame";

const CARDS: { route: Route; icon: ReactNode; color: TileColor; title: string; text: string; cta: string }[] = [
  {
    route: "tools",
    icon: <Wrench />,
    color: "gray",
    title: "Tools",
    text: "Give the model actions, like a calculator, file access, or your own scripts.",
    cta: "Add a tool",
  },
  {
    route: "mcp",
    icon: <Plug />,
    color: "purple",
    title: "MCP Servers",
    text: "Connect a server to add a set of ready-made tools at once.",
    cta: "Add a server",
  },
  {
    route: "skills",
    icon: <Sparkles />,
    color: "orange",
    title: "Skills",
    text: "Save know-how in a SKILL.md file. The model loads it when it needs it.",
    cta: "Create a skill",
  },
];

export default function StepExtras() {
  const navigate = useApp((s) => s.navigate);
  const contextSize = useApp((s) => s.status?.contextSize || s.config?.contextSize || 8192);

  return (
    <StepFrame
      icon={<Wand2 />}
      color="teal"
      title="Make it yours"
      lead="This step is optional. Add tools, MCP servers or skills now, or come back any time from the sidebar."
    >
      <div className="setup-extras">
        {CARDS.map((c) => (
          <button key={c.route} type="button" className="card setup-extra" onClick={() => navigate(c.route, { openWizard: true })}>
            <IconTile color={c.color} size="md">
              {c.icon}
            </IconTile>
            <div className="card__title">{c.title}</div>
            <p className="card__desc">{c.text}</p>
            <span className="setup-extra__cta">
              {c.cta}
              <ArrowRight size={13} />
            </span>
          </button>
        ))}
      </div>

      <div className="card setup-privacy">
        <IconTile color="yellow" size="md">
          <Gauge />
        </IconTile>
        <div>
          <div className="card__title">Tip: the context window is small</div>
          <p className="card__desc">
            The model sees about {formatNumber(contextSize)} tokens at once (the 8K context). Every enabled tool and
            skill uses part of that space. Turn on only what you need.
          </p>
        </div>
      </div>
    </StepFrame>
  );
}
