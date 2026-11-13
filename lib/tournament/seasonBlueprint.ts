import { z } from 'zod'
import { seasonRulesSchema } from './seasonRules'
import { seasonArtworkSchema } from './seasonArtwork'

const cutSchema = z.object({
  advance: z.number().int().min(8).max(191).optional(),
  automaticPerLeague: z.number().int().min(0).max(14),
})
const competitionSchema = z.object({
  openingLeagues: z.number().int().min(1).max(24).optional(),
  qualifierLeagues: z.number().int().min(1).max(24).optional(),
  finalLeagues: z.number().int().min(1).max(24).optional(),
  firstCut: cutSchema,
  secondCut: cutSchema,
  draftOrder: z.enum(['best_seed_first', 'best_seed_last']),
  finalTiebreaker: z.literal('frozen_draw'),
})
type Competition = z.infer<typeof competitionSchema>

export function defaultSeasonCompetition(): Competition {
  return {
    firstCut: { automaticPerLeague: 0 },
    secondCut: { automaticPerLeague: 0 },
    draftOrder: 'best_seed_first',
    finalTiebreaker: 'frozen_draw',
  }
}

function balancedLeagueCount(entrants: number) {
  return Math.max(1, Math.ceil(entrants / 14), Math.min(Math.floor(entrants / 8), Math.round(entrants / 11)))
}

/** Saved plans without a competition policy retain their original pool and cut rules. */
export function seasonFieldShape(participants: number, competition?: Competition) {
  const legacyLeagueCount = Math.ceil(participants / 32) * 4
  const qualifiers = competition ? competition.firstCut.advance ?? Math.floor(participants / 2) : participants / 2
  const finalists = competition ? competition.secondCut.advance ?? Math.floor(qualifiers / 2) : qualifiers / 2
  return {
    counts: [participants, qualifiers, finalists] as const,
    leagueCounts: competition ? [
      competition.openingLeagues ?? balancedLeagueCount(participants),
      competition.qualifierLeagues ?? balancedLeagueCount(qualifiers),
      competition.finalLeagues ?? balancedLeagueCount(finalists),
    ] as const : [legacyLeagueCount, legacyLeagueCount / 2, legacyLeagueCount / 4] as const,
    bracketWeeks: Math.ceil(Math.log2(finalists)),
  }
}

