import type { Category, ChangedFile } from "@/lib/types";
const connections: Partial<Record<Category, Category[]>> = {
  AUTHENTICATION: ["API", "DATABASE", "EMAIL"],
  AUTHORIZATION: ["API", "DATABASE"],
  DATABASE: ["API", "BACKGROUND JOBS"],
  API: ["UI", "DATABASE"],
  PAYMENTS: ["API", "DATABASE", "EMAIL"],
  EMAIL: ["AUTHENTICATION", "BACKGROUND JOBS"],
};
export function blastRadius(files: ChangedFile[]) {
  const grouped = new Map<Category, ChangedFile[]>();
  for (const file of files)
    for (const c of file.categories)
      grouped.set(c, [...(grouped.get(c) || []), file]);
  return [...grouped]
    .map(([category, members]) => {
      const top = members.reduce((a, b) =>
        a.risk.score > b.risk.score ? a : b,
      );
      return {
        category,
        ...top.risk,
        fileCount: members.length,
        connected: connections[category] || [],
      };
    })
    .sort((a, b) => b.score - a.score);
}
