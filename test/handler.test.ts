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

  it("treats a NaN explicit timeout as absent (run -> maxSeconds)", () => {
    const input: ToolInput = { command: "./app", timeout: NaN };
    handleToolCall("bash", input, cfg);
    expect(input.timeout).toBe(30);
  });

  it("treats an Infinity explicit timeout as absent (unknown -> fallback)", () => {
    const input: ToolInput = { command: "sleep 5", timeout: Infinity };
    handleToolCall("bash", input, cfg);
    expect(input.timeout).toBe(120);
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
