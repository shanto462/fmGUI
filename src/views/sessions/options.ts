import type { BuiltinCliTool, UseCase } from "../../lib/fmArgs";

/** fm respond options for continuing a CLI session. */
export interface CliRunOptions {
  tools: BuiltinCliTool[];
  greedy: boolean;
  useCase: UseCase;
}

export const DEFAULT_CLI_OPTIONS: CliRunOptions = { tools: [], greedy: false, useCase: "general" };

/** How many options differ from the defaults. */
export function countChanged(o: CliRunOptions): number {
  return o.tools.length + (o.greedy ? 1 : 0) + (o.useCase !== "general" ? 1 : 0);
}
