// Schema Builder state, kept outside the component so it survives page switches.
// OWNER: agent "ui-build".

import { create } from "zustand";
import type { SchemaDefinition } from "../../lib/fmArgs";
import { PRESETS } from "./presets";

interface SchemaBuilderStore {
  def: SchemaDefinition;
  tryPrompt: string;
  setDef: (def: SchemaDefinition) => void;
  setTryPrompt: (text: string) => void;
}

export const useSchemaBuilder = create<SchemaBuilderStore>((set) => ({
  def: PRESETS[0].build(),
  tryPrompt: PRESETS[0].samplePrompt,
  setDef: (def) => set({ def }),
  setTryPrompt: (tryPrompt) => set({ tryPrompt }),
}));
