import { z } from "zod";
import { STAGES } from "@/lib/types";
export const analysisMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heartbeat") }),
  z.object({
    type: z.literal("progress"),
    event: z
      .object({
        stage: z
          .number()
          .int()
          .min(0)
          .max(STAGES.length - 1),
        label: z.string().min(1).max(150),
        detail: z.string().max(5000),
        at: z.iso.datetime(),
        phase: z.string().max(100).optional(),
        status: z.enum(["RUNNING", "COMPLETE"]).optional(),
      })
      .refine((event) => event.label === STAGES[event.stage]),
  }),
  z.object({ type: z.literal("error"), error: z.string().min(1).max(5000) }),
  z.object({ type: z.literal("complete"), id: z.string().uuid() }),
]);
