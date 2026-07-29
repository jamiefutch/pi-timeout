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

  const explicit =
    typeof input.timeout === "number" && Number.isFinite(input.timeout) ? input.timeout : undefined;
  const classification = classifyCommand(input.command);
  const next = resolveTimeout(classification, explicit, config);
  if (next !== undefined) {
    input.timeout = next;
  }
}
