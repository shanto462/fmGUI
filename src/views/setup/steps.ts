import type { FmStatus } from "../../lib/types";

export const STEPS = ["Welcome", "fm tool", "Model", "License", "Engine", "Extras", "Done"];
export const STEP_FM = 1;
export const STEP_MODEL = 2;
export const STEP_LICENSE = 3;
export const STEP_ENGINE = 4;
export const STEP_EXTRAS = 5;
export const LAST_STEP = STEPS.length - 1;

/** The first check that fails, in setup order (fm tool, Model, License), or null when all pass. */
export function firstFailingStep(status: FmStatus | null): number | null {
  if (!status?.binaryFound) return STEP_FM;
  if (!status.modelAvailable) return STEP_MODEL;
  if (!status.licenseAgreed) return STEP_LICENSE;
  return null;
}

/**
 * The step the Setup Guide opens on.
 * - A step handed over by another page ("Run setup again" passes 0) wins.
 * - Otherwise the first failing check, so the user can fix it right away.
 * - When every check passes, the final Done step.
 */
export function initialStep(status: FmStatus | null, handoffStep?: number): number {
  if (handoffStep != null && Number.isFinite(handoffStep)) {
    return Math.max(0, Math.min(LAST_STEP, Math.trunc(handoffStep)));
  }
  return firstFailingStep(status) ?? LAST_STEP;
}

/**
 * How far the user may jump with the step bar when Setup opens. Steps before
 * the first failing check count as done. When every check passes, every step
 * is reachable.
 */
export function initialReach(status: FmStatus | null, start: number): number {
  return Math.max(start, firstFailingStep(status) ?? LAST_STEP);
}
