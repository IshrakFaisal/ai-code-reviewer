import { z } from "zod";
import type { AgentEvent } from "@/lib/types";

export type InvestigationCheckpoint = {
  values: Record<string, unknown>;
  events: AgentEvent[];
};
export type InvestigationSession = {
  id: string;
  checkpoint?: InvestigationCheckpoint;
  persist: (checkpoint: InvestigationCheckpoint) => Promise<void>;
};

/** Persist only successful step outputs. Never expose mutable live objects as saved state. */
export function checkpointSteps(session?: InvestigationSession) {
  const state: InvestigationCheckpoint = structuredClone(
    session?.checkpoint ?? { values: {}, events: [] },
  );
  const persist = async () => {
    await session?.persist(structuredClone(state));
  };
  return {
    events: state.events,
    read<T>(key: string, schema: z.ZodType<T>): T | undefined {
      return Object.hasOwn(state.values, key)
        ? schema.parse(structuredClone(state.values[key]))
        : undefined;
    },
    async write<T>(key: string, schema: z.ZodType<T>, value: T) {
      state.values[key] = structuredClone(schema.parse(value));
      await persist();
    },
    async event(event: AgentEvent) {
      if (
        state.events.some(
          (old) => old.stage === event.stage && old.status === event.status,
        )
      )
        return false;
      state.events.push(event);
      await persist();
      return true;
    },
    async step<T>(
      key: string,
      schema: z.ZodType<T>,
      work: () => Promise<T>,
    ): Promise<T> {
      if (Object.hasOwn(state.values, key))
        return schema.parse(structuredClone(state.values[key]));
      const value = schema.parse(await work());
      state.values[key] = structuredClone(value);
      await persist();
      return value;
    },
  };
}
