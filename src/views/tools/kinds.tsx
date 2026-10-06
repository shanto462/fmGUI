import { Globe, SquareTerminal, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import type { CustomKindType } from "./customTool";

/** Title, icon and colors for each kind of custom tool. */
export const KIND_INFO: Record<CustomKindType, { title: string; icon: ReactNode; tone: string; label: string }> = {
  shell: { title: "Shell command", icon: <SquareTerminal size={16} />, tone: "dark", label: "Shell" },
  http: { title: "HTTP request", icon: <Globe size={16} />, tone: "blue", label: "HTTP" },
  shortcut: { title: "Apple Shortcut", icon: <Workflow size={16} />, tone: "pink", label: "Shortcut" },
};
