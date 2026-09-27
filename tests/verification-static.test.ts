import { describe, expect, it } from "vitest";
import { categorize } from "@/lib/analysis/categorizer";
import { samplePullRequest } from "@/lib/demo/sample-analysis";
import { parseDiff } from "@/lib/github/diff";
import type { ChangedFile } from "@/lib/types";
import { staticChecks } from "@/lib/verification/static";

function checksFor(path: string, patch: string, partial = false) {
  const lines = parseDiff(patch);
  const file: ChangedFile = {
    path,
    patch,
    lines,
    status: "modified",
    categories: categorize(path),
    additions:
      lines.filter((line) => line.kind === "add").length + (partial ? 1 : 0),
    deletions: lines.filter((line) => line.kind === "remove").length,
    risk: { score: 0, level: "LOW", reasons: [] },
  };
  return staticChecks({
    ...samplePullRequest(),
    changedFiles: 1,
    files: [file],
  });
}

describe("static dependency verification", () => {
  it("reports exact visible package requirement edits without claiming compatibility execution", () => {
    const patch =
      '@@ -1,5 +1,5 @@\n {\n   "dependencies": {\n-    "example": "^1.2.0",\n+    "example": "^2.0.0",\n     "unchanged": "1.0.0"\n   }\n }';
    const check = checksFor("package.json", patch).find(
      (item) => item.id === "dependencies",
    )!;
    expect(check.status).toBe("WARNING");
    expect(check.provenance).toBe("STATIC");
    expect(check.output).toContain("dependencies.example: ^1.2.0 → ^2.0.0");
    expect(check.output).not.toContain("unchanged");
    expect(check.description).toContain(
      "compatibility are separate execution checks",
    );
  });

  it("ignores dependency whitespace-only changes", () => {
    const patch =
      '@@ -1,3 +1,3 @@\n   "devDependencies": {\n-    "vitest": "^3.2.0"\n+      "vitest" : "^3.2.0"\n   }';
    const check = checksFor("package.json", patch).find(
      (item) => item.id === "dependencies",
    )!;
    expect(check.output).toBeUndefined();
    expect(check.description).toContain(
      "no attributable package requirement changes",
    );
  });

  it("does not treat manifest metadata as dependencies or inherit a section across omitted hunks", () => {
    const patch =
      '@@ -1,4 +1,4 @@\n   "dependencies": {\n-    "same": "1"\n+    "same": "1"\n   }\n@@ -80,1 +80,1 @@\n-  "version": "1.0.0"\n+  "version": "2.0.0"';
    expect(
      checksFor("package.json", patch).find(
        (item) => item.id === "dependencies",
      )!.output,
    ).toBeUndefined();
  });

  it("retains uncertainty for lockfile-only and incomplete manifest patches", () => {
    const check = checksFor(
      "package-lock.json",
      "@@ -2,1 +2,1 @@\n-old\n+new",
      true,
    ).find((item) => item.id === "dependencies")!;
    expect(check.status).toBe("WARNING");
    expect(check.output).toBeUndefined();
    expect(check.description).toContain("Patch coverage is incomplete");
  });
});

describe("static API verification", () => {
  it("detects visible route-method and exported signature changes", () => {
    const patch =
      "@@ -1,2 +1,2 @@\n-export async function GET(request: Request): Promise<Response> { return old(); }\n+export async function POST(request: Request): Promise<Response> { return next(); }";
    const check = checksFor("src/app/api/orders/route.ts", patch).find(
      (item) => item.id === "api",
    )!;
    expect(check.output).toContain(
      "removed declaration: export async function GET",
    );
    expect(check.output).toContain(
      "added declaration: export async function POST",
    );
    expect(check.description).toContain(
      "does not establish client compatibility",
    );
  });

  it("ignores body-only edits and equivalent signature formatting", () => {
    const patch =
      "@@ -1,1 +1,1 @@\n-export async function GET(request: Request): Promise<Response> { return old(); }\n+export async function GET( request : Request ) : Promise< Response > { return next(); }";
    const check = checksFor("src/app/api/orders/route.ts", patch).find(
      (item) => item.id === "api",
    )!;
    expect(check.output).toBeUndefined();
    expect(check.status).toBe("WARNING");
    expect(check.description).toContain("Body behavior");
  });

  it("recognizes literal route path changes while ignoring quote style changes", () => {
    const equivalent =
      "@@ -1,1 +1,1 @@\n-router.get(\"/orders\", oldHandler);\n+router.get('/orders', newHandler);";
    expect(
      checksFor("src/api/orders.ts", equivalent).find(
        (item) => item.id === "api",
      )!.output,
    ).toBeUndefined();
    const changed =
      '@@ -1,1 +1,1 @@\n-router.get("/orders", oldHandler);\n+router.get("/orders/:id", newHandler);';
    const check = checksFor("src/api/orders.ts", changed).find(
      (item) => item.id === "api",
    )!;
    expect(check.output).toContain("removed declaration: GET /orders");
    expect(check.output).toContain("added declaration: GET /orders/:id");
  });

  it("does not pretend multiline signatures or missing patches were completely checked", () => {
    const check = checksFor("src/api/orders.ts", "", true).find(
      (item) => item.id === "api",
    )!;
    expect(check.status).toBe("WARNING");
    expect(check.output).toBeUndefined();
    expect(check.description).toContain(
      "multiline signatures still require review",
    );
    expect(check.description).toContain("Patch coverage is incomplete");
  });

  it("labels absence of detected signals as static inspection only", () => {
    const checks = checksFor("docs/example.md", "@@ -1,1 +1,1 @@\n-old\n+new");
    expect(
      checks.every(
        (check) => check.status === "PASS" && check.provenance === "STATIC",
      ),
    ).toBe(true);
    expect(checks[0].description).toContain("retrieved diff");
  });
});
