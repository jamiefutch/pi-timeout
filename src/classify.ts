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