export const seasonBlueprintSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().trim().min(3).max(120),
  sport: z.enum(['NFL', 'NBA']),
  participants: z.number().int().min(64).max(192),
  competition: competitionSchema.optional(),
  startWeek: z.number().int().min(1).max(30),
  firstCutWeek: z.number().int().min(1).max(30),
  secondCutWeek: z.number().int().min(1).max(30),
  finalWeek: z.number().int().min(1).max(30),
  draftType: z.enum(['snake', 'auction']),
  scoring: z.enum(['ppr', 'half_ppr', 'standard', 'nba_points']),
  rosterSize: z.number().int().min(5).max(20),
  trades: z.boolean(),
  divisions: z.array(z.string().trim().min(1).max(40)).max(8),
  leagueNames: z.array(z.string().trim().min(1).max(60)).max(24),
  artwork: seasonArtworkSchema.optional(),
  tiebreakers: z.array(z.enum(['best_week', 'wins', 'previous_seed'])).min(1).max(3),
  rules: seasonRulesSchema.optional(),
  redraftBufferHours: z.number().int().min(1).max(168),
}).superRefine((c, ctx) => {
  const error = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message })
  if (!(c.startWeek <= c.firstCutWeek && c.firstCutWeek < c.secondCutWeek && c.secondCutWeek < c.finalWeek)) error('Each scoring stage must finish before the next stage begins.')
  if (c.sport === 'NFL' && c.finalWeek > 18) error('NFL tournaments must end by week 18.')
  if (c.sport === 'NBA' && c.scoring !== 'nba_points') error('NBA tournaments use points scoring for comparable cross-league seeds.')
  if (c.sport === 'NFL' && c.scoring === 'nba_points') error('Choose NFL scoring for an NFL tournament.')
  const { counts, leagueCounts, bracketWeeks } = seasonFieldShape(c.participants, c.competition)
  if (!c.competition && c.participants % 4 !== 0) error('Use a multiple of four or select configurable qualification.')
  if (c.competition) {
    if (!(counts[0] > counts[1] && counts[1] > counts[2] && counts[2] >= 8)) error('Both cuts must reduce the field, with at least eight finalists.')
    for (const [index, leagues] of leagueCounts.entries()) {
      const entrants = counts[index]!
      if (entrants < 8 * leagues || entrants > 14 * leagues) error('Round ' + (index + 1) + ' needs 8–14 entrants per league.')
    }
    for (const [index, cut] of [c.competition.firstCut, c.competition.secondCut].entries()) {
      const leagues = leagueCounts[index]!
      if (cut.automaticPerLeague > Math.floor(counts[index]! / leagues)) error('Cut ' + (index + 1) + ' assigns more automatic berths than the smallest league can fill.')
      if (cut.automaticPerLeague * leagues > counts[index + 1]!) error('Cut ' + (index + 1) + ' has more automatic berths than advancing spots.')
    }
  }
  if (c.finalWeek - c.secondCutWeek !== bracketWeeks) error('Reserve exactly ' + bracketWeeks + ' weekly bracket matchups after the second cut to crown the winner in the final week.')
  if (new Set(c.tiebreakers).size !== c.tiebreakers.length) error('Tiebreakers must be unique.')
  if (new Set(c.leagueNames.map(n => n.toLowerCase())).size !== c.leagueNames.length) error('League names must be unique.')
  if (new Set(c.divisions.map(n => n.toLowerCase())).size !== c.divisions.length) error('Division names must be unique.')
  const count = leagueCounts[0]
  const draftTargets = new Set<string>()
  for (const row of c.rules?.calendar.draftOverrides ?? []) {
    const key = JSON.stringify([row.stage, row.scope, row.target])
    if (draftTargets.has(key)) error('Provide only one draft override per target and stage.')
    draftTargets.add(key)
    const valid = row.scope === 'division'
      ? row.stage === 1 && c.divisions.slice(0, count).includes(row.target)
      : Array.from({ length: leagueCounts[row.stage - 1]! }, (_, i) => seasonLeagueKey(row.stage, i + 1)).includes(row.target)
    if (!valid) error('Draft override target ' + row.target + ' has no league in stage ' + row.stage + '.')
  }
  if (c.artwork && c.artwork.divisions.length !== c.divisions.length) error('Artwork must match every named division.')
  if (c.artwork && c.artwork.leagues.length !== count) error('Artwork must match every opening league.')
  if (c.leagueNames.length && c.leagueNames.length !== count) error('Provide all ' + count + ' opening league names, or leave names blank to generate them.')
})

export type SeasonBlueprint = z.infer<typeof seasonBlueprintSchema>

export const seasonLeagueKey = (stage: number, leagueNumber: number) => 'stage-' + stage + '-league-' + leagueNumber

export function defaultSeasonBlueprint(sport: 'NFL' | 'NBA' = 'NBA'): SeasonBlueprint {
  return { version: 1, name: '', sport, participants: 64, startWeek: 1,
    firstCutWeek: sport === 'NBA' ? 10 : 6, secondCutWeek: sport === 'NBA' ? 20 : 13,
    finalWeek: sport === 'NBA' ? 24 : 17, draftType: 'snake', scoring: sport === 'NBA' ? 'nba_points' : 'ppr',
    rosterSize: sport === 'NBA' ? 12 : 15, trades: false, divisions: [], leagueNames: [],
    tiebreakers: ['best_week', 'wins', 'previous_seed'], redraftBufferHours: 24 }
}

