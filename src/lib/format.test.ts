import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  formatDuration,
  formatNumber,
  formatUptime,
  hashText,
  jsonError,
  pluralize,
  prettyJson,
  stripAnsi,
  truncateText,
  tryPrettyJson,
} from "./format";

describe("number and time formatters", () => {
  it("formats numbers, durations and uptime", () => {
    expect(formatNumber(8192)).toBe("8,192");
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(1250)).toBe("1.3 s");
    expect(formatUptime(5_000)).toBe("5s");
    expect(formatUptime(65_000)).toBe("1m 05s");
    expect(formatUptime(3_720_000)).toBe("1h 02m");
    expect(formatUptime(-1)).toBe("0s");
  });

  it("pluralizes", () => {
    expect(pluralize(1, "tool")).toBe("1 tool");
    expect(pluralize(1200, "tool")).toBe("1,200 tools");
    expect(pluralize(2, "person", "people")).toBe("2 people");
  });

  it("estimates tokens at about 4 characters each", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("JSON helpers", () => {
  it("pretty prints JSON objects and arrays only", () => {
    expect(tryPrettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(tryPrettyJson(" [1] ")).toBe("[\n  1\n]");
    expect(tryPrettyJson("42")).toBeNull();
    expect(tryPrettyJson("{broken")).toBeNull();
  });

  it("pretty prints any value", () => {
    expect(prettyJson(null)).toBe("{}");
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson("plain text")).toBe("plain text");
  });

  it("reports JSON errors", () => {
    expect(jsonError("{}")).toBeNull();
    expect(jsonError("{")).toMatch(/JSON/);
  });
});

describe("text helpers", () => {
  it("strips ANSI codes", () => {
    expect(stripAnsi("\u001b[31merror\u001b[0m done")).toBe("error done");
  });

  it("truncates to one line", () => {
    expect(truncateText("a  b\nc", 10)).toBe("a b c");
    expect(truncateText("abcdefghij", 5)).toBe("abcd…");
  });

  it("hashes text to 8 stable hex characters", () => {
    expect(hashText("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
  });
});
