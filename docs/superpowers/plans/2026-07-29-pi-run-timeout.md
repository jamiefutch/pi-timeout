# pi-run-timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pi package that stops pi waiting indefinitely on run-style `bash` commands: recognized program-run commands are capped at `runTimeout.maxSeconds`, any other non-safe command at `runTimeout.fallbackMaxSeconds`, and known-safe tooling (git/build/test/install) is never capped.

**Architecture:** A pi extension hooks the `tool_call` event. For `bash` calls it loads `runTimeout` from merged pi settings (project overrides global), classifies the command with a segment-aware heuristic (split on `&& || ; |`, strip wrappers like `sudo`/`env VAR=`, classify each segment), resolves a timeout (`safe -> none`, `run -> maxSeconds ?? fallbackMaxSeconds`, `unknown -> fallbackMaxSeconds`, explicit model timeout always wins), and mutates `event.input.timeout` (seconds). Pi's bash tool then kills the process tree at the cap and returns `timeout:<seconds>`. All logic is in dependency-free pure modules that are unit-tested; only `extensions/run-timeout.ts` imports pi.

**Tech Stack:** TypeScript (strict, ESM), Vitest, `node:fs`/`node:path`, `@earendil-works/pi-coding-agent` (peer + dev dep; types + `isToolCallEventType` + `getSettingsPath`).

**Spec:** `docs/superpowers/specs/2026-07-29-pi-run-timeout-design.md` (approved). Pi source for reference: `/Users/jamiefutch/projects/cloned/pi`.

## Global Constraints

