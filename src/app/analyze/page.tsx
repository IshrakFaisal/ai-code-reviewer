import { Progress } from "@/components/investigation/progress";
import { getConfig } from "@/lib/config";
import { redirect } from "next/navigation";
export default async function AnalyzePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const config = getConfig();
  const hasInvestigation =
    (typeof p.input === "string" && p.input.trim().length > 0) ||
    p.demo === "true" ||
    typeof p.run === "string";
  if (!hasInvestigation) redirect("/");
  return (
    <Progress
      key={`${p.input}-${p.pr}-${p.demo}-${p.run}`}
      input={typeof p.input === "string" ? p.input : "acme/platform"}
      prNumber={typeof p.pr === "string" ? Number(p.pr) : undefined}
      demo={p.demo === "true"}
      configuredDemo={config.demo}
      initialRunId={typeof p.run === "string" ? p.run : undefined}
    />
  );
}
