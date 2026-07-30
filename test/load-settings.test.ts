import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, readJsonFile } from "../src/load-settings.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-timeout-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value), "utf8");
}

describe("readJsonFile", () => {
  it("parses a valid JSON file", () => {
    const file = join(dir, "a.json");
    writeJson(file, { runTimeout: { maxSeconds: 10 } });
    expect(readJsonFile(file)).toEqual({ runTimeout: { maxSeconds: 10 } });
  });

  it("returns undefined for a missing file", () => {
    expect(readJsonFile(join(dir, "missing.json"))).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    const file = join(dir, "bad.json");
    writeFileSync(file, "{ not json", "utf8");
    expect(readJsonFile(file)).toBeUndefined();
  });
});

describe("loadConfig", () => {
  it("reads the global settings file", () => {
    const globalPath = join(dir, "global.json");
    writeJson(globalPath, { runTimeout: { maxSeconds: 15 } });
    expect(loadConfig(dir, globalPath)).toEqual({ maxSeconds: 15 });
  });

  it("merges project over global per key", () => {
    const globalPath = join(dir, "global.json");
    writeJson(globalPath, { runTimeout: { maxSeconds: 15, fallbackMaxSeconds: 100 } });
    writeJson(join(dir, ".pi", "settings.json"), { runTimeout: { maxSeconds: 4 } });
    expect(loadConfig(dir, globalPath)).toEqual({ maxSeconds: 4, fallbackMaxSeconds: 100 });
  });

  it("returns empty config when nothing defines runTimeout", () => {
    const globalPath = join(dir, "global.json");
    writeJson(globalPath, { theme: "dark" });
    expect(loadConfig(dir, globalPath)).toEqual({});
  });

  it("returns empty config when neither file exists", () => {
    expect(loadConfig(dir, join(dir, "nope.json"))).toEqual({});
  });
});
