// Unit tests for the fm argument builders. OWNER: agent "ui-build".
// Flags were checked against `fm <command> --help` on macOS 27.0.1.

import { describe, expect, it } from "vitest";
import {
  countTokensArgs,
  displayCommand,
  respondArgs,
  schemaObjectArgs,
  serveArgs,
  shellQuote,
  validateRespond,
  validateSchema,
  type SchemaDefinition,
  type SchemaProperty,
} from "./fmArgs";

const prop = (name: string, extra: Partial<SchemaProperty> = {}): SchemaProperty => ({
  id: name,
  name,
  type: "string",
  isArray: false,
  isOptional: false,
  description: "",
  ...extra,
});

describe("validateRespond", () => {
  it("needs a prompt, a text segment or an image", () => {
    expect(validateRespond({ prompt: "  " })).toHaveLength(1);
    expect(validateRespond({ prompt: "Hi" })).toEqual([]);
    expect(validateRespond({ prompt: "", textSegments: ["Some text"] })).toEqual([]);
    expect(validateRespond({ prompt: "", textSegments: ["   "] })).toHaveLength(1);
    expect(validateRespond({ prompt: "", images: [{ path: "/tmp/a.png" }] })).toEqual([]);
  });

  it("rejects instructions together with a resumed transcript", () => {
    const problems = validateRespond({ prompt: "Hi", resumePath: "/tmp/t.json", instructions: "Be brief" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/instructions/i);
    expect(validateRespond({ prompt: "Hi", resumePath: "/tmp/t.json", instructions: "  " })).toEqual([]);
  });

  it("needs a CLI tool for image labels", () => {
    const images = [{ path: "/tmp/a.png", label: "receipt" }];
    expect(validateRespond({ prompt: "Hi", images })).toHaveLength(1);
    expect(validateRespond({ prompt: "Hi", images, tools: ["ocr"] })).toEqual([]);
    expect(validateRespond({ prompt: "Hi", images: [{ path: "/tmp/a.png", label: "  " }] })).toEqual([]);
  });
});

describe("respondArgs", () => {
  it("puts the prompt last, after --", () => {
    expect(respondArgs({ prompt: "What is Swift?" })).toEqual(["respond", "--", "What is Swift?"]);
  });

  it("keeps a prompt that starts with a dash as a prompt", () => {
    const args = respondArgs({ prompt: "-v means verbose?" });
    expect(args.slice(-2)).toEqual(["--", "-v means verbose?"]);
  });

  it("leaves out the prompt and -- when the prompt is blank", () => {
    expect(respondArgs({ prompt: "  ", textSegments: ["Doc text"] })).toEqual(["respond", "--text", "Doc text"]);
  });

  it("builds every option", () => {
    const args = respondArgs({
      prompt: "Describe",
      instructions: "Be brief",
      textSegments: ["one", " ", "two"],
      images: [{ path: "/a.png", label: "first" }],
      tools: ["ocr", "barcode"],
      schema: "/tmp/schema.json",
      resumePath: "/tmp/in.json",
      saveTranscriptPath: "/tmp/out.json",
      stream: false,
      greedy: true,
      verbose: true,
      useCase: "content-tagging",
      guardrails: "permissive-content-transformations",
    });
    expect(args).toEqual([
      "respond",
      "-i",
      "Be brief",
      "--schema",
      "/tmp/schema.json",
      "--text",
      "one",
      "--text",
      "two",
      "--image",
      "/a.png",
      "--label",
      "first",
      "--tool",
      "ocr",
      "--tool",
      "barcode",
      "--resume",
      "/tmp/in.json",
      "--save-transcript",
      "/tmp/out.json",
      "--no-stream",
      "--greedy",
      "--verbose",
      "--use-case",
      "content-tagging",
      "--guardrails",
      "permissive-content-transformations",
      "--",
      "Describe",
    ]);
  });

  it("leaves out defaults", () => {
    const args = respondArgs({
      prompt: "Hi",
      instructions: "   ",
      schema: " ",
      stream: true,
      greedy: false,
      verbose: false,
      useCase: "general",
      guardrails: "default",
    });
    expect(args).toEqual(["respond", "--", "Hi"]);
  });

  it("drops image labels when no CLI tool is on", () => {
    const args = respondArgs({ prompt: "Hi", images: [{ path: "/a.png", label: "receipt" }] });
    expect(args).toEqual(["respond", "--image", "/a.png", "--", "Hi"]);
  });

  it("trims labels", () => {
    const args = respondArgs({ prompt: "Hi", images: [{ path: "/a.png", label: "  receipt " }], tools: ["ocr"] });
    expect(args).toContain("receipt");
  });

  // fm pairs the Nth --label with the Nth --image (checked with a saved transcript
  // on 27.0.1), so every image must get a label once one has a label.
  it("gives a label to the right image when an earlier image has none", () => {
    const args = respondArgs({
      prompt: "Hi",
      tools: ["ocr"],
      images: [{ path: "/a.png" }, { path: "/b.png", label: "second" }],
    });
    const labels = args.filter((_, i) => args[i - 1] === "--label");
    const images = args.filter((_, i) => args[i - 1] === "--image");
    expect(labels.length).toBe(images.length);
    expect(labels[images.indexOf("/b.png")]).toBe("second");
  });
});

describe("countTokensArgs", () => {
  it("always asks for the bare number", () => {
    expect(countTokensArgs({})).toEqual(["count-tokens", "--quiet"]);
  });

  it("builds every option with the prompt last", () => {
    expect(
      countTokensArgs({
        prompt: "Hello",
        instructions: "Be brief",
        textSegments: ["a", "  ", "b"],
        images: ["/x.png"],
        transcriptPath: "/t.json",
      }),
    ).toEqual([
      "count-tokens",
      "--quiet",
      "-i",
      "Be brief",
      "--text",
      "a",
      "--text",
      "b",
      "--image",
      "/x.png",
      "--transcript",
      "/t.json",
      "--",
      "Hello",
    ]);
  });

  it("leaves out blank parts", () => {
    expect(countTokensArgs({ prompt: " ", instructions: " " })).toEqual(["count-tokens", "--quiet"]);
  });
});

describe("validateSchema", () => {
  const def = (rootName: string, properties: SchemaProperty[]): SchemaDefinition => ({ rootName, properties });

  it("accepts a simple schema with dot notation", () => {
    expect(validateSchema(def("Person", [prop("name"), prop("address.street")]))).toEqual([]);
  });

  it("needs a one-word type name", () => {
    expect(validateSchema(def("My Person", [prop("name")]))).toHaveLength(1);
    expect(validateSchema(def("", [prop("name")]))).toHaveLength(1);
    expect(validateSchema(def("1Person", [prop("name")]))).toHaveLength(1);
  });

  it("needs at least one property", () => {
    expect(validateSchema(def("Person", []))).toEqual(["Add at least one property."]);
  });

  it("rejects bad property names", () => {
    for (const bad of ["", "first name", "a..b", ".a", "a.", "9lives", "a-b"]) {
      expect(validateSchema(def("Person", [prop(bad)])), bad).toHaveLength(1);
    }
  });

  it("rejects duplicate names", () => {
    expect(validateSchema(def("Person", [prop("name"), prop("name")]))).toEqual(['"name" is used twice.']);
  });

  // fm fails with "Person contains multiple name properties".
  it("rejects duplicate names that differ only by spaces", () => {
    expect(validateSchema(def("Person", [prop("name"), prop("name ")]))).toHaveLength(1);
  });
});

describe("schemaObjectArgs", () => {
  it("builds properties with modifiers after each one", () => {
    const args = schemaObjectArgs({
      rootName: " Person ",
      properties: [
        prop("name", { description: " Full name " }),
        prop("age", { type: "integer", isOptional: true }),
        prop("score", { type: "double" }),
        prop("tags", { isArray: true }),
        prop("active", { type: "boolean", isArray: true, isOptional: true }),
      ],
    });
    expect(args).toEqual([
      "schema",
      "object",
      "--name",
      "Person",
      "--string",
      "name",
      "--description",
      "Full name",
      "--integer",
      "age",
      "--optional",
      "--double",
      "score",
      "--string",
      "tags",
      "--array",
      "--boolean",
      "active",
      "--optional",
      "--array",
    ]);
  });
});

describe("serveArgs", () => {
  it("builds TCP mode", () => {
    expect(serveArgs({ mode: "tcp", host: "127.0.0.1", port: 1976 })).toEqual([
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "1976",
    ]);
    expect(serveArgs({ mode: "tcp" })).toEqual(["serve"]);
  });

  it("builds socket mode and ignores host and port", () => {
    expect(serveArgs({ mode: "socket", socketPath: "/tmp/fm.sock", host: "0.0.0.0", port: 1 })).toEqual([
      "serve",
      "--socket",
      "/tmp/fm.sock",
    ]);
  });
});

describe("shellQuote and displayCommand", () => {
  it("leaves safe words alone", () => {
    for (const s of ["respond", "--no-stream", "/usr/bin/fm", "a=b", "x:y,z+1@2%"]) expect(shellQuote(s)).toBe(s);
  });

  it("quotes empty strings, spaces and specials", () => {
    expect(shellQuote("")).toBe("''");
    expect(shellQuote("What is Swift?")).toBe("'What is Swift?'");
    expect(shellQuote("$HOME")).toBe("'$HOME'");
    expect(shellQuote("a\nb")).toBe("'a\nb'");
  });

  it("escapes single quotes", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it("shows fm for /usr/bin/fm and the full path otherwise", () => {
    expect(displayCommand(["respond", "--", "Hi there"])).toBe("fm respond -- 'Hi there'");
    expect(displayCommand(["available"], "/opt/fm")).toBe("/opt/fm available");
    expect(displayCommand(["available"], "/My Tools/fm")).toBe("'/My Tools/fm' available");
  });
});

describe("fixes for issues found by the UI agents", () => {
  it("rejects a property that is both a value and an object", () => {
    const d = {
      rootName: "Place",
      properties: [
        { id: "1", name: "address", type: "string" as const, isArray: false, isOptional: false, description: "" },
        { id: "2", name: "address.street", type: "string" as const, isArray: false, isOptional: false, description: "" },
      ],
    };
    expect(validateSchema(d).some((p) => p.includes("as a value and as an object"))).toBe(true);
  });

  it("quotes a leading = so zsh does not expand it", () => {
    expect(shellQuote("=ls")).toBe("'=ls'");
    expect(shellQuote("a=b")).toBe("a=b");
  });
});
