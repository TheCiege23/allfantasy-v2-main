import { z } from "zod"

export const SOCIAL_PULSE_SIGNAL_VALUES = [
  "up",
  "down",
  "mixed",
  "injury",
  "hype",
  "buy_low",
  "sell_high",
  "released",
  "traded",
  "idp_scarcity",
] as const

export const SocialPulseSignalSchema = z.enum(SOCIAL_PULSE_SIGNAL_VALUES)

export const SocialPulseRequestSchema = z.object({
  sport: z.enum(["NFL", "NBA"]),
  format: z.enum(["redraft", "dynasty", "specialty"]),
  idpEnabled: z.boolean().optional().default(false),
  players: z.array(z.string().min(2)).min(1).max(20),
  league_id: z.string().optional(),
})

export const SocialPulseResponseSchema = z.object({
  summary: z.string(),
  bullets: z.array(z.string()).min(3).max(15),
  market: z.array(
    z.object({
      player: z.string(),
      signal: SocialPulseSignalSchema,
      reason: z.string().optional(),
      confidence: z.number().min(0).max(100).optional(),
      impactScore: z.number().min(0).max(100).optional(),
      recencyHours: z.number().min(0).optional(),
    })
  ).max(20).optional(),
  connections: z.array(z.string()).optional(),
  lastUpdated: z.string().optional(),
  pulseScore: z.number().min(0).max(100).optional(),
  sources: z.array(z.string().min(1)).max(20).optional(),
})

export type SocialPulseResponse = z.infer<typeof SocialPulseResponseSchema>
export type SocialPulseSignal = z.infer<typeof SocialPulseSignalSchema>
