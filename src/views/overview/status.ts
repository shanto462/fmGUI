// Plain helpers for the fm status, shared by the Setup, Overview and Settings views.

import { tildePath } from "../../lib/paths";
import type { FmStatus } from "../../lib/types";

export type Tone = "green" | "orange" | "red" | "gray";

export type CheckState = "ok" | "warn" | "bad" | "pending" | "unknown";

export interface ModelState {
  tone: Tone;
  title: string;
  detail: string;
  ready: boolean;
}

/** One readable state for the model, in the same order as the sidebar status. */
export function modelState(status: FmStatus | null, loading: boolean, homeDir?: string | null): ModelState {
  if (!status) {
    return loading
      ? { tone: "gray", title: "Checking…", detail: "Asking fm about the model.", ready: false }
      : { tone: "gray", title: "Unknown", detail: "The status check did not finish. Try Refresh.", ready: false };
  }
  if (!status.binaryFound) {
    return {
      tone: "red",
      title: "fm not found",
      detail: `There is no fm tool at ${status.binaryPath ? tildePath(status.binaryPath, homeDir) : "the set path"}. It ships with macOS 27.`,
      ready: false,
    };
  }
  if (!status.licenseAgreed) {
    return {
      tone: "orange",
      title: "License not agreed",
      detail: status.licenseMessage || "Run sudo fm license in Terminal to read and accept the terms.",
      ready: false,
    };
  }
  if (!status.modelAvailable) {
    return {
      tone: "orange",
      title: "Model unavailable",
      detail: status.availabilityMessage || "Apple Intelligence is off, or the model is still downloading.",
      ready: false,
    };
  }
  return {
    tone: "green",
    title: "Ready",
    detail: status.availabilityMessage || "The on-device model is ready.",
    ready: true,
  };
}

/** "macOS 27.0.1 (26A434)", or a fallback when unknown. */
export function macosLabel(status: FmStatus | null): string {
  if (!status?.macosVersion) return "Unknown";
  return status.macosBuild ? `macOS ${status.macosVersion} (${status.macosBuild})` : `macOS ${status.macosVersion}`;
}

/** True when the macOS major version is known and below 27. */
export function isOldMacos(status: FmStatus | null): boolean {
  const major = parseInt(status?.macosVersion ?? "", 10);
  return Number.isFinite(major) && major < 27;
}