export function buildSeasonBlueprint(input: unknown) {
  const config = seasonBlueprintSchema.parse(input)
  const { counts, leagueCounts, bracketWeeks } = seasonFieldShape(config.participants, config.competition)
  const stages = counts.map((participants, index) => {
    const leagueCount = leagueCounts[index]!
    const cut = index === 0 ? config.competition?.firstCut : index === 1 ? config.competition?.secondCut : undefined
    const advance = counts[index + 1]
    const qualification = cut && advance !== undefined ? {
      advance,
      automaticPerLeague: cut.automaticPerLeague,
      wildcards: advance - cut.automaticPerLeague * leagueCount,
    } : undefined
    const sizes = Array.from({ length: leagueCount }, (_, i) => Math.floor(participants / leagueCount) + (i < participants % leagueCount ? 1 : 0))
    return { number: index + 1, name: ['Opening qualifier', 'Reseed and redraft', 'Championship bracket'][index]!,
      participants, leagueCount, sizes, draft: index + 1,
      ...(qualification ? { qualification } : {}),
      startWeek: index === 0 ? config.startWeek : index === 1 ? config.firstCutWeek + 1 : config.secondCutWeek + 1,
      endWeek: index === 0 ? config.firstCutWeek : index === 1 ? config.secondCutWeek : config.finalWeek }
  })
  const finalists = counts[2]!
  const bracketSize = 2 ** bracketWeeks
  return { config, stages, bracketWeeks, bracketSize, byes: bracketSize - finalists,
    warnings: [
      'Weekly points and seeds reset after each qualifier; every stage starts with a fresh draft.',
      'Final leagues have independent player pools. Cross-league opponents may roster the same athlete.',
      'Exact dates, time zones, scoring-period locks and stat-correction deadlines must be verified before launch.',
      ...(config.sport === 'NBA' ? ['NBA short weeks, All-Star break and games-played limits need a verified season calendar.'] : []),
      ...(config.sport === 'NFL' && config.finalWeek === 18 ? ['Week 18 may include rested starters; week 17 is the suggested final.'] : []),
    ] }
}

/** Serpentine placement balances high and low seeds across independent draft pools. */
export function distributeSeeds(seeds: string[], leagueCount: number): string[][] {
  if (!Number.isInteger(leagueCount) || leagueCount < 1 || leagueCount > seeds.length) throw new Error('Invalid league count')
  if (new Set(seeds).size !== seeds.length) throw new Error('Duplicate entrant')
  const pools: string[][] = Array.from({ length: leagueCount }, () => [])
  const capacities = pools.map((_, i) => Math.floor(seeds.length / leagueCount) + (i < seeds.length % leagueCount ? 1 : 0))
  let next = 0
  for (let row = 0; next < seeds.length; row++) {
    for (let col = 0; col < leagueCount && next < seeds.length; col++) {
      const index = row % 2 ? leagueCount - 1 - col : col
      if (pools[index]!.length < capacities[index]!) pools[index]!.push(seeds[next++]!)
    }
  }
  return pools
}

/** Standard bracket order keeps the top seeds apart until the latest possible round. */
export function buildSeededBracket(finalists: string[]) {
  if (finalists.length < 2 || new Set(finalists).size !== finalists.length) throw new Error('Need distinct finalists')
  const size = 2 ** Math.ceil(Math.log2(finalists.length))
  let order = [1, 2]
  for (let width = 4; width <= size; width *= 2) order = order.flatMap(seed => [seed, width + 1 - seed])
  return Array.from({ length: size / 2 }, (_, i) => {
    const a = order[i * 2]!, b = order[i * 2 + 1]!
    return { seedA: a, seedB: b, teamA: finalists[a - 1] ?? null, teamB: finalists[b - 1] ?? null }
  })
}


export type BlueprintStaffRole = 'viewer' | 'co_commissioner' | 'live_co_commissioner'
export type SavedSeasonBlueprint = ReturnType<typeof buildSeasonBlueprint> & {
  tournamentId: string
  revision: string
  isOwner: boolean
  currentStage?: number
  championName?: string
  missedDrafts?: Array<{ stage: number; key: string; completeBy: string }>
  canEditSettings: boolean
  publication?: { id: string; hash: string; sourceRevision: string; calendarDigest: string; publishedAt: string; checkedAt: string; regularGames: number; pendingGames: number; excludedGames: number }
  canReviewRecovery?: boolean
  staff: Array<{ userId: string; username: string; displayName: string; role: BlueprintStaffRole }>
}
