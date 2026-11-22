import { z } from 'zod'

export const AWARD_BALLOT_SUBTYPE = 'league_award_ballot'
export const AWARD_DM_PREFIX = 'award-dm:v1:'

const cleanText = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\r\n\u0000-\u001f]+$/)
export const awardBallotInput = z.object({
  name: cleanText(120),
  choices: z.array(cleanText(100)).min(2).max(12),
  closeAt: z.string().datetime({ offset: true }),
  requestId: z.string().uuid(),
}).refine((v) => new Set(v.choices.map((c) => c.toLowerCase())).size === v.choices.length, {
  message: 'Each choice must be different.',
})

const stored = z.object({
  name: cleanText(120),
  closeAt: z.string().datetime({ offset: true }),
  season: z.number().int().nullable(),
  options: z.array(z.object({ id: z.string(), label: cleanText(100) })).min(2).max(12),
  votes: z.array(z.object({ userId: z.string(), optionId: z.string() })),
  closedAt: z.string().datetime({ offset: true }).optional(),
})
export type AwardBallot = z.infer<typeof stored>

export function readAwardBallot(metadata: unknown): AwardBallot | null {
  if (!metadata || typeof metadata !== 'object' || !('awardBallot' in metadata)) return null
  const parsed = stored.safeParse(metadata.awardBallot)
  return parsed.success ? parsed.data : null
}

export function awardClosed(ballot: AwardBallot, now = Date.now()) {
  return Boolean(ballot.closedAt) || Date.parse(ballot.closeAt) <= now
}

export function recordAwardChoice(ballot: AwardBallot, userId: string, optionId: string, now = Date.now()) {
  if (awardClosed(ballot, now)) return { ok: false as const, status: 409, error: 'Voting is closed.' }
  if (!ballot.options.some((option) => option.id === optionId)) {
    return { ok: false as const, status: 400, error: 'Choose a candidate on this ballot.' }
  }
  return { ok: true as const, ballot: {
    ...ballot,
    votes: [...ballot.votes.filter((vote) => vote.userId !== userId), { userId, optionId }],
  } }
}

export function awardTallies(ballot: AwardBallot, now = Date.now()) {
  const closed = awardClosed(ballot, now)
  const byOption = new Map<string, number>()
  for (const vote of ballot.votes) byOption.set(vote.optionId, (byOption.get(vote.optionId) ?? 0) + 1)
  const options = ballot.options.map((option) => ({ ...option, count: byOption.get(option.id) ?? 0 }))
  const highest = Math.max(...options.map((option) => option.count), 0)
  const leaders = options.filter((option) => highest > 0 && option.count === highest)
  return { closed, options, totalVotes: ballot.votes.length,
    outcome: !closed ? 'Voting open' : !highest ? 'No votes' : leaders.length > 1 ? 'Tie' : 'Winner',
    winner: closed && leaders.length === 1 ? leaders[0]!.label : null,
  }
}

export function awardBallotHref(leagueId: string, ballotId: string) {
  return `/league/${encodeURIComponent(leagueId)}/awards/${encodeURIComponent(ballotId)}`
}
