# pi-run-timeout Design Spec

**Date:** 2026-07-29
**Status:** Approved (design); pending user review of this written spec.
**Target:** A [pi](https://pi.dev) package (extension) that prevents pi from waiting indefinitely when it runs commands via the `bash` tool.

## 1. Problem

When pi builds a program and then runs the resulting binary (or runs any long-lived / interactive / server-like command), the command can block forever — waiting on stdin, a socket, or just never exiting. Pi's `bash` tool has **no default timeout**, so pi waits indefinitely and the session hangs. Pi already exposes an optional per-call `timeout` on the bash tool, but the model does not always set it.

## 2. Goal

Let the user configure a maximum run time in their pi `settings.json` so that run-style commands are killed after the cap and control returns to pi — **pi never waits indefinitely on a running program.**

### Non-goals (YAGNI)
- No custom UI / notifications. The bash tool already returns a `timeout:<seconds>` error to the model, which surfaces it.
- No per-command user configuration beyond the two global settings.
- No full shell parser. A lightweight segment-aware heuristic is sufficient.
- Not published to npm/git in v1 (but structured so publishing is a one-line change).

## 3. Verified pi internals (grounds the design)

Confirmed against pi source at `/Users/jamiefutch/projects/cloned/pi`:

- The bash tool's `timeout` input field is in **seconds** (`packages/coding-agent/src/core/tools/bash.ts`: schema description "Timeout in seconds"; internally `timeout * 1000`). Must be a positive finite number; ceiling `MAX_TIMEOUT_SECONDS = 2_147_483.647`. On elapsing, pi kills the whole process tree and throws `timeout:<seconds>`, which surfaces as a tool error returning control to pi.
- The `tool_call` extension event fires before a tool executes; `event.input` is **mutable**, mutations flow into the tool's `execute`, and **no re-validation** runs after mutation (`docs/extensions.md`, `src/core/extensions/types.ts`).
- `isToolCallEventType("bash", event)` narrows `event.input` to `BashToolInput` (`{ command: string; timeout?: number }`).
- `ExtensionContext.cwd: string` is available in the handler. `getSettingsPath()` lives in `src/config.ts` but is **not** re-exported from the package root; `getAgentDir()` **is** exported, and `getSettingsPath() === join(getAgentDir(), "settings.json")`, so the extension computes the global settings path from `getAgentDir()`.
- Extensions are loaded via `jiti` (`src/core/extensions/loader.ts`); relative `.ts` imports resolve.
- There is **no** sanctioned extension API for reading settings; reading `settings.json` files directly is the correct approach.
- Pi package manifest: `package.json` with `keywords: ["pi-package"]` and `pi.extensions: ["./extensions"]`; local install via `settings.json` `packages: ["/abs/path"]`.

## 4. Settings contract

Namespace `runTimeout` in pi `settings.json`. Applies to global (`~/.pi/agent/settings.json`) and project (`.pi/settings.json`); **project overrides global per-key**.

| Key | Type | Meaning |
|-----|------|---------|
| `runTimeout.maxSeconds` | positive finite number (seconds) | Stricter cap applied to **recognized run-commands**. |
| `runTimeout.fallbackMaxSeconds` | positive finite number (seconds) | Safety-net cap for **everything non-safe**: unknown commands, and run-commands when `maxSeconds` is absent. |

Rules:
- Units are **seconds**, matching the bash tool. Values are clamped down to `2147483.647`; non-positive / non-finite / non-number values are treated as absent.
- **Opt-in:** if both keys are absent (after merge), the extension is fully inert.
- A model-supplied explicit `timeout` on a bash call is **always respected** and never overridden.
- Per-key merge: project `maxSeconds` overrides global `maxSeconds` independently of `fallbackMaxSeconds`, and vice versa.

Example:
```json
{
  "runTimeout": {
    "maxSeconds": 30,
    "fallbackMaxSeconds": 120
  }
}
```

## 5. Command classification

Pure function `classifyCommand(command: string): "run" | "safe" | "unknown"`.

**Normalization:**
1. Split the command string on chain/pipe operators: `&&`, `||`, `;`, `|`.
2. Trim each segment; drop empties.
3. Strip leading wrapper tokens from each segment: `sudo`, `nohup`, `time`, and `env VAR=val ...` (repeated `KEY=VALUE` assignments).

**Per-segment rules (tested in order: run first, then safe, else unknown):**

- **run** (executes a program artifact; can hang):
  - `dotnet run`, `dotnet <path>.dll`, `dotnet <path>.exe`
  - `node <file>`, `bun <file>`, `bun run <file>`, `deno run <file>`
  - `cargo run`
  - `go run`
  - `python <file>`, `python3 <file>`, `uv run`
  - `java -jar <file>`, `java <class>`
  - `php <file>`, `ruby <file>`
  - `./<exec>` or `/<path>/<exec>` — a relative/absolute executable (no extension, or `.exe`/`.bin`)
  - `npm start`, `npm run <script>`
- **safe** (tooling that does work and exits; never capped):
  - File/text ops: `git`, `ls`, `cat`, `grep`, `rg`, `find`, `echo`, `pwd`, `which`, `mkdir`, `rm`, `cp`, `mv`, `touch`, `head`, `tail`, `wc`, `sort`, `uniq`, `diff`, `printf`, `stat`, `file`, `cd`, `export`, `true`, `false`
  - Build/test/install verbs: `cargo build|test|check|clippy`, `dotnet build|test|restore`, `go build|test|vet`, `make`, `cmake`, `mvn`, `gradle`, `npm|pnpm|yarn install|test|lint|build`, `pip install`, `apt`, `brew`

**Combining segments:**
- If **any** segment classifies as `run` → the whole command is `"run"` (a chain containing a run part can hang).
- Else if **every** segment classifies as `safe` → `"safe"`.
- Else → `"unknown"`.

Note: `sleep` is intentionally **not** in the safe list, so it falls to `unknown` (useful as a fallback-cap test and harmless in practice).

## 6. Timeout resolution

```
resolveTimeout(classification, explicitTimeout, maxSeconds, fallbackMaxSeconds):
  if explicitTimeout is defined → explicitTimeout      # model always wins
  if classification == "safe"   → undefined            # never capped
  if classification == "run"    → maxSeconds ?? fallbackMaxSeconds
  if classification == "unknown"→ fallbackMaxSeconds
  undefined means "inject nothing"
```

Consequences:
- Setting only `fallbackMaxSeconds` caps **all non-safe** commands (runs + unknown) — a simple "never hang" mode.
- Adding `maxSeconds` tightens the cap specifically for recognized run-commands.
- Safe tooling (git/build/test/install) is never capped regardless of settings.

## 7. Architecture

All decision logic lives in dependency-free pure modules under `src/` (only `node:` builtins). The single pi-aware file is the extension. This keeps every behavior unit-testable without the pi runtime.

| Module | Responsibility | Key exports |
|--------|----------------|-------------|
| `src/classify.ts` | Command classification heuristic + rule tables. No I/O. | `classifyCommand(cmd: string): "run" \| "safe" \| "unknown"` |
| `src/config.ts` | Parse/validate/clamp both settings keys; per-key project-overrides-global merge. No I/O. | `MAX_TIMEOUT_SECONDS`, `parseRunTimeout(settings): RunTimeoutConfig`, `mergeRunTimeout(global, project): RunTimeoutConfig` |
| `src/load-settings.ts` | Read global + project `settings.json`, delegate to `config.ts`. `node:fs` only. | `readJsonFile(path): unknown \| undefined`, `loadConfig(cwd, globalPath): RunTimeoutConfig` |
| `src/handler.ts` | Given a tool call + config, classify → resolve → mutate `input.timeout`. No pi import. | `handleToolCall(toolName, input: ToolInput, config: RunTimeoutConfig): void` |
| `extensions/run-timeout.ts` | Thin pi wiring: register `tool_call`, call `loadConfig(ctx.cwd, getSettingsPath())`, delegate to `handler.ts`. **Only file importing `@earendil-works/pi-coding-agent`.** | default `runTimeoutExtension(pi, deps?)` |

Shared type:
```typescript
interface RunTimeoutConfig {
  maxSeconds?: number;
  fallbackMaxSeconds?: number;
}
```

**Data flow (per bash tool call):**
```
tool_call event
  → isToolCallEventType("bash", event)?  (else no-op)
  → loadConfig(ctx.cwd, join(getAgentDir(), "settings.json")) → RunTimeoutConfig
  → classifyCommand(event.input.command)
  → resolveTimeout(classification, event.input.timeout, cfg.maxSeconds, cfg.fallbackMaxSeconds)
  → if defined: event.input.timeout = value   (mutation honored by pi)
```

**Design for isolation:** each module answers "what it does / how to use it / what it depends on" and can be tested alone. `classify`, `config`, and `handler` are pure; `load-settings` is the only I/O boundary; the extension is a ~15-line adapter. The extension accepts an optional `deps.loadConfig` seam so tests inject a stub and never touch pi or disk.

## 8. Packaging & distribution

`package.json`:
- `name: "pi-run-timeout"`, `version: "0.1.0"`, `type: "module"`.
- `keywords: ["pi-package"]`.
- `pi: { "extensions": ["./extensions"] }`.
- `files: ["extensions", "src", "README.md"]` (publish-ready; no hardcoded paths).
- `peerDependencies` + `devDependencies`: `@earendil-works/pi-coding-agent`.
- `devDependencies`: `typescript`, `vitest`, `@types/node`.
- **Zero runtime dependencies.**

Install (local, v1):
```json
// ~/.pi/agent/settings.json
{ "packages": ["/absolute/path/to/pi-run-timeout"] }
```
Publishing to npm (`npm:pi-run-timeout`) or git (`git:github.com/you/pi-run-timeout`) later requires no structural change.

## 9. Testing strategy

Unit tests (Vitest), table-driven where applicable:
- **classify:** `sudo ./app`→run, `env PORT=1 node dist/x.js`→run, `cargo build && ./target/release/app`→run, `nohup java -jar app.jar`→run, `git status`→safe, `npm test`→safe, `cargo build`→safe, `npm start`→run, `./hang`→run, `/usr/local/bin/tool`→run, `sleep 30`→unknown, `some-unknown-cmd`→unknown, `git status && ./app`→run.
- **config:** valid parse; clamp above ceiling; reject `0`/negative/`NaN`/`Infinity`/string; per-key merge (project overrides one key, inherits the other); both absent → empty config.
- **handler:** run+maxSeconds→maxSeconds; run+no maxSeconds→fallback; unknown→fallback; safe→undefined; explicit model timeout always wins; non-bash tool→no-op; missing input→no throw.
- **load-settings:** valid JSON, missing file, invalid JSON, project-overrides-global, neither file.
- **extension:** registers `tool_call`; injects via mocked `loadConfig`; respects explicit timeout; no-op for non-bash; passes `ctx.cwd` + `getSettingsPath()`. Pi module mocked via `vi.mock`.

## 10. Manual end-to-end verification

In a scratch project trusting the local package:
1. `runTimeout.maxSeconds: 3` → ask pi to run a bare hanging executable `./hang` (classifies `run`) → killed ~3s, result contains `timeout:3`.
2. `runTimeout.fallbackMaxSeconds: 3` → `sleep 30` (classifies `unknown`) → killed ~3s.
3. `git status` (classifies `safe`) → runs uncapped regardless of settings.
4. Remove both keys → extension inert; a short command behaves normally.

## 11. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Heuristic misclassifies a run command as safe → hang. | Safe list is conservative (only obvious tooling); anything unrecognized is `unknown` → fallback cap. `fallbackMaxSeconds` is the true guarantee. |
| Compound commands hide a run part. | Segment-aware: any run segment ⇒ whole command capped. |
| Injected timeout exceeds pi ceiling → tool throws. | `parseRunTimeout` clamps to `2147483.647`. |
| Capping a legitimately long run command. | Model can set its own explicit `timeout`, which is always respected; user can raise `maxSeconds`. |
| pi rejects unknown `runTimeout` settings key. | We read the file directly; pi ignores unknown keys in its own parse (no validation error observed). Non-fatal either way. |
| `@earendil-works/pi-coding-agent` not on public npm during dev. | Install from local clone (`/Users/jamiefutch/projects/cloned/pi/packages/coding-agent`); pure core + mocked extension test don't require it at test time. |

## 12. Decisions log (from interview)

| # | Question | Decision |
|---|----------|----------|
| Q1 | Cap scope | **Targeted** — run-style commands, not every bash call. |
| Q2 | Ecosystems | Broad: .NET, Node/TS, Rust, Go, Python, Java, bare executables. |
| Q3 | Matching strategy | **Allowlist of run patterns + `fallbackMaxSeconds` safety net**; safe tooling exempt. |
| Q4 | Timeout UX | Kill + model error only; **no extra UI**. |
| Q5 | Distribution | **Local now, publish-ready structure** (no hardcoded paths, `files` allowlist). |
| Appr. | Detector implementation | **Segment-aware classifier** (split chains, strip wrappers, classify per segment). |
