import type { Category, ChangedFile } from "@/lib/types";

export interface CategoryRefinement {
  path: string;
  categories: Category[];
}
const rules: [Category, RegExp][] = [
  ["TESTS", /(^|\/)(__tests__|tests?|spec)(\/|\.)|\.(test|spec)\./i],
  ["AUTHENTICATION", /(^|\/)(auth|session|oauth)(\/|\.)|password|token|login/i],
  ["AUTHORIZATION", /permission|polic(y|ies)|rbac|middleware|acl/i],
  ["DATABASE", /prisma\/|migration|schema\.(sql|prisma)|(^|\/)db\//i],
  ["API", /(^|\/)(api|routes|controllers)\/|openapi|swagger/i],
  ["PAYMENTS", /payment|billing|stripe|checkout/i],
  [
    "DEPENDENCIES",
    /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|pyproject\.toml|go\.(mod|sum))$/i,
  ],
  [
    "INFRASTRUCTURE",
    /Dockerfile|docker-compose|\.github\/|terraform|\.tf$|k8s\//i,
  ],
  ["ENVIRONMENT", /(^|\/)\.env[^/]*$/i],
  ["CONFIGURATION", /(^|\/)config\/|\.config\.|tsconfig/i],
  ["UI", /\.(tsx|jsx|css|scss|vue|svelte)$|(^|\/)components\//i],
  ["EMAIL", /email|mailer|mail\/|smtp/i],
  ["BACKGROUND JOBS", /(^|\/)(jobs|workers|queues|cron)\//i],
  ["SECURITY", /crypt|secur|sanitiz|csrf|cors/i],
  ["LOGGING", /logg|telemetry|observability/i],
];
export function categorize(path: string): Category[] {
  const found = rules.filter(([, r]) => r.test(path)).map(([c]) => c);
  // Test fixtures named after sensitive systems are not production authentication changes.
  return found.includes("TESTS")
    ? ["TESTS"]
    : found.length
      ? found
      : ["UNKNOWN"];
}

/** AI can add review signals, but cannot erase a deterministic signal or disguise production code as tests. */
export function refineCategories(
  files: ChangedFile[],
  refinements: CategoryRefinement[],
): ChangedFile[] {
  return files.map((file) => {
    if (file.categories.includes("TESTS")) return file;
    const additions = refinements
      .filter((item) => item.path === file.path)
      .flatMap((item) => item.categories)
      .filter((category) => category !== "UNKNOWN" && category !== "TESTS");
    if (!additions.length) return file;
    return {
      ...file,
      categories: [...new Set([...file.categories, ...additions])].filter(
        (category) => category !== "UNKNOWN",
      ),
    };
  });
}
