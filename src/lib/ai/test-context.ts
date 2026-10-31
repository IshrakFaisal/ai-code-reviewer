import path from "node:path";
import { githubClient } from "@/lib/github/client";
import type { Hypothesis, PullRequest } from "@/lib/types";

export type TestContext = {
  headSha: string;
  files: {
    path: string;
    sha: string;
    role: "source" | "test" | "configuration" | "dependency";
    content: string;
    truncated: boolean;
  }[];
  limitations: string[];
};
type Blob = { path: string; sha: string; size: number };
const codeFile = /\.(?:[cm]?[jt]sx?|json)$/i;
const testFile =
  /(?:^|\/)(?:__tests__\/.*|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?)$/i;
const configFile =
  /(?:^|\/)(?:package\.json|tsconfig(?:\.[\w-]+)?\.json|(?:vitest|vite)\.config\.[cm]?[jt]s|(?:vitest\.)?setup\.[cm]?[jt]s)$/i;
function safeFile(value: string) {
  return (
    value.length <= 500 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value
      .split("/")
      .some(
        (part) =>
          part === ".." ||
          part === "." ||
          part === "node_modules" ||
          part === ".git",
      ) &&
    codeFile.test(value) &&
    !/(?:^|\/)(?:\.env|credentials|secrets?)(?:\.|\/|$)/i.test(value)
  );
}

