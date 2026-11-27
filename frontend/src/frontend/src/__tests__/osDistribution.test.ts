import { normalizeOS } from "@/lib/endpoints";
import { describe, expect, it } from "vitest";

describe("normalizeOS", () => {
  it.each([
    ["windows", "Windows"],
    ["Windows 11 Pro", "Windows"],
    ["LINUX", "Linux"],
    ["macos", "macOS"],
    ["Darwin", "macOS"],
  ])("normalizes %s to %s", (value, expected) => {
    expect(normalizeOS(value)).toBe(expected);
  });
});
