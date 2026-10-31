import { describe, expect, it, vi } from "vitest";
import { testContextLoader } from "@/lib/ai/test-context";
import {
  samplePullRequest,
  sampleHypotheses,
} from "@/lib/demo/sample-analysis";
import { NebiusProvider } from "@/lib/ai/nebius";

function repository() {
  const contents: Record<string, string> = {
    "src/auth/reset.ts":
      'import { token } from "./token.js"; export function reset(value: string) { return token(value); }',
    "src/auth/token.ts": "export const token = (value: string) => value;",
    "src/auth/reset.test.ts":
      'import { reset } from "./reset"; test("uses real exports", () => expect(reset("a")).toBe("a"));',
    "package.json": '{"devDependencies":{"vitest":"^3.2.0"}}',
    "tsconfig.json": '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
    "vitest.config.ts": 'export default { test: { environment: "jsdom" } };',
    "secrets.json": '{"password":"should not be supplied"}',
  };
  const entries = Object.entries(contents).map(([path, content], i) => ({
    path,
    content,
    sha: String(i + 1).repeat(40),
    size: Buffer.byteLength(content),
    mode: "100644",
    type: "blob",
  }));
  const transport = vi.fn<typeof fetch>(async (url) => {
    if (String(url).includes("/git/trees/"))
      return Response.json({ tree: entries, truncated: false });
    const file = entries.find((entry) => String(url).endsWith(entry.sha));
    if (!file) throw new Error("Unexpected Git object");
    return Response.json({
      sha: file.sha,
      size: file.size,
      encoding: "base64",
      content: Buffer.from(file.content).toString("base64"),
    });
  });
  return { entries, transport };
}
describe("generated test repository context", () => {
  it("loads pinned sources, actual nearby tests, manifests, configuration and relative dependencies", async () => {
    const pr = samplePullRequest(),
      { transport } = repository();
    const result = await testContextLoader(
      pr,
      undefined,
      transport,
    )(sampleHypotheses[0]);
    expect(String(transport.mock.calls[0][0])).toContain(
      `/git/trees/${pr.headSha}`,
    );
    expect(result.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "src/auth/reset.ts",
        "src/auth/token.ts",
        "src/auth/reset.test.ts",
        "package.json",
        "tsconfig.json",
        "vitest.config.ts",
      ]),
    );
    expect(result.files.some((file) => file.path === "secrets.json")).toBe(
      false,
    );
    expect(
      result.files.find((file) => file.role === "test")?.content,
    ).toContain("uses real exports");
    expect(result.limitations.join(" ")).toContain(
      "does not load repository aliases",
    );
    expect(
      transport.mock.calls.every(
        ([, options]) => options?.redirect === "error",
      ),
    ).toBe(true);
  });
  it("caches immutable objects across findings without dropping dependency imports", async () => {
    const { transport } = repository();
    const load = testContextLoader(samplePullRequest(), undefined, transport);
    const hypothesis = {
      ...sampleHypotheses[0],
      affectedFiles: [{ path: "src/auth/reset.ts" }],
    };
    const first = await load(hypothesis),
      count = transport.mock.calls.length;
    expect(
      first.files.find((file) => file.path === "src/auth/token.ts")?.role,
    ).toBe("dependency");
    expect(await load(hypothesis)).toEqual(first);
    expect(transport).toHaveBeenCalledTimes(count);
  });
  it("excludes symlinks and oversized blobs; labels truncated excerpts", async () => {
    const { entries, transport } = repository();
    entries.find((file) => file.path === "src/auth/token.ts")!.mode = "120000";
    const source = entries[0];
    source.content = "x".repeat(20000);
    source.size = 20000;
    entries.find((file) => file.path === "package.json")!.size = 50000;
    const result = await testContextLoader(
      samplePullRequest(),
      undefined,
      transport,
    )(sampleHypotheses[0]);
    expect(
      result.files.find((file) => file.path === source.path),
    ).toMatchObject({ truncated: true, content: "x".repeat(12000) });
    expect(result.files.some((file) => file.path === "src/auth/token.ts")).toBe(
      false,
    );
    expect(result.files.some((file) => file.path === "package.json")).toBe(
      false,
    );
    expect(result.limitations.join(" ")).toContain("size limits");
  });
  it("bounds tree reads and retains a useful limitation on unavailable context", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("x".repeat(2_000_001)));
    const result = await testContextLoader(
      samplePullRequest(),
      undefined,
      transport,
    )(sampleHypotheses[0]);
    expect(result.files).toEqual([]);
    expect(result.limitations.join(" ")).toContain(
      "source discovery was unavailable",
    );
  });
  it("does not issue reads after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const { transport } = repository();
    await expect(
      testContextLoader(
        samplePullRequest(),
        controller.signal,
        transport,
      )(sampleHypotheses[0]),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("includes source provenance and lets the model decline an unsupported test", async () => {
    const pr = samplePullRequest(),
      { transport } = repository();
    const repositoryContext = await testContextLoader(
      pr,
      undefined,
      transport,
    )(sampleHypotheses[0]);
    const provider = new NebiusProvider();
    const generate = vi
      .spyOn(provider, "structured")
      .mockResolvedValueOnce({
        plan: null,
        limitation: "DOM fixture requires a browser environment.",
      })
      .mockResolvedValueOnce({
        plan: {
          filename: "reset.test.ts",
          framework: "vitest",
          strategy: "Check token reuse",
          code: "import { reset } from '../src/auth/reset';",
        },
        limitation: "",
      });
    await expect(
      provider.generateVerificationPlan(
        pr,
        sampleHypotheses[0],
        repositoryContext,
      ),
    ).rejects.toThrow("DOM fixture");
    const plan = await provider.generateVerificationPlan(
      pr,
      sampleHypotheses[0],
      repositoryContext,
    );
    expect(plan.context.headSha).toBe(pr.headSha);
    expect(JSON.stringify(plan.context)).not.toContain("export function reset");
    expect(generate.mock.calls[0][1]).toMatchObject({
      repository: repositoryContext,
    });
    await expect(
      provider.generateVerificationPlan(pr, sampleHypotheses[0], {
        ...repositoryContext,
        headSha: "c".repeat(40),
      }),
    ).rejects.toThrow("Target source");
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
