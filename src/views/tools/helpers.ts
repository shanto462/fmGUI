// Plain helpers for the Tools, MCP Servers and Skills pages.

import type { AppConfig, Approval, Skill, SkillMode, ToolInfo } from "../../lib/types";

/** Estimate for a tool: its JSON schema plus its description, about 4 characters per token. */
export function toolTokenEstimate(inputSchema: unknown, description: string, name = ""): number {
  let schema = "";
  try {
    schema = JSON.stringify(inputSchema ?? {}) ?? "";
  } catch {
    // A schema that cannot be turned into JSON counts as empty.
  }
  return Math.ceil((schema.length + description.length + name.length) / 4);
}

export const skillMode = (config: AppConfig, name: string): SkillMode => config.skills[name]?.mode ?? "onDemand";

export const APPROVAL_OPTIONS: { value: Approval; label: string }[] = [
  { value: "ask", label: "Ask every time" },
  { value: "always", label: "Always allow" },
];

export interface Budget {
  toolTokens: number;
  skillTokens: number;
  total: number;
  contextSize: number;
  ratio: number;
  toolCount: number;
  alwaysSkills: number;
  toolsOff: boolean;
}

/** How much of the context the enabled tools and always-on skills use on every request. */
export function computeBudget(config: AppConfig, tools: ToolInfo[] | null, skills: Skill[] | null): Budget {
  const toolsOff = !config.chatDefaults.toolsEnabled;
  const enabledTools = (tools ?? []).filter((t) => t.enabled);
  const toolTokens = toolsOff ? 0 : enabledTools.reduce((sum, t) => sum + (t.tokenEstimate || 0), 0);
  const always = (skills ?? []).filter((s) => skillMode(config, s.name) === "always");
  const skillTokens = always.reduce((sum, s) => sum + (s.tokenEstimate || 0), 0);
  const total = toolTokens + skillTokens;
  const contextSize = config.contextSize > 0 ? config.contextSize : 8192;
  return {
    toolTokens,
    skillTokens,
    total,
    contextSize,
    ratio: total / contextSize,
    toolCount: toolsOff ? 0 : enabledTools.length,
    alwaysSkills: always.length,
    toolsOff,
  };
}
