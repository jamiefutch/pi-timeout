/**
 * pi-timeout extension.
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
    const globalPath = join(getAgentDir(), "settings.json");
    const config = load(ctx.cwd, globalPath);
    handleToolCall(event.toolName, event.input as ToolInput, config);
    return undefined;
  });
}
