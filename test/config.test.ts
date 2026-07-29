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
