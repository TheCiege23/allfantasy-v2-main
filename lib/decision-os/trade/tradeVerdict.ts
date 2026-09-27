import { z } from 'zod'

/**
 * THE AI EXPLANATION'S SHAPE (design, "AI explanation layer"). Strict: an unknown key is a failed
 * answer, not an ignored one — a model that adds `fairnessScore` or `winProbability` has invented a
 * number the page would otherwise be tempted to print.
 *
 * Two deliberate differences from the design's interface, both about a WITHHELD grade:
 *   - `grades` is empty and `verdict` is null when the engine gave no letter. The design's enum has no
 *     "not graded", and forcing one of its four values would state a judgement nobody made.
 *   - `commissioner` is absent: commissioner review is build-order step 6, not this one.
 */

const GradeLetterSchema = z.enum(['A', 'B', 'C', 'D', 'F'])

export const TradeVerdictSchema = z
  .object({
    verdict: z.enum(['accept', 'decline', 'counter', 'fair_either_way']).nullable(),
    headline: z.string().min(1),
    grades: z.array(z.object({ teamId: z.enum(['teamA', 'teamB']), grade: GradeLetterSchema }).strict()),
    reasons: z.array(z.object({ text: z.string().min(1), evidence: z.array(z.string()) }).strict()),
    risks: z.array(z.string().min(1)),
    counter: z
      .object({ add: z.array(z.string()), remove: z.array(z.string()), why: z.string().min(1) })
      .strict()
      .optional(),
    confidence: z.enum(['high', 'medium', 'low']),
  })
  .strict()

export type TradeVerdict = z.infer<typeof TradeVerdictSchema>

/** Rule 7. */
export const HEADLINE_MAX_CHARS = 280
/** Rule 3. */
export const MIN_REASONS = 2
export const MAX_REASONS = 4
