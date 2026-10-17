import 'server-only'

import { prisma } from '@/lib/prisma'
import { readDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { buildEligibleTeamsWithOdds, selectEligibleTeams, type StandingsRow } from '@/lib/draft-lottery/standingsForLottery'
import type { WeightedLotteryConfig } from '@/lib/draft-lottery/types'
import { formatRecord, type StandingsBoard } from './standingsModel'

/**
 * "Draft order if the season ended today" — next season's picks for the teams outside the playoff line,
 * from the table as it stands.
 *
 * ⚠ ONLY WHERE THE LEAGUE DRAFTS FROM ITS STANDINGS. A redraft league's default is a randomized draft
 * (`draft_order_mode: 'randomize'`), and an order printed there would be invented. So a preview is built
 * only for a league that states a standings rule, read in this order:
 *
 *   1. `settings.draft_order_mode === 'weighted_lottery'` — the lottery's own config and odds;
 *   2. `settings.rookie_draft_order.enabled` — worst record first, or fewest points first;
 *   3. a `DynastyLeagueConfig` row — its `rookiePickOrderMethod`.
 *
 * Anything else is null and the section is not drawn.
 *
 * ⚠ THE LOTTERY ODDS ARE THE LOTTERY'S OWN ARITHMETIC (`buildEligibleTeamsWithOdds`), fed this table's
 * order instead of `LeagueTeam`'s stored rank — so the preview and a real run weigh the same way. A
 * percentage is the chance at the FIRST pick, which is exactly each team's share of the weights.
 *
 * ⚠ "POINTS" ORDERS USE POINTS FOR, AND SAY SO. Every "max PF" order in this repo's draft code actually
 * sorts on points scored (see `lib/league/maxPF.ts`), so the preview matches what those drafts will do —
 * and the copy names the column it uses rather than repeating the misleading label.
 */

export type DraftOrderRule =
  | { kind: 'lottery'; config: WeightedLotteryConfig }
  | { kind: 'reverse_standings' }
  | { kind: 'lowest_points' }

export type DraftOrderPick = {
  /** Pick number in the preview (1 = first). For a lottery, the order picks fall back to without luck. */
  pick: number
  rosterId: string
  name: string
  isYou: boolean
  record: string
  pointsFor: number
  /** Chance at the #1 pick, 0–100, for a lottery-eligible team. Null otherwise. */
  firstPickOdds: number | null
}

export type DraftOrderPreview = {
  rule: DraftOrderRule['kind']
  /** One sentence: how the order is decided. */
  ruleText: string
  picks: DraftOrderPick[]
  /** Teams inside the playoff line, whose picks the playoffs decide. */
  playoffTeams: number
  /** Picks the lottery decides, for a lottery. */
  lotteryPicks: number | null
}

/** Read the league's rule. Null when it does not draft from its standings. */
export async function readDraftOrderRule(league: { id: string; settings: unknown }): Promise<DraftOrderRule | null> {
  const settings = (league.settings ?? {}) as Record<string, unknown>
  const lottery = readDraftOrderModeAndLotteryConfig(settings)
  if (lottery.draftOrderMode === 'weighted_lottery') return { kind: 'lottery', config: lottery.lotteryConfig }

  const rookie = settings.rookie_draft_order as { mode?: unknown; enabled?: unknown } | undefined
  if (rookie && rookie.enabled === true) {
    return rookie.mode === 'reverse_max_pf' ? { kind: 'lowest_points' } : { kind: 'reverse_standings' }
  }

  const dynasty = await prisma.dynastyLeagueConfig
    .findUnique({ where: { leagueId: league.id }, select: { rookiePickOrderMethod: true } })
    .catch(() => null)
  if (dynasty) {
    if (dynasty.rookiePickOrderMethod === 'max_pf') return { kind: 'lowest_points' }
    if (dynasty.rookiePickOrderMethod === 'reverse_standings') return { kind: 'reverse_standings' }
  }
  /* An unrecognised method is not guessed at. */
  return null
}

/**
 * PURE: the preview from the table and a rule. Null when there is nobody outside the playoff line, or
 * the table has no head-to-head records to order by.
 */
export function buildDraftOrderPreview(board: StandingsBoard, rule: DraftOrderRule): DraftOrderPreview | null {
  if (!board.hasHeadToHead) return null
  const field = Math.min(board.rules.playoffTeams, board.teams.length)
  const outside = board.teams.filter((t) => t.seed > field)
  if (outside.length === 0) return null

  const ordered =
    rule.kind === 'lowest_points'
      ? [...outside].sort((a, b) => a.pointsFor - b.pointsFor || b.seed - a.seed)
      : [...outside].sort((a, b) => b.seed - a.seed)

  let odds = new Map<string, number>()
  let lotteryPicks: number | null = null
  if (rule.kind === 'lottery') {
    /* The lottery's own rows: best first, rank 1 = best — here, the table's seed. */
    const rows: StandingsRow[] = board.teams.map((t, i) => ({
      rosterId: t.rosterId,
      displayName: t.name,
      teamIndex: i,
      rank: t.seed,
      wins: t.record.wins,
      losses: t.record.losses,
      ties: t.record.ties,
      pointsFor: t.pointsFor,
      maxPf: t.pointsFor,
    }))
    const eligible = selectEligibleTeams(rows, rule.config.eligibilityMode, rule.config.lotteryTeamCount, field)
    odds = new Map(buildEligibleTeamsWithOdds(eligible, rule.config.weightingMode).map((e) => [e.rosterId, e.oddsPercent]))
    lotteryPicks = Math.min(rule.config.lotteryPickCount, eligible.length)
  }

  const ruleText =
    rule.kind === 'lottery'
      ? `A weighted lottery decides the first ${lotteryPicks} ${lotteryPicks === 1 ? 'pick' : 'picks'}; the rest fall in reverse order of the table.`
      : rule.kind === 'lowest_points'
        ? 'Fewest points for picks first — the league’s rule.'
        : 'Worst record picks first — the league’s rule.'

  return {
    rule: rule.kind,
    ruleText,
    picks: ordered.map((t, i) => ({
      pick: i + 1,
      rosterId: t.rosterId,
      name: t.name,
      isYou: t.isYou,
      record: formatRecord(t.record),
      pointsFor: t.pointsFor,
      firstPickOdds: odds.get(t.rosterId) ?? null,
    })),
    playoffTeams: field,
    lotteryPicks,
  }
}
