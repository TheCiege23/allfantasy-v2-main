/**
 * Zod schemas for the RAW model drafts. The three-brain service validates every provider output against
 * these before use (the existing orchestration path never zod-validated provider output — this closes that
 * gap). Only the model's explanatory draft is validated here; the authoritative fields (status, agreement,
 * confidence, freshness, evidence identity) are stamped by deterministic server code afterward.
 */
import { z } from 'zod'

export const SpecialistFindingSchema = z.object({
  claim: z.string().min(1),
  evidenceIds: z.array(z.string()).default([]),
  impact: z.enum(['low', 'medium', 'high']).catch('medium').default('medium'),
})

/** What DeepSeek / Grok are asked to return. `status` is NOT model-owned — the server assigns it. */
export const SpecialistDraftSchema = z.object({
  findings: z.array(SpecialistFindingSchema).default([]),
  recommendation: z.string().optional(),
  caveats: z.array(z.string()).default([]),
})
export type SpecialistDraft = z.infer<typeof SpecialistDraftSchema>

/** What OpenAI is asked to return. agreementState / confidence / freshness / evidence identity are NOT
 *  model-owned — the server assigns/bounds them afterward. */
export const SynthesisDraftSchema = z.object({
  shortAnswer: z.string().min(1),
  whatDataSays: z.string().default(''),
  whatItMeans: z.string().default(''),
  recommendedAction: z.string().optional(),
  alternatives: z.array(z.string()).default([]),
  caveats: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
})
export type SynthesisDraft = z.infer<typeof SynthesisDraftSchema>

/** What Claude is asked to return when REVIEWING the OpenAI synthesis. `verdict` is the model's judgment;
 *  the server still owns status, confidence, freshness, and identity. */
export const ClaudeReviewDraftSchema = z.object({
  verdict: z.enum(['approved', 'qualified', 'rejected']).catch('qualified'),
  findings: z.array(SpecialistFindingSchema).default([]),
  requiredCaveats: z.array(z.string()).default([]),
  correctedContent: z
    .object({
      shortAnswer: z.string().optional(),
      whatDataSays: z.string().optional(),
      whatItMeans: z.string().optional(),
      recommendedAction: z.string().optional(),
      alternatives: z.array(z.string()).optional(),
    })
    .optional(),
})
export type ClaudeReviewDraft = z.infer<typeof ClaudeReviewDraftSchema>
