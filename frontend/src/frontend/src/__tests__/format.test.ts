import { securityHealthScoreBg } from "@/lib/format";
import { describe, expect, it } from "vitest";

describe("securityHealthScoreBg", () => {
  it("colors scores above 70 green", () => {
    expect(securityHealthScoreBg(71)).toBe("bg-success/15 text-success");
    expect(securityHealthScoreBg(100)).toBe("bg-success/15 text-success");
  });

  it("keeps scores of 70 or below out of the green range", () => {
    expect(securityHealthScoreBg(70)).toBe("bg-warning/15 text-warning");
    expect(securityHealthScoreBg(30)).toBe(
      "bg-destructive/15 text-destructive",
    );
  });
});
