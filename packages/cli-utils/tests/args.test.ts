import { describe, expect, it } from "vitest";
import { getBool, getNumber, getString, parseArgs } from "../src/index.js";

describe("parseArgs", () => {
  it("parses long options with values", () => {
    const args = parseArgs(["--input", "in.mp4", "--output=out.webm"]);
    expect(args.values["input"]).toBe("in.mp4");
    expect(args.values["output"]).toBe("out.webm");
    expect(args.positionals).toEqual([]);
  });

  it("parses boolean flags", () => {
    const args = parseArgs(["--overwrite", "-y"]);
    expect(args.flags.has("overwrite")).toBe(true);
    expect(args.flags.has("y")).toBe(true);
  });

  it("parses positionals and short options", () => {
    const args = parseArgs(["a.mp4", "b.mp4", "-o", "out.mp4"]);
    expect(args.positionals).toEqual(["a.mp4", "b.mp4"]);
    expect(args.values["o"]).toBe("out.mp4");
  });

  it("treats -- as separator", () => {
    const args = parseArgs(["--", "--not-a-flag"]);
    expect(args.positionals).toEqual(["--not-a-flag"]);
  });
});

describe("getters", () => {
  it("getString returns value or fallback", () => {
    const args = parseArgs(["--name", "test"]);
    expect(getString(args, "name")).toBe("test");
    expect(getString(args, "missing", "fb")).toBe("fb");
  });

  it("getNumber parses numbers", () => {
    const args = parseArgs(["--count", "42"]);
    expect(getNumber(args, "count")).toBe(42);
    expect(getNumber(args, "bad", 7)).toBe(7);
  });

  it("getBool handles flags and string values", () => {
    const args = parseArgs(["--flag", "--value", "true"]);
    expect(getBool(args, "flag")).toBe(true);
    expect(getBool(args, "value")).toBe(true);
    expect(getBool(args, "missing")).toBe(false);
  });
});
