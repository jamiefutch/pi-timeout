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
