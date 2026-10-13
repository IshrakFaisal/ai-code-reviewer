import { STAGES, type AgentEvent } from "@/lib/types";

/** Older saved events were emitted at completion and have no explicit status. */
export function completedStageCount(events: AgentEvent[]) {
  const last = events.at(-1);
  if (!last) return 0;
  return Math.max(
    0,
    Math.min(STAGES.length, last.stage + (last.status === "RUNNING" ? 0 : 1)),
  );
}
