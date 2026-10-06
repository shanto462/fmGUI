// MCP server templates for the "Add MCP server" wizard.

import { Brain, Clock, FlaskConical, Folder, GitBranch, Globe, ListChecks, Server, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import type { KeyValue } from "../../lib/types";

export type Requirement = "node" | "npx" | "uvx";

export const REQUIREMENTS: Record<Requirement, { label: string; why: string; install: string }> = {
  node: { label: "Node.js", why: "Runs servers written in JavaScript.", install: "brew install node" },
  npx: {
    label: "npx",
    why: "Downloads and starts the server package. It comes with Node.js.",
    install: "brew install node",
  },
  uvx: { label: "uv (uvx)", why: "Downloads and starts servers written in Python.", install: "brew install uv" },
};

export interface McpTemplate {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  tone: string;
  needs: Requirement[];
  transport: "stdio" | "http";
  /** Default server name. */
  name: string;
  command: string;
  args: string[];
  /** Templates that need a folder: where it goes in the args. */
  folder?: { label: string; hint: string; flag?: string };
  url?: string;
  headers?: KeyValue[];
  note?: string;
}

export const MCP_TEMPLATES: McpTemplate[] = [
  {
    id: "filesystem",
    title: "Filesystem",
    description: "Read, search and write files in one folder you choose.",
    icon: <Folder size={16} />,
    tone: "blue",
    needs: ["node", "npx"],
    transport: "stdio",
    name: "Filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    folder: { label: "Folder", hint: "The server can only see this folder and the folders inside it." },
  },
  {
    id: "fetch",
    title: "Fetch web pages",
    description: "Download a web page and turn it into text the model can read.",
    icon: <Globe size={16} />,
    tone: "teal",
    needs: ["uvx"],
    transport: "stdio",
    name: "Fetch",
    command: "uvx",
    args: ["mcp-server-fetch"],
  },
  {
    id: "memory",
    title: "Memory",
    description: "A small knowledge graph so the model can remember facts between chats.",
    icon: <Brain size={16} />,
    tone: "purple",
    needs: ["node", "npx"],
    transport: "stdio",
    name: "Memory",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
  },
  {
    id: "time",
    title: "Time",
    description: "Current time and time zone conversion.",
    icon: <Clock size={16} />,
    tone: "orange",
    needs: ["uvx"],
    transport: "stdio",
    name: "Time",
    command: "uvx",
    args: ["mcp-server-time"],
  },
  {
    id: "git",
    title: "Git",
    description: "Read the history, status and diffs of one Git repository.",
    icon: <GitBranch size={16} />,
    tone: "red",
    needs: ["uvx"],
    transport: "stdio",
    name: "Git",
    command: "uvx",
    args: ["mcp-server-git"],
    folder: { label: "Repository folder", hint: "A folder that contains a .git folder.", flag: "--repository" },
  },
  {
    id: "thinking",
    title: "Sequential thinking",
    description: "Helps the model break a hard problem into steps.",
    icon: <ListChecks size={16} />,
    tone: "green",
    needs: ["node", "npx"],
    transport: "stdio",
    name: "Sequential thinking",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
  },
  {
    id: "everything",
    title: "Everything (test)",
    description: "A demo server with many sample tools. Good to test that MCP works.",
    icon: <FlaskConical size={16} />,
    tone: "pink",
    needs: ["node", "npx"],
    transport: "stdio",
    name: "Everything",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    note: "This server has many tools. Turn on only one or two, or it fills the small context.",
  },
  {
    id: "custom",
    title: "Custom command",
    description: "Any MCP server you start with a command (stdio).",
    icon: <SquareTerminal size={16} />,
    tone: "dark",
    needs: [],
    transport: "stdio",
    name: "",
    command: "",
    args: [],
  },
  {
    id: "remote",
    title: "Remote server",
    description: "A server on the web, with a Streamable HTTP URL.",
    icon: <Server size={16} />,
    tone: "gray",
    needs: [],
    transport: "http",
    name: "",
    command: "",
    args: [],
    url: "",
    headers: [{ key: "Authorization", value: "" }],
  },
];

export const templateCommand = (t: McpTemplate) =>
  t.transport === "http"
    ? "https://example.com/mcp"
    : [t.command, ...t.args, ...(t.folder ? [...(t.folder.flag ? [t.folder.flag] : []), "<folder>"] : [])].join(" ");

/** Args for a folder template: the base args plus the folder (and flag). */
export function argsWithFolder(t: McpTemplate, folder: string): string[] {
  if (!t.folder) return [...t.args];
  return [...t.args, ...(t.folder.flag ? [t.folder.flag] : []), ...(folder ? [folder] : [])];
}
