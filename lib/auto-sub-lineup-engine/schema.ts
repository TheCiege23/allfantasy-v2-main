import { z } from 'zod'

export const AutoSubLineupEngineResultSchema = z.object({
  autoSubsExecuted: z.array(
    z.object({
      starterName: z.string(),
      starterStatus: z.string(),
      replacementName: z.string(),
      replacementPosition: z.string(),
      slot: z.string(),
      whyTriggered: z.string(),
      whyChosen: z.array(z.string()),
      usedPreferenceTieBreaker: z.boolean(),
      confidence: z.number(),
    })
  ),
  blockedAutoSubs: z.array(
    z.object({
      starterName: z.string(),
      reason: z.string(),
    })
  ),
  notifications: z.array(z.string()),
  auditLog: z.array(z.any()),
})

