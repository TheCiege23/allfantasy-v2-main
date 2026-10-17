import { z } from 'zod'

/**
 * The share card for a trade analyzed in the Trade Center — both sides, the grade, the verdict.
 *
 * The browser sends what is on its screen; the route draws it. The league NAME is read on the server
 * (and membership checked) so a card cannot carry someone else's league, and every field is bounded so
 * the image cannot be turned into a billboard.
 *
 * ⚠ A PROPOSED TRADE, GRADED ON VALUE TODAY. The card says so in words, beside the caption the Trade
 * Center itself prints ("projected, not realized"). A shared image outlives the screen it came from,
 * and it must not read as the "who won" RESULT card (`/api/share/trade-card`), which is a different
 * measure of a completed trade.
 */

const name = z.string().trim().min(1).max(60)
const asset = z.object({ name, value: z.number().finite().min(0).max(1_000_000).nullable() })
const letter = z.string().trim().regex(/^[A-F][+-]?$/).nullable()

export const ProposalCardInput = z.object({
  language: z.enum(['en','es']).default('en'),
  leagueId: z.string().trim().min(1).max(64),
  myLabel: name,
  theirLabel: name,
  give: z.array(asset).min(1).max(8),
  get: z.array(asset).min(1).max(8),
  myLetter: letter,
  theirLetter: letter,
  score: z.number().finite().min(0).max(100).nullable(),
  verdict: z.string().trim().min(1).max(60),
  basis: z.string().trim().min(1).max(100).optional(),
  asOf: z.string().datetime().optional(),
  uncertainty: z.string().trim().min(1).max(100).optional(),
})

export type ProposalCardInput = z.infer<typeof ProposalCardInput>

/** A side's total, only when every asset on it is priced — an unpriced asset is not a 0. */
export function sideTotal(assets: ProposalCardInput['give']): number | null {
  return assets.every((a) => a.value != null) ? assets.reduce((s, a) => s + (a.value ?? 0), 0) : null
}

export const formatValue = (n: number) => Math.round(n).toLocaleString('en-US')
