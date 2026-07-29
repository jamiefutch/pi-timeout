import { describe, expect, it, vi } from "vitest";

// Mock pi so this test runs without the real runtime. Hoisted above the import.
vi.mock("@earendil-works/pi-coding-agent", () => ({
  isToolCallEventType: (name: string, ev: { toolName: string }) => ev.toolName === name,
  getAgentDir: () => "/mock/agent",
}));

import runTimeoutExtension from "../extensions/run-timeout.ts";

type MockEvent = { toolName: string; input: { command?: string; timeout?: number; path?: string } };

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
    const event: MockEvent = { toolName: "bash", input: { command: "./app" } };
    await pi.handlers.tool_call!(event, { cwd: "/proj" });
    expect(event.input.timeout).toBe(30);
  });

  it("caps an unknown command at the fallback", async () => {
    const pi = makeMockPi();
    runTimeoutExtension(pi as never, { loadConfig: () => ({ fallbackMaxSeconds: 120 }) });
    const event: MockEvent = { toolName: "bash", input: { command: "sleep 300" } };
    await pi.handlers.tool_call!(event, { cwd: "/proj" });
    expect(event.input.timeout).toBe(120);
  });

  it("does not cap safe commands", async () => {
    const pi = makeMockPi();
    runTimeoutExtension(pi as never, { loadConfig: () => ({ maxSeconds: 30, fallbackMaxSeconds: 120 }) });
    const event: MockEvent = { toolName: "bash", input: { command: "git status" } };
    await pi.handlers.tool_call!(event, { cwd: "/proj" });
    expect(event.input.timeout).toBeUndefined();
  });

  it("respects an explicit model timeout", async () => {
    const pi = makeMockPi();
    runTimeoutExtension(pi as never, { loadConfig: () => ({ maxSeconds: 30 }) });
    const event: MockEvent = { toolName: "bash", input: { command: "./app", timeout: 5 } };
    await pi.handlers.tool_call!(event, { cwd: "/proj" });
    expect(event.input.timeout).toBe(5);
  });

  it("is inert when config is empty", async () => {
    const pi = makeMockPi();
    runTimeoutExtension(pi as never, { loadConfig: () => ({}) });
    const event: MockEvent = { toolName: "bash", input: { command: "./app" } };
    await pi.handlers.tool_call!(event, { cwd: "/proj" });
    expect(event.input.timeout).toBeUndefined();
  });

  it("ignores non-bash tools", async () => {
    const pi = makeMockPi();
    runTimeoutExtension(pi as never, { loadConfig: () => ({ maxSeconds: 30 }) });
    const event: MockEvent = { toolName: "read", input: { path: "/x" } };
    await pi.handlers.tool_call!(event, { cwd: "/proj" });
    expect(event.input.timeout).toBeUndefined();
  });

  it("passes ctx.cwd and the global settings path to the loader", async () => {
    const pi = makeMockPi();
    const loadConfig = vi.fn(() => ({ maxSeconds: 30 }));
    runTimeoutExtension(pi as never, { loadConfig });
    const event: MockEvent = { toolName: "bash", input: { command: "./app" } };
    await pi.handlers.tool_call!(event, { cwd: "/my/proj" });
    expect(loadConfig).toHaveBeenCalledWith("/my/proj", "/mock/agent/settings.json");
  });
});
