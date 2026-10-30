/**
 * Changing a league's scoring TYPE or category list after creation — the DB half. The pure rules
 * (what is valid, how a switch is stored, how a week reads its type) are in
 * lib/category-scoring/leagueScoringType.ts; the lifecycle decision is the caller's
 * (`decideSettingsEdit`, lib/league/settingsLifecycleGate.ts).
 *
 * The data rule, in one place: the switch applies from the first week of the current season with
 * no final result. Weeks before it keep their type forever (see `settingsForScoringWeek`), the week
 * it starts on is re-scored now if it is already under way, and standings are rebuilt from the
 * stored results — so they change from the switch onward and not before.
 */

import { prisma } from '@/lib/prisma'
import {
  applyScoringTypeChange,
  readScoringType,
  sameScoringType,
  validateScoringTypeChange,
  type ScoringTypeInput,
  type ScoringTypeSnapshot,
} from '@/lib/category-scoring/leagueScoringType'
import { ruleSnapshotFromLeague } from '@/lib/league-rules-explainer/snapshot'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import { publishRuleChangesEvent } from '@/lib/league-rules-explainer/publishRuleChanges'

export type ScoringTypeSwitchResult =
  | {
      ok: true
      changed: boolean
      previous: ScoringTypeSnapshot
      next: ScoringTypeSnapshot
      /** null when the season has no final result yet: the new type applies to every week. */
      effectiveFromWeek: number | null
      season: number | null
    }
  | { ok: false; status: number; code: string; error: string }

/** The league's current season and the last week with any final result in it (0 when none). */
export async function findLastFinalWeek(
  leagueId: string,
  leagueSeason: number | null,
): Promise<{ season: number | null; seasonId: string | null; lastFinalWeek: number; currentWeek: number | null }> {
  const seasonRow = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: [{ season: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, season: true, currentWeek: true },
  })
  const season = seasonRow?.season ?? leagueSeason ?? null
  if (season == null) return { season: null, seasonId: null, lastFinalWeek: 0, currentWeek: null }
  const [matchup, teamWeek] = await Promise.all([
    seasonRow
      ? prisma.redraftMatchup.findFirst({
          where: { seasonId: seasonRow.id, status: 'final' },
          orderBy: { week: 'desc' },
          select: { week: true },
        })
      : Promise.resolve(null),
    prisma.teamWeekResult.findFirst({
      where: { leagueId, season, status: 'final' },
      orderBy: { week: 'desc' },
      select: { week: true },
    }),
  ])
  return {
    season,
    seasonId: seasonRow?.id ?? null,
    lastFinalWeek: Math.max(matchup?.week ?? 0, teamWeek?.week ?? 0),
    currentWeek: seasonRow?.currentWeek ?? null,
  }
}

/**
 * Validate and save a scoring-type change. `midSeason` is the lifecycle gate's verdict
 * (post_draft / in_season / playoffs, already confirmed by the commissioner).
 */
export async function switchLeagueScoringType(args: {
  leagueId: string
  userId: string
  input: ScoringTypeInput
  midSeason: boolean
  now?: Date
}): Promise<ScoringTypeSwitchResult> {
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { sport: true, season: true, settings: true },
  })
  if (!league) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'League not found' }

  const previous = readScoringType(league.settings)
  const validation = validateScoringTypeChange(league.sport, args.input, previous)
  if (!validation.ok) return { ok: false, status: 400, code: validation.code, error: validation.error }
  const next = validation.next
  if (sameScoringType(previous, next)) {
    return { ok: true, changed: false, previous, next, effectiveFromWeek: null, season: null }
  }

  // Roto is a whole-season format: its schedule and playoffs are fixed when the draft is finalized
  // (finalizeDraftToRedraftSeason) and its standings rank cumulative season stats, so neither the
  // type nor a roto league's categories can change once the season exists without rewriting weeks
  // already played. Between seasons it is an ordinary change.
  if (args.midSeason && (previous.mode === 'roto' || next.mode === 'roto')) {
    return {
      ok: false,
      status: 409,
      code: 'roto_locked_mid_season',
      error: 'Rotisserie scoring is fixed for the whole season. Make this change after the season ends.',
    }
  }

  const { season, seasonId, lastFinalWeek, currentWeek } = await findLastFinalWeek(args.leagueId, league.season)
  const effectiveFromWeek = season != null && lastFinalWeek > 0 ? lastFinalWeek + 1 : null
  const settings = applyScoringTypeChange(
    league.settings,
    next,
    effectiveFromWeek != null && season != null
      ? { season, effectiveFromWeek, changedAt: (args.now ?? new Date()).toISOString(), changedBy: args.userId }
      : null,
  )
  await prisma.league.update({ where: { id: args.leagueId }, data: { settings: settings as object } })

  // The league home's "What changed" card (lib/league-rules-explainer), read with the popup's own
  // reader on the settings before and after. Best-effort: it never fails the switch.
  const rulesOf = (raw: unknown) => {
    const r = ruleSnapshotFromLeague({ sport: league.sport, settings: raw })
    return { scoringMode: r.scoringMode, categoryRecordMode: r.categoryRecordMode }
  }
  await publishRuleChangesEvent({
    leagueId: args.leagueId,
    actorUserId: args.userId,
    section: 'scoring',
    changes: diffRuleSnapshots(rulesOf(league.settings), rulesOf(settings)),
  })

  // The week the switch starts on is re-scored now when it is already under way, then standings are
  // rebuilt. Best-effort and in the background: the setting is saved, and the next scoring run
  // would apply it anyway.
  const rescoreWeek = effectiveFromWeek ?? (currentWeek && currentWeek > 0 ? currentWeek : null)
  if (seasonId && rescoreWeek != null && currentWeek != null && rescoreWeek <= currentWeek) {
    void (async () => {
      const { recalculateMatchupsForSeasonWeek } = await import('@/lib/redraft/scoringEngine')
      const { updateStandings } = await import('@/lib/redraft/standingsEngine')
      await recalculateMatchupsForSeasonWeek(seasonId, rescoreWeek)
      await updateStandings(seasonId, rescoreWeek)
    })().catch((err) =>
      console.warn('[scoring-type] re-score after switch failed', {
        leagueId: args.leagueId,
        week: rescoreWeek,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }

  return { ok: true, changed: true, previous, next, effectiveFromWeek, season }
}
