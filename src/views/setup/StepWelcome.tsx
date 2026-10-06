// Setup step 1: what fmGUI does, and the privacy note.

import { Lock, MessageSquare, Plug, Radio, Sparkles, TerminalSquare, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { IconTile, type TileColor } from "../overview/shared";
import { StepFrame } from "./StepFrame";

const FEATURES: { icon: ReactNode; color: TileColor; title: string; text: string }[] = [
  { icon: <MessageSquare />, color: "blue", title: "Chat", text: "Talk with Apple's on-device model." },
  {
    icon: <Wrench />,
    color: "gray",
    title: "Tools",
    text: "Let the model use a calculator, files, or your own scripts.",
  },
  { icon: <Plug />, color: "purple", title: "MCP servers", text: "Connect a server to add a set of tools at once." },
  { icon: <Sparkles />, color: "orange", title: "Skills", text: "Teach the model know-how with SKILL.md files." },
  {
    icon: <TerminalSquare />,
    color: "indigo",
    title: "CLI playground",
    text: "Try every fm option and see the exact command.",
  },
  { icon: <Radio />, color: "green", title: "API server", text: "Run an OpenAI style API on this Mac for your apps." },
];

export default function StepWelcome() {
  return (
    <StepFrame
      icon={<Sparkles />}
      color="accent"
      title="Welcome to fmGUI"
      lead={
        <>
          A friendly Mac app for Apple's on-device model. It uses <code>fm</code>, the command line tool that comes with
          macOS 27.
        </>
      }
    >
      <div className="setup-features">
        {FEATURES.map((f) => (
          <div key={f.title} className="card setup-feature">
            <IconTile color={f.color} size="md">
              {f.icon}
            </IconTile>
            <div>
              <div className="card__title">{f.title}</div>
              <p className="card__desc">{f.text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card setup-privacy">
        <IconTile color="green" size="md">
          <Lock />
        </IconTile>
        <div>
          <div className="card__title">Private by design</div>
          <p className="card__desc">
            Everything runs on this Mac. Your prompts, chats and files never leave it. No account and no cloud.
          </p>
        </div>
      </div>

      <p className="setup-note">Next, we check that your Mac is ready. It takes about a minute.</p>
    </StepFrame>
  );
}
