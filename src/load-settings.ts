/**
 * Filesystem loader for pi-run-timeout. Reads the global and project pi
 * settings.json files and merges the runTimeout config. node: builtins only;
 * this module never imports pi (the caller supplies the global settings path).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type RunTimeoutConfig, mergeRunTimeout } from "./config.ts";

/** Read and parse a JSON file; undefined when missing, unreadable, or invalid. */
export function readJsonFile(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the effective runTimeout config for a working directory.
 * @param cwd Project dir; project settings live at `<cwd>/.pi/settings.json`.
 * @param globalPath Absolute path to global settings (pi's getSettingsPath()).
 */
export function loadConfig(cwd: string, globalPath: string): RunTimeoutConfig {
  const globalSettings = readJsonFile(globalPath);
  const projectSettings = readJsonFile(join(cwd, ".pi", "settings.json"));
  return mergeRunTimeout(globalSettings, projectSettings);
}
