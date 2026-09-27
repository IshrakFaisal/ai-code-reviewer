import type { ChangedFile, Evidence, PullRequest } from "@/lib/types";

const dependencySections = new Set([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]);

/** Only attribute a string to a dependency when the diff shows its section. */
function dependencyEdits(file: ChangedFile): string[] {
  if (!/(^|\/)package\.json$/.test(file.path) || !file.patch) return [];
  const edits = {
    add: new Map<string, string>(),
    remove: new Map<string, string>(),
  };
  const section: Record<"add" | "remove", string | undefined> = {
    add: undefined,
    remove: undefined,
  };
  for (const raw of file.patch.split("\n")) {
    if (raw.startsWith("@@")) {
      section.add = section.remove = undefined;
      continue;
    }
    if (
      !/^[ +\-]/.test(raw) ||
      raw.startsWith("+++ ") ||
      raw.startsWith("--- ")
    )
      continue;
    const sides: ("add" | "remove")[] =
      raw[0] === " "
        ? ["add", "remove"]
        : raw[0] === "+"
          ? ["add"]
          : ["remove"];
    const line = raw.slice(1);
    for (const side of sides) {
      const start = /^\s*"([^"\\]+)"\s*:\s*\{\s*$/.exec(line);
      if (start) {
        section[side] = dependencySections.has(start[1]) ? start[1] : undefined;
        continue;
      }
      if (/^\s*}/.test(line)) section[side] = undefined;
      if (!section[side] || raw[0] === " ") continue;
      const entry = /^\s*"([^"\\]+)"\s*:\s*"([^"\\]+)"\s*,?\s*$/.exec(line);
      if (entry) edits[side].set(`${section[side]}.${entry[1]}`, entry[2]);
    }
  }
  return [...new Set([...edits.remove.keys(), ...edits.add.keys()])].flatMap(
    (name) => {
      const before = edits.remove.get(name),
        after = edits.add.get(name);
      if (before === after) return [];
      return [
        `${file.path}: ${name}: ${before ?? "not present on removed lines"} → ${after ?? "not present on added lines"}`,
      ];
    },
  );
}

/** Detect visible declarations only; a body edit is not a proved contract edit. */
function apiDeclarations(file: ChangedFile): string[] {
  const before = new Set<string>(),
    after = new Set<string>();
  for (const line of file.lines) {
    const value = line.content.trim();
    const route =
      /\b(?:app|router)\.(get|post|put|patch|delete|head|options)\s*\(\s*(["'`])([^"'`]+)\2/.exec(
        value,
      );
    const declaration =
      /^(?:export\s+)(?:default\s+)?(?:async\s+)?function\s+[$\w]+\s*\([^)]*\)(?:\s*:\s*[^={]+)?/.exec(
        value,
      )?.[0] ??
      /^export\s+(?:const|let|var)\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.exec(
        value,
      )?.[0];
    const normalized = declaration
      ? declaration
          .replace(/\s+/g, " ")
          .replace(/\s*([(),:<>?|&])\s*/g, "$1")
          .trim()
      : route && !route[3].includes("${")
        ? `${route[1].toUpperCase()} ${route[3]}`
        : undefined;
    if (normalized) (line.kind === "add" ? after : before).add(normalized);
  }
  return [
    ...[...before]
      .filter((s) => !after.has(s))
      .map((s) => `${file.path}: removed declaration: ${s}`),
    ...[...after]
      .filter((s) => !before.has(s))
      .map((s) => `${file.path}: added declaration: ${s}`),
  ];
}

export function staticChecks(pr: PullRequest): Evidence[] {
  const check = (
    id: string,
    type: string,
    files: string[],
    description: string,
    partial = false,
  ): Evidence => ({
    id,
    type,
    status: files.length || partial ? "WARNING" : "PASS",
    description: files.length
      ? description +
        (partial
          ? " Patch coverage is incomplete; further changes may be omitted."
          : "")
      : partial
        ? "Patch coverage is incomplete; absence cannot be established."
        : "No matching changes detected in the retrieved diff.",
    provenance: "STATIC",
    filePaths: files,
  });
  const paths = (category: string) =>
    pr.files
      .filter((f) => f.categories.some((c) => c === category))
      .map((f) => f.path);
  const partial =
    pr.files.length < pr.changedFiles ||
    pr.files.some((f) => f.lines.length < f.additions + f.deletions);
  const dependencies = pr.files.flatMap(dependencyEdits);
  const contracts = pr.files
    .filter((f) => f.categories.includes("API"))
    .flatMap(apiDeclarations);
  const env = new Set<string>();
  for (const f of pr.files)
    for (const l of f.lines.filter((l) => l.kind === "add")) {
      for (const m of l.content.matchAll(
        /(?:process\.env\.|import\.meta\.env\.)([A-Z][A-Z0-9_]*)|(?:process\.env\[\s*["'])([A-Z][A-Z0-9_]*)/g,
      ))
        env.add(m[1] || m[2]);
      if (f.categories.includes("ENVIRONMENT")) {
        const m = /^\s*([A-Z][A-Z0-9_]*)=/.exec(l.content);
        if (m) env.add(m[1]);
      }
    }
  const removed = pr.files
    .filter(
      (f) =>
        f.categories.includes("TESTS") &&
        (f.status === "removed" ||
          f.lines.some(
            (l) =>
              l.kind === "remove" &&
              /\b(test|it|describe)\s*\(/.test(l.content),
          )),
    )
    .map((f) => f.path);
  return [
    {
      ...check(
        "dependencies",
        "Dependencies",
        paths("DEPENDENCIES"),
        dependencies.length
          ? `${dependencies.length} dependency requirement changes detected in visible manifest sections. Installation and compatibility are separate execution checks.`
          : "Dependency manifests or lockfiles changed; no attributable package requirement changes could be extracted. Compatibility was not executed by this static check.",
        partial,
      ),
      ...(dependencies.length
        ? { output: dependencies.join("\n").slice(0, 32000) }
        : {}),
    },
    {
      id: "environment",
      type: "Environment variables",
      status: env.size || partial ? "WARNING" : "PASS",
      description: env.size
        ? `Added-line environment references: ${[...env].join(", ")}. References may already exist elsewhere.`
        : partial
          ? "Partial patch coverage; environment changes may be omitted."
          : "No new environment references in the retrieved diff.",
      provenance: "STATIC",
    },
    {
      ...check(
        "api",
        "Public API",
        paths("API"),
        contracts.length
          ? `${contracts.length} added or removed API declarations detected. Static detection does not establish client compatibility or a breaking change.`
          : "API files changed; no single-line route or exported function declaration changes detected. Body behavior, schemas, and multiline signatures still require review.",
        partial,
      ),
      ...(contracts.length
        ? { output: contracts.join("\n").slice(0, 32000) }
        : {}),
    },
    check(
      "migrations",
      "Database migrations",
      paths("DATABASE"),
      "Schema or persistence change detected; inspect rollback and existing data compatibility.",
      partial,
    ),
    check(
      "removed-tests",
      "Removed tests",
      removed,
      "Test definitions removed or rewritten; inspect retained coverage.",
      partial,
    ),
  ];
}
