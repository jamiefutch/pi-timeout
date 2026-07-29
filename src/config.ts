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
