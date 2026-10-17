import { z } from 'zod'

/** A saved market comparison is evidence from one analysis, never a live grade. */
export const genericComparisonSchema = z.object({
  id: z.string().min(1).max(100),
  sport: z.enum(['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER']),
  title: z.string().min(1).max(100),
  at: z.string().datetime(),
  basis: z.string().min(1).max(240),
  uncertainty: z.string().min(1).max(240),
  sides: z.tuple([z.string().min(1).max(80), z.string().min(1).max(80)]),
  assets: z.tuple([
    z.array(z.string().min(1).max(120)).max(24),
    z.array(z.string().min(1).max(120)).max(24),
  ]),
  grades: z.tuple([z.string().min(1).max(12), z.string().min(1).max(12)]),
  verdict: z.string().min(1).max(200),
})

export type GenericComparison = z.infer<typeof genericComparisonSchema>

/** Reject malformed account history instead of presenting it as an empty successful read. */
export function parseGenericComparisons(value: unknown): GenericComparison[] | null {
  const parsed = z.array(genericComparisonSchema).max(30).safeParse(value)
  return parsed.success ? parsed.data : null
}
