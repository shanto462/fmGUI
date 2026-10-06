// Settings: defaults for new chats. OWNER: agent "ui-shell".

import { Footprints, MessageSquareText, Thermometer, Wrench } from "lucide-react";
import { useEffect, useRef } from "react";
import { Section, Select, TextArea, Toggle, formatNumber } from "../../components/ui";
import type { AppConfig } from "../../lib/types";
import { useSaveConfig } from "../overview/shared";
import { SettingRow, useDraft } from "./SettingRow";

const STEP_OPTIONS = Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
const DEFAULT_TEMPERATURE = 0.5;

export default function ChatSection(props: { config: AppConfig }) {
  const d = props.config.chatDefaults;
  const save = useSaveConfig();
  const [instructions, setInstructions] = useDraft(d.instructions);
  const [temperature, setTemperature] = useDraft(d.temperature ?? DEFAULT_TEMPERATURE);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const saveInstructions = () => {
    if (instructions === d.instructions) return;
    void save((c) => {
      c.chatDefaults.instructions = instructions;
    });
  };

  // The slider saves a moment after the user stops moving it.
  const onTemperature = (value: number) => {
    setTemperature(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void save((c) => {
        c.chatDefaults.temperature = value;
      });
    }, 450);
  };

  const customTemp = d.temperature != null;
  const approxTokens = Math.ceil(instructions.trim().length / 4);

  return (
    <Section title="Chat defaults">
      <div className="group">
        <SettingRow
          icon={<MessageSquareText />}
          color="blue"
          label="Instructions for new chats"
          hint="Tell the model how to behave. Short instructions leave more room for the chat."
          stacked
        >
          <TextArea
            rows={4}
            value={instructions}
            placeholder="For example: You are a helpful assistant. Answer in short, clear sentences."
            onChange={(e) => setInstructions(e.target.value)}
            onBlur={saveInstructions}
          />
          <div className="xsmall muted">
            {instructions.trim() ? `About ${formatNumber(approxTokens)} tokens. ` : ""}Saved when you click outside the box.
          </div>
        </SettingRow>

        <SettingRow
          icon={<Wrench />}
          color="gray"
          label="Use tools"
          hint="Let the model call enabled tools, MCP servers and skills. Turn off for plain chat."
        >
          <Toggle
            label="Use tools"
            checked={d.toolsEnabled}
            onChange={(v) =>
              void save((c) => {
                c.chatDefaults.toolsEnabled = v;
              })
            }
          />
        </SettingRow>

        <SettingRow
          icon={<Footprints />}
          color="teal"
          label="Max tool steps"
          hint="How many tool calls the model may make for one message (1 to 8)."
        >
          <Select
            value={String(Math.min(8, Math.max(1, d.maxToolSteps)))}
            options={STEP_OPTIONS}
            style={{ width: 72 }}
            onChange={(v) =>
              void save((c) => {
                c.chatDefaults.maxToolSteps = Number(v);
              })
            }
          />
        </SettingRow>

        <SettingRow
          icon={<Thermometer />}
          color="red"
          label="Custom temperature"
          hint={
            customTemp
              ? "Lower is more focused. Higher is more creative."
              : "Off uses the model's default. Turn on to choose your own."
          }
        >
          {customTemp && (
            <>
              <input
                type="range"
                className="settings-range"
                min={0}
                max={1}
                step={0.05}
                value={temperature}
                aria-label="Temperature"
                onChange={(e) => onTemperature(Number(e.target.value))}
              />
              <span className="settings-range__value mono">{temperature.toFixed(2)}</span>
            </>
          )}
          <Toggle
            label="Custom temperature"
            checked={customTemp}
            onChange={(on) =>
              void save((c) => {
                c.chatDefaults.temperature = on ? temperature : null;
              })
            }
          />
        </SettingRow>
      </div>
    </Section>
  );
}
