import { describe, expect, it } from "vitest";
import { generatedEvidence } from "@/lib/verification/execution";
describe("generated assertion execution classification", () => {
  it.each([
    {
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 1,
    },
    { numTotalTests: 0, numPassedTests: 0, numFailedTests: 0 },
    {
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numRuntimeErrorTestSuites: 1,
    },
    { numTotalTests: 1, numPassedTests: 0, numFailedTests: 1 },
    {
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 1,
    },
    { numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, success: false },
    {
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      testResults: [{ status: "failed", assertionResults: [] }],
    },
  ])("never passes zero-assertion or inconsistent results", (output) => {
    expect(
      generatedEvidence({
        exitCode: 0,
        output: JSON.stringify(output),
        durationMs: 10,
        timedOut: false,
      }).status,
    ).toBe("WARNING");
  });
  it("recognizes a completed passing test and an assertion failure", () => {
    expect(
      generatedEvidence({
        exitCode: 0,
        output: JSON.stringify({
          numTotalTests: 1,
          numPassedTests: 1,
          numFailedTests: 0,
        }),
        durationMs: 10,
        timedOut: false,
      }).status,
    ).toBe("PASS");
    expect(
      generatedEvidence({
        exitCode: 1,
        output: JSON.stringify({
          numTotalTests: 1,
          numPassedTests: 0,
          numFailedTests: 1,
        }),
        durationMs: 10,
        timedOut: false,
      }).status,
    ).toBe("FAIL");
  });
  it("handles malformed output and timeout as inconclusive", () => {
    expect(
      generatedEvidence({
        exitCode: 1,
        output: "SyntaxError",
        durationMs: 10,
        timedOut: false,
      }).status,
    ).toBe("WARNING");
    expect(
      generatedEvidence({
        exitCode: 0,
        output: JSON.stringify({
          numTotalTests: 1,
          numPassedTests: 1,
          numFailedTests: 0,
        }),
        durationMs: 60000,
        timedOut: true,
      }).status,
    ).toBe("WARNING");
  });
});
