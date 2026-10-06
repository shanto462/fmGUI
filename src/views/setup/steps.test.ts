import { describe, expect, it } from "vitest";
import type { FmStatus } from "../../lib/types";
import { LAST_STEP, STEP_FM, STEP_LICENSE, STEP_MODEL, firstFailingStep, initialReach, initialStep } from "./steps";

function status(change: Partial<FmStatus> = {}): FmStatus {
  return {
    binaryPath: "/usr/bin/fm",
    binaryFound: true,
    macosVersion: "27.0",
    macosBuild: "26A100",
    modelAvailable: true,
    availabilityMessage: "Available",
    licenseAgreed: true,
    licenseMessage: "Agreed",
    contextSize: 8192,
    ...change,
  };
}

describe("firstFailingStep", () => {
  it("checks fm, then the model, then the license", () => {
    expect(firstFailingStep(null)).toBe(STEP_FM);
    expect(firstFailingStep(status({ binaryFound: false, modelAvailable: false, licenseAgreed: false }))).toBe(STEP_FM);
    expect(firstFailingStep(status({ modelAvailable: false, licenseAgreed: false }))).toBe(STEP_MODEL);
    expect(firstFailingStep(status({ licenseAgreed: false }))).toBe(STEP_LICENSE);
    expect(firstFailingStep(status())).toBeNull();
  });
});

describe("initialStep", () => {
  it("opens on Done when every check passes", () => {
    expect(initialStep(status())).toBe(LAST_STEP);
  });

  it("opens on the first failing check", () => {
    expect(initialStep(status({ binaryFound: false }))).toBe(STEP_FM);
    expect(initialStep(status({ modelAvailable: false }))).toBe(STEP_MODEL);
    expect(initialStep(status({ licenseAgreed: false }))).toBe(STEP_LICENSE);
    expect(initialStep(status({ modelAvailable: false, licenseAgreed: false }))).toBe(STEP_MODEL);
  });

  it("opens on the fm step when the status is unknown", () => {
    expect(initialStep(null)).toBe(STEP_FM);
  });

  it("never starts on Welcome unless a page asks for it", () => {
    expect(initialStep(status())).not.toBe(0);
    expect(initialStep(null)).not.toBe(0);
    expect(initialStep(status(), 0)).toBe(0);
    expect(initialStep(status({ licenseAgreed: false }), 0)).toBe(0);
  });

  it("keeps a handed-over step inside the step range", () => {
    expect(initialStep(status(), 3)).toBe(3);
    expect(initialStep(status(), -2)).toBe(0);
    expect(initialStep(status(), 99)).toBe(LAST_STEP);
    expect(initialStep(status(), Number.NaN)).toBe(LAST_STEP);
  });
});

describe("initialReach", () => {
  it("makes every step reachable when every check passes", () => {
    expect(initialReach(status(), LAST_STEP)).toBe(LAST_STEP);
    expect(initialReach(status(), 0)).toBe(LAST_STEP);
  });

  it("stops at the first failing check", () => {
    expect(initialReach(status({ licenseAgreed: false }), STEP_LICENSE)).toBe(STEP_LICENSE);
    expect(initialReach(status({ modelAvailable: false }), 0)).toBe(STEP_MODEL);
  });
});
