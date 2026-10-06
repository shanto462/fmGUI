import { describe, expect, it } from "vitest";
import { baseName, expandTilde, joinPath, tildePath, tildeText } from "./paths";

const HOME = "/Users/ada";

describe("tildePath", () => {
  it("replaces the home folder with ~", () => {
    expect(tildePath("/Users/ada/.fm/sessions/x.json", HOME)).toBe("~/.fm/sessions/x.json");
    expect(tildePath("/Users/ada/Library/Application Support/fmGUI", HOME)).toBe("~/Library/Application Support/fmGUI");
    expect(tildePath("/Users/ada", HOME)).toBe("~");
  });

  it("accepts a home folder with a trailing slash", () => {
    expect(tildePath("/Users/ada/Documents", "/Users/ada/")).toBe("~/Documents");
  });

  it("leaves other paths alone", () => {
    expect(tildePath("/usr/bin/fm", HOME)).toBe("/usr/bin/fm");
    expect(tildePath("/Users/adam/x", HOME)).toBe("/Users/adam/x");
    expect(tildePath("/Users/ada2", HOME)).toBe("/Users/ada2");
    expect(tildePath("relative/Users/ada/x", HOME)).toBe("relative/Users/ada/x");
  });

  it("does nothing without a home folder", () => {
    expect(tildePath("/Users/ada/x", null)).toBe("/Users/ada/x");
    expect(tildePath("/Users/ada/x", undefined)).toBe("/Users/ada/x");
    expect(tildePath("/Users/ada/x", "")).toBe("/Users/ada/x");
    expect(tildePath("/x", "/")).toBe("/x");
  });
});

describe("tildeText", () => {
  it("replaces every home path inside a command", () => {
    const cmd =
      "fm respond --resume /Users/ada/.fm/sessions/x.json --save-transcript /Users/ada/.fm/sessions/x.json -- hi";
    expect(tildeText(cmd, HOME)).toBe(
      "fm respond --resume ~/.fm/sessions/x.json --save-transcript ~/.fm/sessions/x.json -- hi",
    );
  });

  it("handles quoted paths and paths at the end", () => {
    expect(tildeText("curl --unix-socket '/Users/ada/Library/Application Support/fmGUI/fm.sock'", HOME)).toBe(
      "curl --unix-socket '~/Library/Application Support/fmGUI/fm.sock'",
    );
    expect(tildeText("cd /Users/ada", HOME)).toBe("cd ~");
    expect(tildeText('Could not read "/Users/ada".', HOME)).toBe('Could not read "~".');
  });

  it("does not touch a longer user name or other text", () => {
    expect(tildeText("ls /Users/adam /Users/ada.bak", HOME)).toBe("ls /Users/adam /Users/ada.bak");
    expect(tildeText("no paths here", HOME)).toBe("no paths here");
    expect(tildeText("/Users/ada/x", null)).toBe("/Users/ada/x");
  });

  it("escapes regex characters in the home folder", () => {
    expect(tildeText("open /Users/a.b+c/x", "/Users/a.b+c")).toBe("open ~/x");
    expect(tildeText("open /Users/aXb+c/x", "/Users/a.b+c")).toBe("open /Users/aXb+c/x");
  });
});

describe("expandTilde", () => {
  it("turns ~ back into the home folder", () => {
    expect(expandTilde("~", HOME)).toBe(HOME);
    expect(expandTilde("~/Documents", HOME)).toBe("/Users/ada/Documents");
    expect(expandTilde("~/Documents", "/Users/ada/")).toBe("/Users/ada/Documents");
  });

  it("leaves other text alone", () => {
    expect(expandTilde("/usr/bin/fm", HOME)).toBe("/usr/bin/fm");
    expect(expandTilde("~ada/x", HOME)).toBe("~ada/x");
    expect(expandTilde("~/x", null)).toBe("~/x");
  });

  it("round-trips with tildePath", () => {
    for (const p of ["/Users/ada", "/Users/ada/a b/c", "/opt/x"]) expect(expandTilde(tildePath(p, HOME), HOME)).toBe(p);
  });
});

describe("baseName and joinPath", () => {
  it("works with and without trailing slashes", () => {
    expect(baseName("/Users/ada/Projects/")).toBe("Projects");
    expect(baseName("/Users/ada/x.json")).toBe("x.json");
    expect(baseName("x.json")).toBe("x.json");
    expect(joinPath("/tmp", "a.json")).toBe("/tmp/a.json");
    expect(joinPath("/tmp/", "a.json")).toBe("/tmp/a.json");
  });
});
