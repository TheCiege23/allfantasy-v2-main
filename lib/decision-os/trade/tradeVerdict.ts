import { z } from 'zod'

/**
 * THE AI EXPLANATION'S SHAPE (design, "AI explanation layer"). Strict: an unknown key is a failed
 * answer, not an ignored one — a model that adds `fairnessScore` or `winProbability` has invented a
 * number the page would otherwise be tempted to print.
 *
 * Two deliberate differences from the design's interface, both about a WITHHELD grade:
 *   - `grades` is empty and `verdict` is null when the engine gave no letter. The design's enum has no
 *     "not graded", and forcing one of its four values would state a judgement nobody made.
 *   - `commissioner` carries codes and severities only — the flag explanations are code-written
 *     (`./tradeReview.ts`); the model adds a `noteToLeague` and nothing else.
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
    /** Commissioner review mode only: the code's flags and recommendation, copied, plus the model's note. */
    commissioner: z
      .object({
        recommendation: z.enum(['approve', 'review_with_managers', 'consider_veto']),
        flags: z.array(
          z
            .object({
              code: z.enum([
                'heavily_lopsided',
                'tanking_signal',
                'rebuild_signal',
                'repeat_partners',
                'inactive_manager',
                'eliminated_team_dumping',
                'deadline_rush',
                'class_gap',
              ]),
              severity: z.enum(['low', 'medium', 'high']),
            })
            .strict(),
        ),
        noteToLeague: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type TradeVerdict = z.infer<typeof TradeVerdictSchema>

/** Rule 7. */
export const HEADLINE_MAX_CHARS = 280
/** Rule 3. */
export const MIN_REASONS = 2
export const MAX_REASONS = 4