- Runtime: Node >= 22, Bun >= 1.3 (verified). ESM only (`"type": "module"`); TypeScript `strict: true`.
- TDD everywhere: failing test -> run -> implement -> run -> commit. Each step is one action.
- **Zero runtime dependencies.** `src/` may import only `node:` builtins. `@earendil-works/pi-coding-agent` is imported (runtime) only by `extensions/run-timeout.ts`.
- **Units are seconds** (pi's bash `timeout` unit). Values must be positive finite numbers, clamped to `MAX_TIMEOUT_SECONDS = 2_147_483.647`.
- **Semantics (hold in every task):** explicit model `timeout` always respected; `safe` never capped; `run -> maxSeconds ?? fallbackMaxSeconds`; `unknown -> fallbackMaxSeconds`; both settings absent -> extension inert (opt-in).
- Imports use explicit `.ts` extensions (`allowImportingTsExtensions: true` + `noEmit: true`).
- Conventional commits; commit after every task.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` | npm + pi manifest (`pi-package` keyword, `pi.extensions`, `files` allowlist — publish-ready). |
| `tsconfig.json` | Strict ESM TS config. |
| `vitest.config.ts` | Vitest config. |
| `.gitignore` | `node_modules`, `dist`, coverage. |
| `src/classify.ts` | Segment-aware command classifier + rule tables. Pure. |
| `src/config.ts` | Parse/validate/clamp/merge `runTimeout` (two keys). Pure. |
| `src/load-settings.ts` | `readJsonFile`, `loadConfig(cwd, globalPath)`. `node:fs` only. |
| `src/handler.ts` | `resolveTimeout` + `handleToolCall` (classify -> resolve -> mutate). Pure. |
| `extensions/run-timeout.ts` | Thin pi `tool_call` wiring. Only pi import. |
| `test/classify.test.ts` | Table-driven classifier tests. |
| `test/config.test.ts` | Config parse/merge/clamp tests. |
| `test/load-settings.test.ts` | FS loader tests (temp dirs). |
| `test/handler.test.ts` | Resolution + handler tests. |
| `test/extension.test.ts` | Extension tests (pi module mocked). |
| `README.md` | Full user docs: install, configure, usage, classification reference, FAQ, dev. |

---

### Task 1: Scaffold the package

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: working `npm test`; manifest shape later tasks rely on.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "pi-run-timeout",
  "version": "0.1.0",
  "description": "Pi package: cap run-style bash commands via runTimeout.maxSeconds / fallbackMaxSeconds in settings.json so pi never waits indefinitely.",
  "type": "module",
  "keywords": ["pi-package"],
  "license": "MIT",
  "files": ["extensions", "src", "README.md"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "pi": {
    "extensions": ["./extensions"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "allowImportingTsExtensions": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "extensions", "test", "vitest.config.ts"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
coverage/
*.log
.DS_Store
```

- [ ] **Step 5: Write `test/smoke.test.ts`**

```typescript
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: success; `node_modules/` created. If `@earendil-works/pi-coding-agent` is not on the public registry, install from the local clone and continue (the pure core never imports it; Task 6 mocks it):

```bash
npm install --no-save /Users/jamiefutch/projects/cloned/pi/packages/coding-agent
```

- [ ] **Step 7: Run the smoke test**

Run: `npm test`
Expected: `1 passed`.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore test/smoke.test.ts
git commit -m "chore: scaffold pi-run-timeout package"
```

---

### Task 2: Segment-aware command classifier (`src/classify.ts`)

**Files:**
- Create: `src/classify.ts`, `test/classify.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 5):
  - `type Classification = "run" | "safe" | "unknown"`.
  - `classifyCommand(command: string): Classification`.

**Rules (spec §5):** split on `&& || ; |`; strip leading wrappers (`sudo`, `nohup`, `time`, `command`, `exec`, `env`, and `KEY=VALUE` assignments); classify each segment (run patterns first, then safe, else unknown); combine — any `run` => `run`, else all `safe` => `safe`, else `unknown`. Note: `npm run <script>` (including `npm run build`) is treated as **run** because npm scripts commonly start long-lived processes; this is an accepted tradeoff from the spec review.

- [ ] **Step 1: Write the failing tests**

Create `test/classify.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { classifyCommand } from "../src/classify.ts";

describe("classifyCommand — run commands", () => {
  const run = [
    "./app",
    "./target/release/myapp",
    "/usr/local/bin/tool",
    "../bin/run",
    "./app.exe",
    "dotnet run",
    "dotnet bin/Debug/net8.0/MyApp.dll",
    "dotnet ./out/App.exe",
    "node dist/index.js",
    "bun run dist/app.js",
    "bun app.js",
    "deno run main.ts",
    "cargo run",
    "cargo run --release",
    "go run .",
    "go run cmd/server/main.go",
    "python main.py",
    "python3 app.py",
    "uv run serve.py",
    "java -jar app.jar",
    "java com.example.Main",
    "php index.php",
    "ruby script.rb",
    "npm start",
    "npm run serve",
  ];
  for (const cmd of run) {
    it(`classifies "${cmd}" as run`, () => {
      expect(classifyCommand(cmd)).toBe("run");
    });
  }
});

describe("classifyCommand — npm run scripts are run (can start servers)", () => {
  it("classifies npm run build / dev as run", () => {
    expect(classifyCommand("npm run build")).toBe("run");
    expect(classifyCommand("npm run dev")).toBe("run");
  });
});

describe("classifyCommand — safe tooling", () => {
  const safe = [
    "git status",
    "git commit -m x",
    "ls -la",
    "cat file.txt",
    "grep foo bar.ts",
    "rg pattern",
    "find . -name x",
    "echo hello",
    "mkdir -p out",
    "rm -rf dist",
    "cargo build",
    "cargo test",
    "cargo clippy",
    "dotnet build",
    "dotnet test",
    "go build ./...",
    "go test ./...",
    "make",
    "cmake .",
    "mvn package",
    "gradle build",
    "npm install",
    "npm test",
    "pnpm install",
    "yarn test",
    "pip install requests",
    "brew install fd",
  ];
  for (const cmd of safe) {
    it(`classifies "${cmd}" as safe`, () => {
      expect(classifyCommand(cmd)).toBe("safe");
    });
  }
});

describe("classifyCommand — unknown", () => {
  const unknown = ["sleep 30", "some-unknown-tool --flag", "curl https://x.dev", "python", "node"];
  for (const cmd of unknown) {
    it(`classifies "${cmd}" as unknown`, () => {
      expect(classifyCommand(cmd)).toBe("unknown");
    });
  }
});

describe("classifyCommand — wrappers", () => {
  it("strips sudo", () => {
    expect(classifyCommand("sudo ./app")).toBe("run");
  });
  it("strips nohup", () => {
    expect(classifyCommand("nohup java -jar app.jar")).toBe("run");
  });
  it("strips env VAR=val", () => {
    expect(classifyCommand("env PORT=8080 node dist/index.js")).toBe("run");
  });
  it("strips bare VAR=val prefix", () => {
    expect(classifyCommand("PORT=8080 node dist/index.js")).toBe("run");
  });
  it("strips time", () => {
    expect(classifyCommand("time cargo build")).toBe("safe");
  });
});

describe("classifyCommand — compound chains", () => {
  it("any run segment makes the whole chain run", () => {
    expect(classifyCommand("cargo build && ./target/release/app")).toBe("run");
    expect(classifyCommand("git status && ./app")).toBe("run");
  });
  it("all-safe chain is safe", () => {
    expect(classifyCommand("git add . && git commit -m x")).toBe("safe");
  });
  it("safe + unknown chain is unknown", () => {
    expect(classifyCommand("git status && sleep 5")).toBe("unknown");
  });
  it("handles pipes and semicolons", () => {
    expect(classifyCommand("ls | grep foo")).toBe("safe");
    expect(classifyCommand("make; ./out/app")).toBe("run");
  });
  it("empty / whitespace command is unknown", () => {
    expect(classifyCommand("")).toBe("unknown");
    expect(classifyCommand("   ")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/classify.test.ts`
Expected: FAIL — cannot resolve `../src/classify.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/classify.ts`:

```typescript
/**
 * Segment-aware command classifier for pi-run-timeout. Pure, no I/O.
 *
 * Splits a command on chain/pipe operators, strips leading wrappers
 * (sudo/nohup/time/command/exec/env and VAR=val assignments), classifies each
 * segment (run patterns first, then safe, else unknown), then combines:
 * any "run" segment => "run"; else all "safe" => "safe"; else "unknown".
 */

export type Classification = "run" | "safe" | "unknown";

const CHAIN_SPLIT = /\s*(?:&&|\|\||;|\|)\s*/;
const WRAPPERS = new Set(["sudo", "nohup", "time", "command", "exec", "env"]);
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Run patterns: executing a program artifact (can hang). Tested first. */
const RUN_PATTERNS: RegExp[] = [
  /^dotnet\s+(?:run\b|\S+\.(?:dll|exe)\b)/i,
  /^bun\s+(?:run\s+\S+|\S+\.(?:js|ts|mjs|cjs|jsx|tsx)\b)/,
  /^deno\s+run\s+\S+/,
  /^node\s+\S+/,
  /^cargo\s+run\b/,
  /^go\s+run\b/,
  /^(?:python|python3|python2)\s+\S+/,
  /^uv\s+run\b/,
  /^java\s+\S+/,
  /^php\s+\S+/,
  /^ruby\s+\S+/,
  /^npm\s+(?:start\b|run\s+\S+)/,
  // Relative/absolute executable path as the first token: ./app, ../bin/x, /usr/local/bin/tool
  /^(?:\.{1,2}\/|\/)\S+/,
];

/** Tools that are always safe regardless of subcommand. */
const SAFE_SIMPLE = new Set([
  "git", "ls", "cat", "grep", "rg", "find", "echo", "pwd", "which", "mkdir",
  "rm", "cp", "mv", "touch", "head", "tail", "wc", "sort", "uniq", "diff",
  "printf", "stat", "file", "cd", "export", "true", "false", "basename",
  "dirname", "realpath", "readlink", "test", "make", "cmake", "mvn", "gradle",
  "apt", "apt-get", "brew",
]);

/** Tools whose safety depends on the subcommand verb. */
const SAFE_TOOL_VERBS: Array<{ tool: RegExp; verbs: Set<string> }> = [
  { tool: /^cargo$/, verbs: new Set(["build", "test", "check", "clippy", "fmt", "clean", "fetch"]) },
  { tool: /^dotnet$/, verbs: new Set(["build", "test", "restore", "clean", "add", "list", "new", "pack", "publish"]) },
  { tool: /^go$/, verbs: new Set(["build", "test", "vet", "mod", "get", "fmt", "clean", "install"]) },
  { tool: /^(?:npm|pnpm|yarn|bun)$/, verbs: new Set(["install", "i", "add", "ci", "test", "lint", "build", "update", "outdated", "list", "ls", "remove", "rm", "publish", "pack"]) },
  { tool: /^pip3?$/, verbs: new Set(["install", "freeze", "list", "show", "uninstall"]) },
];

function normalizeSegment(segment: string): string {
  let tokens = segment.trim().split(/\s+/);
  while (tokens.length > 0) {
    const first = tokens[0];
    if (first !== undefined && (WRAPPERS.has(first) || ENV_ASSIGN.test(first))) {
      tokens = tokens.slice(1);
      continue;
    }
    break;
  }
  return tokens.join(" ");
}

function classifySegment(segment: string): Classification {
  if (RUN_PATTERNS.some((re) => re.test(segment))) return "run";

  const tokens = segment.split(/\s+/);
  const first = tokens[0] ?? "";
  if (SAFE_SIMPLE.has(first)) return "safe";

  const verb = tokens[1];
  for (const { tool, verbs } of SAFE_TOOL_VERBS) {
    if (tool.test(first) && verb !== undefined && verbs.has(verb)) return "safe";
  }

  return "unknown";
}

export function classifyCommand(command: string): Classification {
  const segments = command
    .split(CHAIN_SPLIT)
    .map(normalizeSegment)
    .filter((s) => s.length > 0);

  if (segments.length === 0) return "unknown";

  const classes = segments.map(classifySegment);
  if (classes.some((c) => c === "run")) return "run";
  if (classes.every((c) => c === "safe")) return "safe";
  return "unknown";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/classify.test.ts`
Expected: PASS — all classifier tests green.

- [ ] **Step 5: Commit**

```bash
git add src/classify.ts test/classify.test.ts
git commit -m "feat: add segment-aware command classifier"
```

---

### Task 3: Settings parsing & merge (`src/config.ts`)

**Files:**
- Create: `src/config.ts`, `test/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 4, 5, 6):
  - `MAX_TIMEOUT_SECONDS: number` (= `2_147_483.647`).
  - `interface RunTimeoutConfig { maxSeconds?: number; fallbackMaxSeconds?: number }`.
  - `parseRunTimeout(settings: unknown): RunTimeoutConfig` — validate/clamp both keys from one parsed settings object.
  - `mergeRunTimeout(global: unknown, project: unknown): RunTimeoutConfig` — per-key project-overrides-global merge.

- [ ] **Step 1: Write the failing tests**

Create `test/config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  MAX_TIMEOUT_SECONDS,
  mergeRunTimeout,
  parseRunTimeout,
} from "../src/config.ts";

describe("parseRunTimeout", () => {
  it("parses both keys", () => {
    expect(parseRunTimeout({ runTimeout: { maxSeconds: 30, fallbackMaxSeconds: 120 } })).toEqual({
      maxSeconds: 30,
      fallbackMaxSeconds: 120,
    });
  });

  it("parses a single key", () => {
    expect(parseRunTimeout({ runTimeout: { fallbackMaxSeconds: 60 } })).toEqual({
      fallbackMaxSeconds: 60,
    });
  });

  it("returns empty config when runTimeout is missing or not an object", () => {
    expect(parseRunTimeout({})).toEqual({});
    expect(parseRunTimeout({ theme: "dark" })).toEqual({});
    expect(parseRunTimeout({ runTimeout: "soon" })).toEqual({});
    expect(parseRunTimeout(undefined)).toEqual({});
    expect(parseRunTimeout(null)).toEqual({});
    expect(parseRunTimeout("nope")).toEqual({});
  });

  it("drops invalid values per key", () => {
    expect(parseRunTimeout({ runTimeout: { maxSeconds: 0 } })).toEqual({});
    expect(parseRunTimeout({ runTimeout: { maxSeconds: -5 } })).toEqual({});
    expect(parseRunTimeout({ runTimeout: { maxSeconds: NaN } })).toEqual({});
    expect(parseRunTimeout({ runTimeout: { maxSeconds: Infinity } })).toEqual({});
    expect(parseRunTimeout({ runTimeout: { maxSeconds: "30" } })).toEqual({});
    // One valid, one invalid -> only the valid key survives.
    expect(parseRunTimeout({ runTimeout: { maxSeconds: 30, fallbackMaxSeconds: -1 } })).toEqual({
      maxSeconds: 30,
    });
  });

  it("clamps values above the bash tool ceiling", () => {
    expect(parseRunTimeout({ runTimeout: { maxSeconds: 9_999_999 } })).toEqual({
      maxSeconds: MAX_TIMEOUT_SECONDS,
    });
    expect(MAX_TIMEOUT_SECONDS).toBe(2_147_483.647);
  });
});

describe("mergeRunTimeout", () => {
  it("uses global when project has nothing", () => {
    expect(mergeRunTimeout({ runTimeout: { maxSeconds: 10 } }, {})).toEqual({ maxSeconds: 10 });
  });

  it("overrides per key (project wins where valid)", () => {
    expect(
      mergeRunTimeout(
        { runTimeout: { maxSeconds: 10, fallbackMaxSeconds: 100 } },
        { runTimeout: { maxSeconds: 5 } },
      ),
    ).toEqual({ maxSeconds: 5, fallbackMaxSeconds: 100 });
  });

  it("ignores an invalid project value and keeps global", () => {
    expect(
      mergeRunTimeout({ runTimeout: { maxSeconds: 10 } }, { runTimeout: { maxSeconds: -1 } }),
    ).toEqual({ maxSeconds: 10 });
  });

  it("returns empty config when neither defines anything valid", () => {
    expect(mergeRunTimeout({}, {})).toEqual({});
    expect(mergeRunTimeout(undefined, undefined)).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — cannot resolve `../src/config.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/config.ts`:

```typescript
/**
 * Settings parsing for pi-run-timeout. Pure, no I/O.
 * Units are seconds (pi's bash `timeout` unit). Values must be positive finite
 * numbers and are clamped to MAX_TIMEOUT_SECONDS (pi's bash tool ceiling).
 */

export const MAX_TIMEOUT_SECONDS = 2_147_483.647;

export interface RunTimeoutConfig {
  maxSeconds?: number;
  fallbackMaxSeconds?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampPositiveFinite(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(value, MAX_TIMEOUT_SECONDS);
}

/** Extract and validate both runTimeout keys from one parsed settings object. */
export function parseRunTimeout(settings: unknown): RunTimeoutConfig {
  const config: RunTimeoutConfig = {};
  if (!isRecord(settings)) return config;
  const runTimeout = settings.runTimeout;
  if (!isRecord(runTimeout)) return config;

  const maxSeconds = clampPositiveFinite(runTimeout.maxSeconds);
  if (maxSeconds !== undefined) config.maxSeconds = maxSeconds;

  const fallbackMaxSeconds = clampPositiveFinite(runTimeout.fallbackMaxSeconds);
  if (fallbackMaxSeconds !== undefined) config.fallbackMaxSeconds = fallbackMaxSeconds;

  return config;
}

/** Merge global + project settings per key; a valid project value wins. */
export function mergeRunTimeout(global: unknown, project: unknown): RunTimeoutConfig {
  const g = parseRunTimeout(global);
  const p = parseRunTimeout(project);
  const config: RunTimeoutConfig = {};

  const maxSeconds = p.maxSeconds ?? g.maxSeconds;
  if (maxSeconds !== undefined) config.maxSeconds = maxSeconds;

  const fallbackMaxSeconds = p.fallbackMaxSeconds ?? g.fallbackMaxSeconds;
  if (fallbackMaxSeconds !== undefined) config.fallbackMaxSeconds = fallbackMaxSeconds;

  return config;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/config.test.ts`
Expected: PASS — all config tests green.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: add runTimeout settings parsing and merge"
```

---

### Task 4: Filesystem settings loader (`src/load-settings.ts`)

**Files:**
- Create: `src/load-settings.ts`, `test/load-settings.test.ts`

**Interfaces:**
- Consumes: `mergeRunTimeout(global, project)` + `RunTimeoutConfig` from `src/config.ts` (Task 3).
- Produces (used by Task 6):
  - `readJsonFile(path: string): unknown | undefined` — parsed JSON, or `undefined` on missing/invalid.
  - `loadConfig(cwd: string, globalPath: string): RunTimeoutConfig` — reads global file at `globalPath` and project file at `<cwd>/.pi/settings.json`, merges. `globalPath` required so this module never imports pi.

- [ ] **Step 1: Write the failing tests**

Create `test/load-settings.test.ts`:

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, readJsonFile } from "../src/load-settings.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-run-timeout-"));
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/load-settings.test.ts`
Expected: FAIL — cannot resolve `../src/load-settings.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/load-settings.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/load-settings.test.ts`
Expected: PASS — all load-settings tests green.

- [ ] **Step 5: Commit**

```bash
git add src/load-settings.ts test/load-settings.test.ts
git commit -m "feat: add filesystem settings loader"
```

---

### Task 5: Resolution + handler core (`src/handler.ts`)

**Files:**
- Create: `src/handler.ts`, `test/handler.test.ts`

**Interfaces:**
- Consumes: `classifyCommand`, `Classification` (Task 2); `RunTimeoutConfig` (Task 3).
- Produces (used by Task 6):
  - `resolveTimeout(classification, explicitTimeout, config): number | undefined` — pure decision (spec §6).
  - `interface ToolInput { command?: unknown; timeout?: unknown }`.
  - `handleToolCall(toolName: string, input: ToolInput, config: RunTimeoutConfig): void` — classify -> resolve -> mutate `input.timeout`.

- [ ] **Step 1: Write the failing tests**

Create `test/handler.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { handleToolCall, resolveTimeout, type ToolInput } from "../src/handler.ts";

describe("resolveTimeout", () => {
  const cfg = { maxSeconds: 30, fallbackMaxSeconds: 120 };

  it("respects an explicit model timeout above all else", () => {
    expect(resolveTimeout("run", 5, cfg)).toBe(5);
    expect(resolveTimeout("safe", 5, cfg)).toBe(5);
    expect(resolveTimeout("unknown", 5, cfg)).toBe(5);
    expect(resolveTimeout("run", 0, cfg)).toBe(0);
  });

  it("never caps safe commands", () => {
    expect(resolveTimeout("safe", undefined, cfg)).toBeUndefined();
  });

  it("uses maxSeconds for run commands", () => {
    expect(resolveTimeout("run", undefined, cfg)).toBe(30);
  });

  it("falls back to fallbackMaxSeconds for run when maxSeconds absent", () => {
    expect(resolveTimeout("run", undefined, { fallbackMaxSeconds: 120 })).toBe(120);
  });

  it("uses fallbackMaxSeconds for unknown commands", () => {
    expect(resolveTimeout("unknown", undefined, cfg)).toBe(120);
  });

  it("returns undefined for unknown when no fallback configured", () => {
    expect(resolveTimeout("unknown", undefined, { maxSeconds: 30 })).toBeUndefined();
  });

  it("returns undefined for run when nothing configured", () => {
    expect(resolveTimeout("run", undefined, {})).toBeUndefined();
  });
});

describe("handleToolCall", () => {
  const cfg = { maxSeconds: 30, fallbackMaxSeconds: 120 };

  it("caps a run command at maxSeconds", () => {
    const input: ToolInput = { command: "./app" };
    handleToolCall("bash", input, cfg);
    expect(input.timeout).toBe(30);
  });

  it("caps an unknown command at fallbackMaxSeconds", () => {
    const input: ToolInput = { command: "sleep 300" };
    handleToolCall("bash", input, cfg);
    expect(input.timeout).toBe(120);
  });

  it("does not cap a safe command", () => {
    const input: ToolInput = { command: "git status" };
    handleToolCall("bash", input, cfg);
    expect(input.timeout).toBeUndefined();
  });

  it("does not override an explicit model timeout", () => {
    const input: ToolInput = { command: "./app", timeout: 5 };
    handleToolCall("bash", input, cfg);
    expect(input.timeout).toBe(5);
  });

  it("is inert when config is empty", () => {
    const input: ToolInput = { command: "./app" };
    handleToolCall("bash", input, {});
    expect(input.timeout).toBeUndefined();
  });

  it("ignores non-bash tools", () => {
    const input: ToolInput = { command: "./app" };
    handleToolCall("read", input, cfg);
    expect(input.timeout).toBeUndefined();
  });

  it("ignores non-string command and missing input gracefully", () => {
    const noCmd: ToolInput = {};
    handleToolCall("bash", noCmd, cfg);
    expect(noCmd.timeout).toBeUndefined();
    expect(() => handleToolCall("bash", undefined as unknown as ToolInput, cfg)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/handler.test.ts`
Expected: FAIL — cannot resolve `../src/handler.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/handler.ts`:

```typescript
/**
 * Resolution + handler core for pi-run-timeout. Pure, no pi imports.
 * Decides the timeout for a bash tool call and applies it by mutating
 * input.timeout in place (pi's tool_call contract: event.input is mutable and
 * no re-validation runs after mutation).
 */
import { type Classification, classifyCommand } from "./classify.ts";
import type { RunTimeoutConfig } from "./config.ts";

export interface ToolInput {
  command?: unknown;
  timeout?: unknown;
}

/**
 * Resolve the timeout (seconds) to apply.
 * - explicit model timeout always wins;
 * - safe commands are never capped;
 * - run commands use maxSeconds, falling back to fallbackMaxSeconds;
 * - unknown commands use fallbackMaxSeconds.
 * undefined means "inject nothing".
 */
export function resolveTimeout(
  classification: Classification,
  explicitTimeout: number | undefined,
  config: RunTimeoutConfig,
): number | undefined {
  if (explicitTimeout !== undefined) return explicitTimeout;
  if (classification === "safe") return undefined;
  if (classification === "run") return config.maxSeconds ?? config.fallbackMaxSeconds;
  return config.fallbackMaxSeconds;
}

/** Classify the command, resolve the timeout, and mutate input.timeout. */
export function handleToolCall(
  toolName: string,
  input: ToolInput,
  config: RunTimeoutConfig,
): void {
  if (toolName !== "bash") return;
  if (typeof input !== "object" || input === null) return;
  if (typeof input.command !== "string") return;

  const explicit = typeof input.timeout === "number" ? input.timeout : undefined;
  const classification = classifyCommand(input.command);
  const next = resolveTimeout(classification, explicit, config);
  if (next !== undefined) {
    input.timeout = next;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/handler.test.ts`
Expected: PASS — all handler tests green.

- [ ] **Step 5: Commit**

```bash
git add src/handler.ts test/handler.test.ts
git commit -m "feat: add timeout resolution and handler core"
```

---

### Task 6: Pi extension wiring (`extensions/run-timeout.ts`)

**Files:**
- Create: `extensions/run-timeout.ts`, `test/extension.test.ts`

**Interfaces:**
- Consumes: `handleToolCall`, `ToolInput` (Task 5); `loadConfig` (Task 4); `RunTimeoutConfig` (Task 3). From `@earendil-works/pi-coding-agent`: `ExtensionAPI` (type-only), `isToolCallEventType` + `getSettingsPath` (runtime).
- Produces: default export `runTimeoutExtension(pi: ExtensionAPI, deps?: RunTimeoutDeps): void`. Optional `deps.loadConfig` is a test seam; pi calls the export with just `pi`.

- [ ] **Step 1: Write the failing test (pi module mocked — no real runtime needed)**

Create `test/extension.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

// Mock pi so this test runs without the real runtime. Hoisted above the import.
vi.mock("@earendil-works/pi-coding-agent", () => ({
  isToolCallEventType: (name: string, ev: { toolName: string }) => ev.toolName === name,
  getAgentDir: () => "/mock/agent",
}));

import runTimeoutExtension from "../extensions/run-timeout.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;

function makeMockPi(): { on: ReturnType<typeof vi.fn>; handlers: Record<string, Handler> } {
  const handlers: Record<string, Handler> = {};
  const on = vi.fn((event: string, handler: Handler) => {
    handlers[event] = handler;
  });
  return { on, handlers };
}

describe("runTimeoutExtension", () => {
  it("registers a tool_call handler", () => {
    const pi = makeMockPi();
    runTimeoutExtension(pi as never);
    expect(pi.on).toHaveBeenCalledWith("tool_call", expect.any(Function));
  });

  it("caps a run command using loaded config", async () => {
    const pi = makeMockPi();
    runTimeoutExtension(pi as never, { loadConfig: () => ({ maxSeconds: 30 }) });
    const event = { toolName: "bash", input: { command: "./app" } };
    await pi.handlers.tool_call!(event, { cwd: "/proj" });
    expect(event.input.timeout).toBe(30);
  });

  it("caps an unknown command at the fallback", async () => {
    const pi = makeMockPi();
    runTimeoutExtension(pi as never, { loadConfig: () => ({ fallbackMaxSeconds: 120 }) });
    const event = { toolName: "bash", input: { command: "sleep 300" } };
    await pi.handlers.tool_call!(event, { cwd: "/proj" });
    expect(event.input.timeout).toBe(120);
  });

  it("does not cap safe commands", async () => {
    const pi = makeMockPi();
    runTimeoutExtension(pi as never, { loadConfig: () => ({ maxSeconds: 30, fallbackMaxSeconds: 120 }) });
    const event = { toolName: "bash", input: { command: "git status" } };
    await pi.handlers.tool_call!(event, { cwd: "/proj" });
    expect(event.input.timeout).toBeUndefined();
  });

  it("respects an explicit model timeout", async () => {
    const pi = makeMockPi();
    runTimeoutExtension(pi as never, { loadConfig: () => ({ maxSeconds: 30 }) });
    const event = { toolName: "bash", input: { command: "./app", timeout: 5 } };
    await pi.handlers.tool_call!(event, { cwd: "/proj" });
    expect(event.input.timeout).toBe(5);
  });

  it("is inert when config is empty", async () => {
    const pi = makeMockPi();
    runTimeoutExtension(pi as never, { loadConfig: () => ({}) });
    const event = { toolName: "bash", input: { command: "./app" } };
    await pi.handlers.tool_call!(event, { cwd: "/proj" });
    expect(event.input.timeout).toBeUndefined();
  });

  it("ignores non-bash tools", async () => {
    const pi = makeMockPi();
    runTimeoutExtension(pi as never, { loadConfig: () => ({ maxSeconds: 30 }) });
    const event = { toolName: "read", input: { path: "/x" } };
    await pi.handlers.tool_call!(event, { cwd: "/proj" });
    expect((event.input as { timeout?: number }).timeout).toBeUndefined();
  });

  it("passes ctx.cwd and the global settings path to the loader", async () => {
    const pi = makeMockPi();
    const loadConfig = vi.fn(() => ({ maxSeconds: 30 }));
    runTimeoutExtension(pi as never, { loadConfig });
    const event = { toolName: "bash", input: { command: "./app" } };
    await pi.handlers.tool_call!(event, { cwd: "/my/proj" });
    expect(loadConfig).toHaveBeenCalledWith("/my/proj", "/mock/agent/settings.json");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/extension.test.ts`
Expected: FAIL — cannot resolve `../extensions/run-timeout.ts`.

- [ ] **Step 3: Write the implementation**

Create `extensions/run-timeout.ts`:

```typescript
/**
 * pi-run-timeout extension.
 *
 * On every bash tool_call: load runTimeout config from merged pi settings
 * (project overrides global), classify the command, and inject a timeout cap
 * (seconds) into event.input.timeout. Pi's bash tool then kills the process
 * tree at the cap and returns a `timeout:<seconds>` error instead of hanging.
 *
 * This is the only file that imports @earendil-works/pi-coding-agent.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { RunTimeoutConfig } from "../src/config.ts";
import { type ToolInput, handleToolCall } from "../src/handler.ts";
import { loadConfig } from "../src/load-settings.ts";

export interface RunTimeoutDeps {
  /** Test seam: override the settings loader. Defaults to the fs loader. */
  loadConfig?: (cwd: string, globalPath: string) => RunTimeoutConfig;
}

export default function runTimeoutExtension(pi: ExtensionAPI, deps: RunTimeoutDeps = {}): void {
  const load = deps.loadConfig ?? loadConfig;

  pi.on("tool_call", (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return undefined;
    // pi's getSettingsPath() is not exported from the package root; getAgentDir() is.
    // getSettingsPath() === join(getAgentDir(), "settings.json") in pi source.
    const globalPath = join(getAgentDir(), "settings.json");
    const config = load(ctx.cwd, globalPath);
    handleToolCall(event.toolName, event.input as ToolInput, config);
    return undefined;
  });
}
```

- [ ] **Step 4: Run the extension tests**

Run: `npx vitest run test/extension.test.ts`
Expected: PASS — all extension tests green.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass (smoke, classify, config, load-settings, handler, extension); `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add extensions/run-timeout.ts test/extension.test.ts
git commit -m "feat: add pi tool_call extension wiring"
```

---

### Task 7: User documentation (`README.md`)

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: completed package (Tasks 1–6).
- Produces: thorough user-facing docs covering **install, configure, and usage**, plus a classification reference and FAQ.

- [ ] **Step 1: Write `README.md`**

Create `README.md`:

````markdown
# pi-run-timeout

A [pi](https://pi.dev) package that stops pi from waiting indefinitely when it
runs commands through the `bash` tool — for example, when pi builds your
program and then runs the resulting binary, which might block forever on stdin,
a socket, or a server loop.

You configure a maximum run time in pi's `settings.json`. pi injects it as the
bash tool's `timeout`, so the command's whole process tree is killed at the cap
and control returns to pi with a `timeout:<seconds>` result.

## How it works

On every `bash` tool call the extension:

1. Loads your `runTimeout` settings (project settings override global).
2. **Classifies** the command as `run`, `safe`, or `unknown` (see the
   [classification reference](#classification-reference)).
3. Resolves a timeout and injects it into the call:

   | Command class | Timeout applied |
   |---------------|-----------------|
   | `run` (recognized program launch) | `maxSeconds`, or `fallbackMaxSeconds` if `maxSeconds` is unset |
   | `unknown` (anything not recognized) | `fallbackMaxSeconds` |
   | `safe` (git / build / test / install / file ops) | never capped |

   A timeout the model set explicitly on the call is **always respected** and
   never overridden.

When the timeout elapses, pi kills the process tree and the tool returns a
`timeout:<seconds>` error, so pi can react instead of hanging.

## Install

### Local path (development / personal use)

Add the absolute path to the package in your pi settings:

```json
// ~/.pi/agent/settings.json
{
  "packages": ["/absolute/path/to/pi-run-timeout"]
}
```

Restart pi. The extension loads automatically.

### npm or git (later)

The package is structured for publishing with no changes. Once published:

```json
{ "packages": ["npm:pi-run-timeout"] }
```

or

```json
{ "packages": ["git:github.com/you/pi-run-timeout"] }
```

## Configure

Add a `runTimeout` object to `~/.pi/agent/settings.json` (global) or
`.pi/settings.json` (project). **Project settings override global settings per
key.**

| Key | Type | Meaning |
|-----|------|---------|
| `runTimeout.maxSeconds` | positive number (seconds) | Cap for **recognized run-commands**. |
| `runTimeout.fallbackMaxSeconds` | positive number (seconds) | Safety-net cap for **everything non-safe** — unknown commands, and run-commands when `maxSeconds` is unset. |

Rules:

- **Units are seconds** (pi's bash `timeout` unit).
- Values must be positive finite numbers. Values above `2147483.647` seconds
  (pi's bash ceiling) are clamped down. Invalid values are ignored.
- **Opt-in:** if neither key is set, the extension does nothing.

### Examples

Simplest "never hang" mode — cap every non-safe command at 2 minutes:

```json
{ "runTimeout": { "fallbackMaxSeconds": 120 } }
```

Tight cap on recognized program launches, looser net for everything else:

```json
{ "runTimeout": { "maxSeconds": 30, "fallbackMaxSeconds": 300 } }
```

Project override — global sets a loose fallback; this project wants a tight cap:

```json
// ~/.pi/agent/settings.json
{ "runTimeout": { "fallbackMaxSeconds": 300 } }

// .pi/settings.json
{ "runTimeout": { "maxSeconds": 10 } }

// Effective: maxSeconds = 10 (project), fallbackMaxSeconds = 300 (global)
```

## Classification reference

Commands are split on `&&`, `||`, `;`, and `|`, and leading wrappers (`sudo`,
`nohup`, `time`, `command`, `exec`, `env`, and `VAR=value` assignments) are
stripped before classifying. If **any** segment is a run-command, the whole
command is treated as `run`; if **all** segments are safe, it is `safe`;
otherwise `unknown`.

### `run` — capped at `maxSeconds` (or `fallbackMaxSeconds`)

| Shape | Examples |
|-------|----------|
| .NET | `dotnet run`, `dotnet bin/Debug/net8.0/App.dll`, `dotnet ./out/App.exe` |
| Node / Bun / Deno | `node dist/index.js`, `bun app.js`, `bun run dist/app.js`, `deno run main.ts` |
| Rust | `cargo run`, `cargo run --release` |
| Go | `go run .`, `go run cmd/server/main.go` |
| Python | `python main.py`, `python3 app.py`, `uv run serve.py` |
| Java | `java -jar app.jar`, `java com.example.Main` |
| PHP / Ruby | `php index.php`, `ruby script.rb` |
| npm scripts | `npm start`, `npm run serve` |
| Bare executable | `./app`, `./target/release/app`, `../bin/run`, `/usr/local/bin/tool`, `./app.exe` |

> **Note:** `npm run <script>` (including `npm run build`) is treated as `run`,
> because npm scripts commonly start long-lived processes. If a script is a
> quick build step, raise `maxSeconds` or have pi set an explicit timeout.

### `safe` — never capped

- File/text ops: `git`, `ls`, `cat`, `grep`, `rg`, `find`, `echo`, `mkdir`,
  `rm`, `cp`, `mv`, `touch`, `head`, `tail`, `wc`, `sort`, `diff`, …
- Build/test/install verbs: `cargo build|test|check|clippy`,
  `dotnet build|test|restore`, `go build|test|vet`, `make`, `cmake`, `mvn`,
  `gradle`, `npm|pnpm|yarn install|test|lint|build`, `pip install`, `brew`.

### `unknown` — capped at `fallbackMaxSeconds`

Anything not matched above, e.g. `sleep 30`, `curl https://…`,
`some-custom-tool`. This is the safety net that guarantees pi never hangs on an
unrecognized command (when `fallbackMaxSeconds` is set).

## Behavior & guarantees

- **Explicit timeouts win.** If pi sets a `timeout` on a specific bash call, it
  is never overridden.
- **Safe tooling is never capped**, so long builds and test suites run to
  completion.
- **Process tree is killed** at the cap (pi's bash tool behavior), so child
  processes don't linger.
- **No UI.** The timeout surfaces as the bash tool's `timeout:<seconds>` error,
  which the model sees and typically reports.

## FAQ / troubleshooting

**A command I expected to be capped wasn't.**
It probably classified as `safe`. Check the reference above. If it should be
capped, set `fallbackMaxSeconds` (covers `unknown`) — and if it's a tool we
marked safe that you want capped, that's a rule change in `src/classify.ts`.

**My build (`npm run build`) got killed.**
`npm run <script>` is classified as `run`. Raise `maxSeconds`, or have pi pass
an explicit longer `timeout` on that call (explicit timeouts are respected).

**I want to disable it temporarily.**
Remove the `runTimeout` keys (or set them to invalid values). The extension
becomes inert.

**Are seconds really the unit?**
Yes. pi's bash `timeout` is in seconds; this package matches it.

## Development

```bash
npm install
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

Architecture — all decision logic is pure and dependency-free under `src/`;
only `extensions/run-timeout.ts` imports pi:

| Module | Responsibility |
|--------|----------------|
| `src/classify.ts` | Segment-aware command classifier. |
| `src/config.ts` | Parse / validate / clamp / merge `runTimeout`. |
| `src/load-settings.ts` | Read global + project `settings.json`. |
| `src/handler.ts` | Resolve timeout and mutate the tool call input. |
| `extensions/run-timeout.ts` | Thin pi `tool_call` wiring. |

## License

MIT
````

- [ ] **Step 2: Sanity-check the markdown renders (headings + fenced blocks balanced)**

Run: `grep -c '^```' README.md`
Expected: an even number (every fence closed). Also eyeball `README.md` in a markdown viewer.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README (install, configure, usage, FAQ)"
```

---

### Task 8: Manual end-to-end verification

**Files:** none (verification only; scratch project under `/tmp`).

**Interfaces:**
- Consumes: completed, committed package.
- Produces: recorded confirmation that run / unknown / safe / inert behaviors all work in a real pi session.

- [ ] **Step 1: Create a scratch project that trusts the local package**

```bash
rm -rf /tmp/pi-rt-demo && mkdir -p /tmp/pi-rt-demo/.pi && cd /tmp/pi-rt-demo
git init -q
cat > .pi/settings.json <<JSON
{
  "packages": ["/Users/jamiefutch/projects/personal/pi-timeout"],
  "runTimeout": { "maxSeconds": 3, "fallbackMaxSeconds": 3 }
}
JSON
# A program that hangs forever (classifies as "run": bare executable).
printf '#!/bin/sh\nsleep 300\n' > hang && chmod +x hang
```

- [ ] **Step 2: Verify a run-command is capped**

Run:
```bash
cd /tmp/pi-rt-demo && pi -p --approve "Run this exact bash command and tell me the result: ./hang"
```
Expected: returns in ~3 seconds (not 300). The bash result contains `timeout:3` (or an equivalent timeout error). Confirms the `run` cap fired.

- [ ] **Step 3: Verify an unknown command is capped by the fallback**

Run:
```bash
cd /tmp/pi-rt-demo && pi -p --approve "Run this exact bash command and tell me the result: sleep 300"
```
Expected: returns in ~3 seconds; result contains `timeout:3`. Confirms the `unknown` fallback fired.

- [ ] **Step 4: Verify safe tooling is NOT capped**

Temporarily set tiny caps and run a safe command that finishes fast:
```bash
cd /tmp/pi-rt-demo && pi -p --approve "Run this exact bash command and show the output: git status"
```
Expected: `git status` output returns normally with **no** `timeout:` error (safe commands are never capped).

- [ ] **Step 5: Verify the extension is inert without settings**

```bash
cat > /tmp/pi-rt-demo/.pi/settings.json <<JSON
{ "packages": ["/Users/jamiefutch/projects/personal/pi-timeout"] }
JSON
cd /tmp/pi-rt-demo && pi -p --approve "Run this exact bash command: echo hello"
```
Expected: `hello` prints; no timeout injected (no `runTimeout` configured).

- [ ] **Step 6: Clean up**

```bash
rm -rf /tmp/pi-rt-demo
```

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-07-29-pi-run-timeout-design.md`):
- §4 settings contract (two keys, seconds, clamp, opt-in, per-key merge) → Tasks 3, 4. ✔
- §5 classification (segment-aware, wrappers, run/safe/unknown, combine rules) → Task 2. ✔
- §6 resolution (explicit wins, safe never, run -> max ?? fallback, unknown -> fallback) → Task 5. ✔
- §7 architecture/modules (pure core, single pi import, test seam) → Tasks 2–6. ✔
- §8 packaging (pi-package keyword, pi.extensions, files allowlist, zero runtime deps) → Task 1. ✔
- §9 testing (table-driven classifier, config, handler, loader, mocked extension) → Tasks 2–6. ✔
- §10 manual e2e (run/unknown/safe/inert) → Task 8. ✔
- User requirement "plenty of documentation for use/configure/install" → Task 7 (comprehensive README). ✔

**2. Placeholder scan:** no TBD/TODO/"similar to Task N"; every code step has full code; every run step has exact command + expected output. The only conditional is Task 1 Step 6's fallback install path (concrete). ✔

**3. Type/name consistency:**
- `Classification`, `classifyCommand` — defined Task 2, used Task 5. ✔
- `MAX_TIMEOUT_SECONDS`, `RunTimeoutConfig`, `parseRunTimeout`, `mergeRunTimeout` — defined Task 3, used Tasks 4, 5, 6. ✔
- `readJsonFile`, `loadConfig(cwd, globalPath)` — defined Task 4, used Task 6 with `(ctx.cwd, getSettingsPath())`. ✔
- `resolveTimeout`, `handleToolCall`, `ToolInput` — defined Task 5, used Task 6. ✔
- `runTimeoutExtension(pi, deps?)`, `RunTimeoutDeps.loadConfig(cwd, globalPath)` — defined + tested Task 6. ✔
- Units are seconds throughout. ✔

**4. Known accepted tradeoff:** `npm run <script>` (incl. `npm run build`) classifies as `run` and is capped — documented in spec §5, plan Task 2, and README. Approved during spec review.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-29-pi-run-timeout.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
