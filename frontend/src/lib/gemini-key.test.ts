import { describe, expect, it } from "vitest";
import { GEMINI_KEY_MIN_LENGTH, geminiKeyProblem } from "./gemini-key";

describe("geminiKeyProblem", () => {
  it("accepts what the gateway accepts", () => {
    expect(GEMINI_KEY_MIN_LENGTH).toBe(20);
    expect(geminiKeyProblem(`  AIza${"x".repeat(35)}  `)).toBeNull();
    expect(geminiKeyProblem("x".repeat(20))).toBeNull();
  });

  it("explains what is wrong before anything is sent", () => {
    expect(geminiKeyProblem("   ")).toBe("Enter your Gemini API key.");
    for (const value of ["AIza-too-short", "x".repeat(19), "x".repeat(513), `AIza${"x".repeat(20)}\n`.repeat(2)]) {
      expect(geminiKeyProblem(value)).toMatch(/does not look like a Gemini API key/);
    }
  });
});