/** Only immutable Git objects are read; no repository code or configuration is executed. */
export function testContextLoader(
  pr: PullRequest,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
) {
  const github = githubClient(async (url, options) => {
    const response = await transport(url, { ...options, redirect: "error" });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Repository context response is empty.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2_000_000)
          throw new Error("Repository context exceeds the read limit.");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      headers: response.headers,
    });
  });
  let tree: Promise<{ files: Blob[]; truncated: boolean }> | undefined;
  const cache = new Map<string, Promise<string>>();
  return async (hypothesis: Hypothesis): Promise<TestContext> => {
    signal?.throwIfAborted();
    const context: TestContext = {
      headSha: pr.headSha,
      files: [],
      limitations: [],
    };
    const bounded = AbortSignal.any([
      AbortSignal.timeout(15000),
      ...(signal ? [signal] : []),
    ]);
    try {
      tree ??= github.git
        .getTree({
          owner: pr.owner,
          repo: pr.repo,
          tree_sha: pr.headSha,
          recursive: "1",
          request: { signal: bounded },
        })
        .then(({ data }) => ({
          files: data.tree
            .slice(0, 10000)
            .filter(
              (entry) =>
                entry.type === "blob" &&
                ["100644", "100755"].includes(entry.mode ?? "") &&
                safeFile(entry.path ?? ""),
            )
            .map((entry) => ({
              path: entry.path!,
              sha: entry.sha!,
              size: entry.size ?? Infinity,
            })),
          truncated: data.truncated || data.tree.length > 10000,
        }));
      const index = await tree;
      if (index.truncated)
        context.limitations.push(
          "Repository file discovery was truncated; some dependencies or tests may be missing.",
        );
      const targets = hypothesis.affectedFiles.map((ref) => ref.path);
      const byPath = new Map(index.files.map((file) => [file.path, file]));
      const selected = new Set<string>();
      let characters = 60000;
      const add = async (
        filename: string,
        role: TestContext["files"][number]["role"],
      ) => {
        if (selected.has(filename)) return;
        selected.add(filename);
        const blob = byPath.get(filename);
        if (!blob) {
          context.limitations.push(
            `Unavailable at the recorded head: ${filename}`,
          );
          return;
        }
        if (
          context.files.length >= 12 ||
          characters <= 0 ||
          blob.size > 32768
        ) {
          context.limitations.push(
            `Omitted by context size limits: ${filename}`,
          );
          return;
        }
        try {
          if (!cache.has(blob.sha)) {
            if (cache.size >= 30)
              throw new Error("Context request budget exhausted");
            cache.set(
              blob.sha,
              github.git
                .getBlob({
                  owner: pr.owner,
                  repo: pr.repo,
                  file_sha: blob.sha,
                  request: { signal: bounded },
                })
                .then(({ data }) => {
                  if (
                    data.encoding !== "base64" ||
                    data.sha !== blob.sha ||
                    typeof data.size !== "number" ||
                    data.size > 32768
                  )
                    throw new Error("Invalid blob");
                  const bytes = Buffer.from(data.content, "base64");
                  if (bytes.length > 32768 || bytes.includes(0))
                    throw new Error("Binary or oversized file");
                  return new TextDecoder("utf-8", { fatal: true }).decode(
                    bytes,
                  );
                }),
            );
          }
          const full = await cache.get(blob.sha)!;
          const content = full.slice(0, Math.min(12000, characters));
          characters -= content.length;
          context.files.push({
            path: filename,
            sha: blob.sha,
            role,
            content,
            truncated: content.length < full.length,
          });
          if (content.length < full.length)
            context.limitations.push(`Source excerpt truncated: ${filename}`);
        } catch {
          signal?.throwIfAborted();
          context.limitations.push(
            `Could not read repository context: ${filename}`,
          );
        }
      };
      for (const target of targets) await add(target, "source");
      const directories = new Set([
        ".",
        ...targets.flatMap((target) => {
          const result: string[] = [];
          for (
            let dir = path.posix.dirname(target);
            dir !== ".";
            dir = path.posix.dirname(dir)
          )
            result.push(dir);
          return result;
        }),
      ]);
      for (const file of index.files
        .filter(
          (file) =>
            configFile.test(file.path) &&
            directories.has(path.posix.dirname(file.path)),
        )
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, 4))
        await add(file.path, "configuration");
      const stems = targets.map((target) =>
        path.posix.basename(target).replace(/\.[^.]+$/, ""),
      );
      const nearby = index.files
        .filter((file) => testFile.test(file.path))
        .map((file) => ({
          ...file,
          relevance:
            (stems.some((stem) =>
              path.posix.basename(file.path).startsWith(`${stem}.`),
            )
              ? 2
              : 0) +
            (targets.some(
              (target) =>
                path.posix.dirname(target) === path.posix.dirname(file.path),
            )
              ? 1
              : 0),
        }))
        .filter((file) => file.relevance > 0)
        .sort(
          (a, b) => b.relevance - a.relevance || a.path.localeCompare(b.path),
        );
      for (const file of nearby.slice(0, 3)) await add(file.path, "test");
      // Resolve one hop of literal relative imports from supplied source/tests. Aliases are disclosed, never guessed.
      for (const file of [...context.files].filter(
        (file) => file.role !== "configuration",
      )) {
        for (const match of file.content.matchAll(
          /(?:from\s*|import\s*|require\s*\()\s*["'](\.[^"']+)["']/g,
        )) {
          const base = path.posix.normalize(
            path.posix.join(path.posix.dirname(file.path), match[1]),
          );
          const candidates = [
            base,
            ...[
              ".ts",
              ".tsx",
              ".js",
              ".mjs",
              "/index.ts",
              "/index.tsx",
              "/index.js",
            ].map((suffix) => base + suffix),
            base.replace(/\.js$/, ".ts"),
          ];
          const resolved = candidates.find((candidate) =>
            byPath.has(candidate),
          );
          if (resolved) await add(resolved, "dependency");
          else
            context.limitations.push(
              `Unresolved relative import in ${file.path}: ${match[1]}`,
            );
        }
      }
    } catch {
      signal?.throwIfAborted();
      context.limitations.push(
        "Repository source discovery was unavailable. Diff excerpts alone may be insufficient to generate a valid test.",
      );
    }
    context.limitations.push(
      "Only the recorded head was read. The isolated Node runner does not load repository aliases, plugins, browser environments, or setup files. Test examples and configuration are reference data only.",
    );
    context.limitations = [...new Set(context.limitations)].slice(0, 40);
    return context;
  };
}
