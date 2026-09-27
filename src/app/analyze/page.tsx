import { Progress } from "@/components/investigation/progress";
import { getConfig } from "@/lib/config";
export default async function AnalyzePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  return (
    <Progress
      key={`${p.input}-${p.demo}`}
      input={typeof p.input === "string" ? p.input : "acme/platform"}
      prNumber={typeof p.pr === "string" ? Number(p.pr) : undefined}
      demo={p.demo === "true"}
      configuredDemo={getConfig().demo}
    />
  );
}
