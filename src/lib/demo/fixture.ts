import { execFile } from "node:child_process";
import type { Evidence, GeneratedTest } from "@/lib/types";

// Trusted, bundled application code. Never substitute repository/model input here.
export const RESET_FIXTURE = `const tokens = new Map();
const passwords = new Map();
function issueToken(id, expiresAt = Date.now() + 60000) {
  tokens.set(id, { userId: "user-1", expiresAt });
  return id;
}
function resetPassword(token, password) {
  const record = tokens.get(token);
  if (!record || record.expiresAt <= Date.now()) return { status: 400 };
  passwords.set(record.userId, password);
  // Intentional demo defect: successful reset does not consume the token.
  return { status: 200 };
}`;
export const REUSE_TEST = `const token = issueToken("reuse-token");
assert.equal(resetPassword(token, "first-password").status, 200);
assert.equal(resetPassword(token, "second-password").status, 400,
  "A used reset token must be rejected");`;
export const demoGeneratedTest: GeneratedTest = {
  filename: "reset-token-reuse.test.mjs",
  framework: "node:test",
  strategy:
    "Issue a token, reset once, then attempt a second reset with the same token. Expect rejection.",
  code: `// AI-generated test template, curated and bundled for this demo.\nimport assert from "node:assert/strict";\n\n${RESET_FIXTURE}\n\n${REUSE_TEST}`,
};
export async function runDemoFixture(): Promise<Evidence[]> {
  const cases = [
    {
      name: "Valid token updates the password",
      code: `issueToken("valid"); assert.equal(resetPassword("valid", "new-password").status, 200); assert.equal(passwords.get("user-1"), "new-password");`,
    },
    {
      name: "Unknown token is rejected",
      code: `assert.equal(resetPassword("unknown", "new-password").status, 400);`,
    },
    {
      name: "Expired token is rejected",
      code: `issueToken("expired", Date.now() - 1000); assert.equal(resetPassword("expired", "new-password").status, 400);`,
    },
    { name: "Used token cannot be reused", code: REUSE_TEST },
  ];
  const script = `import assert from 'node:assert/strict';\n${RESET_FIXTURE}\nconst results = [];\n${cases.map((c, i) => `try { ${c.code} results.push({ index: ${i}, passed: true }); } catch(e) { results.push({ index: ${i}, passed: false, output: String(e), actual: e.actual, expected: e.expected }); }`).join("\n")}\nconsole.log(JSON.stringify(results));`;
  const start = Date.now();
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["--input-type=module", "--eval", script],
      {
        timeout: 10000,
        maxBuffer: 16000,
        windowsHide: true,
        env: { SystemRoot: process.env.SystemRoot, NODE_ENV: "test" },
      },
      (error, out) =>
        error
          ? reject(new Error("Bundled demo test runner could not execute."))
          : resolve(out),
    );
  });
  const results = JSON.parse(stdout) as {
    index: number;
    passed: boolean;
    output?: string;
    actual?: number;
    expected?: number;
  }[];
  return results.map((r) => ({
    id: `fixture-${r.index}`,
    type: "Generated test",
    status: r.passed ? "PASS" : "FAIL",
    description: cases[r.index].name,
    provenance: "DEMO_FIXTURE",
    output: r.passed
      ? `PASS ${cases[r.index].name}`
      : `FAIL ${cases[r.index].name}\n${r.output}\nExpected HTTP status: ${r.expected}\nReceived HTTP status: ${r.actual}`,
    durationMs: Date.now() - start,
    filePaths: ["src/auth/reset.ts", "src/auth/token.ts"],
  }));
}
