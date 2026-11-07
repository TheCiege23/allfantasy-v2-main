import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { normalizeBestBallSettings, type BestBallCreateSettings } from '@/lib/bestball/rules'
import { bestBallSportSupportsDaily, withEffectiveScoringPeriod } from '@/lib/bestball/scoringPeriod'
import { tournamentRoundEnds } from '@/lib/bestball/tournamentCalendar'
import { withClientLeagueSettings } from '@/lib/league/clientLeagueSettings'
import { structuralSettingsLockReason } from '@/lib/league/structuralSettingsLock'
import { withPlayoffStartWeekCopies } from '@/lib/playoff-settings/playoffStartWeekCopies'
import { logAction } from '@/server/services/auditService'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import { publishRuleChangesEvent } from '@/lib/league-rules-explainer/publishRuleChanges'
import type { LeagueSport } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * The Best Ball settings that decide how the league is SCORED or COMPETED — frozen once the draft has
 * started (`structuralSettingsLockReason`: a draft session past pre-draft, or a season row). Changing any
 * of them after players are drafted re-scores teams built for other rules. The transaction toggles
 * (waivers, trades, FA, manual substitutions) and the AI toggles stay editable all season.
 */
const LOCKED_AFTER_DRAFT: ReadonlyArray<{ key: keyof BestBallCreateSettings; label: string }> = [
  { key: 'mode', label: 'operating mode' },
  { key: 'draftMode', label: 'draft type' },
  { key: 'scoringPeriod', label: 'scoring period' },
  { key: 'lineupTemplateId', label: 'lineup' },
  { key: 'rosterTemplateId', label: 'roster' },
  { key: 'contestStructure', label: 'contest structure' },
  { key: 'matchupFormat', label: 'scoring model' },
  { key: 'cumulativeScoring', label: 'scoring model' },
  { key: 'tieRule', label: 'tiebreaker' },
  { key: 'playoffFormat', label: 'playoff format' },
  { key: 'playoffTeams', label: 'playoff teams' },
  { key: 'regularSeasonLength', label: 'regular season length' },
  { key: 'podSize', label: 'pod size' },
  { key: 'podPlayEnabled', label: 'pod play' },
  { key: 'sitAndGoEnabled', label: 'contest structure' },
  { key: 'tournamentEnabled', label: 'contest structure' },
  { key: 'tournamentAdvancementRounds', label: 'advancement rounds' },
  { key: 'roundEndWeeks', label: 'advancement rounds' },
  { key: 'advancersPerPod', label: 'advancers per pod' },
  { key: 'resetBetweenRounds', label: 'advancement rounds' },
  { key: 'finalRoundStructure', label: 'final round' },
]

/** Tournament structure is fixed once its contest exists (as it was before the draft lock existed). */
const FIXED_WITH_CONTEST: ReadonlyArray<keyof BestBallCreateSettings> = [
  'contestStructure', 'podSize', 'tournamentAdvancementRounds', 'regularSeasonLength', 'roundEndWeeks',
  'advancersPerPod', 'resetBetweenRounds', 'cumulativeScoring', 'scoringPeriod',
]

/**
 * 🛑 SAVED AND NEVER READ, SO NO LONGER ACCEPTED (audit 2026-11-06, "Settings saved and never read").
 * Each was written to the League row or `best_ball_settings` and nothing read it back: a commissioner
 * could set it and the league behaved exactly the same. The column / JSON key stays (no schema change);
 * the route refuses it and names the setting that actually does the job.
 */
const NOT_A_BEST_BALL_SETTING: Readonly<Record<string, string>> = {
  bbIrEnabled: "IR spots come from the league's roster (its IR slot count), not a best ball switch.",
  bbTaxiEnabled: 'Best ball rosters have no taxi squad.',
}
const NOT_A_BEST_BALL_DRAFT_SETTING: Readonly<Record<string, string>> = {
  // The draft room's own settings, which the draft engine does read (draft/settings, draft/controls):
  slowDraftClockMinutes: 'Set the pick clock (timer) in Draft settings.',
  autoPickBehavior: 'Set CPU autopick in Draft settings.',
  allowCommissionerPause: 'Use "Commissioner pause / resume / reset timer" in the draft room settings.',
  allowCommissionerResume: 'Use "Commissioner pause / resume / reset timer" in the draft room settings.',
  allowCommissionerForcePick: 'Use the commissioner force auto-pick switch in the draft room settings.',
  draftDateUtc: 'Set the draft date and time in Draft settings.',
  // Same finding, second pass (zero readers outside lib/bestball/rules.ts): the draft engine's missed-pick
  // path reads Draft settings' autopick (queue first / best available / need based / skip), never these.
  queueBehavior: 'A missed pick uses the queue when Autopick is "Queue first" in Draft settings.',
  missedPickFallback: 'Set Autopick (queue first, best player available, need based or skip) in Draft settings.',
  allowDuplicatePlayers: 'No such setting exists: a player can be drafted by only one team in a league.',
}

/**
 * 🛑 TRADES CANNOT BE TURNED ON IN A BEST BALL LEAGUE (owner's decision, 2026-11-07). Best ball scoring does
 * not split a traded player's week (audit 2026-11-06, "Ownership history"), so the trade engine refuses every
 * native Best Ball trade (tradeSettingsResolver.ts). This route used to save `true` anyway, and the panel,
 * the rules summary and Chimmy then said trades were on. `false` is still accepted (it changes nothing).
 */
const BEST_BALL_TRADES_OFF_REASON =
  "Trades are off in Best Ball leagues: best ball scoring does not split a traded player's week, so a trade cannot be scored fairly."

/** The first refused field in the body, with where it is really set; null when the body has none. */
function refusedBestBallSetting(body: Record<string, unknown>): { field: string; hint: string } | null {
  for (const [field, hint] of Object.entries(NOT_A_BEST_BALL_SETTING)) {
    if (body[field] !== undefined) return { field, hint }
  }
  const bestBall = record(body.bestBall)
  for (const [field, hint] of Object.entries(NOT_A_BEST_BALL_DRAFT_SETTING)) {
    if (bestBall && bestBall[field] !== undefined) return { field: `bestBall.${field}`, hint }
  }
  return null
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    leagueId?: string
    bbWaiversEnabled?: boolean
    bbTradesEnabled?: boolean
    bbFaEnabled?: boolean
    bestBall?: Record<string, unknown>
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = body.leagueId?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  if (body.bbTradesEnabled === true || record(body.bestBall)?.tradesEnabled === true) {
    return NextResponse.json(
      {
        error: `Trades cannot be turned on and were not saved. ${BEST_BALL_TRADES_OFF_REASON}`,
        field: body.bbTradesEnabled === true ? 'bbTradesEnabled' : 'bestBall.tradesEnabled',
      },
      { status: 400 },
    )
  }

  const refused = refusedBestBallSetting(body as Record<string, unknown>)
  if (refused) {
    return NextResponse.json(
      { error: `${refused.field} is not a Best Ball setting and was not saved. ${refused.hint}`, field: refused.field },
      { status: 400 },
    )
  }

  try {
    await requireCommissionerRole(leagueId, userId, 'league')
  } catch (err) {
    if (err instanceof Response) return err
    throw err
  }

  const current = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      leagueSize: true,
      bestBallMode: true,
      bbContestId: true,
      settings: true,
      bbWaiversEnabled: true,
      bbTradesEnabled: true,
      bbFaEnabled: true,
      playoffTeams: true,
      playoffStartWeek: true,
      playoffWeeksPerRound: true,
      playoffSeedingRule: true,
    },
  })

  if (!current) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!current.bestBallMode) {
    return NextResponse.json({ error: 'Not a Best Ball league' }, { status: 400 })
  }

  const settingsRecord = { ...(record(current.settings) ?? {}) }
  // The stored block with the period the league is ACTUALLY scored with: a legacy NBA/NHL/MLB "daily"
  // that was only ever a profile default reads — and stays — weekly (lib/bestball/scoringPeriod.ts).
  const existingBestBall = withEffectiveScoringPeriod(String(current.sport), settingsRecord)
  const teamCount = typeof current.leagueSize === 'number' && current.leagueSize > 0 ? current.leagueSize : undefined

  const normalize = (draftMode: unknown, overrides: Record<string, unknown>) =>
    normalizeBestBallSettings({
      sport: current.sport as LeagueSport,
      teamCount,
      conceptSetup: { bestBall: { ...(existingBestBall ?? {}), ...overrides } },
      draftType: typeof draftMode === 'string' ? draftMode : 'snake',
      timezone: typeof settingsRecord.timezone === 'string' ? settingsRecord.timezone : null,
      language: typeof settingsRecord.language === 'string' ? settingsRecord.language : null,
    })
  const before = normalize(settingsRecord.canonical_draft_mode, {})
  const requestedDraftType =
    body.bestBall && typeof body.bestBall.draftMode === 'string' ? body.bestBall.draftMode : settingsRecord.canonical_draft_mode
  const normalizedBestBall = normalize(requestedDraftType, body.bestBall ?? {})

  // Daily best ball: NBA / NHL / MLB only, and never a tournament (its rounds are weekly).
  if (body.bestBall?.scoringPeriod === 'daily') {
    if (!bestBallSportSupportsDaily(String(current.sport))) {
      return NextResponse.json({ error: 'Daily best ball is available for NBA, NHL and MLB leagues only.' }, { status: 400 })
    }
    if (normalizedBestBall.contestStructure === 'tournament') {
      return NextResponse.json(
        { error: 'A Best Ball tournament scores weekly rounds; daily scoring is not available for tournaments.' },
        { status: 400 },
      )
    }
  }

  /*
   * A TOURNAMENT IS SET UP AT CREATION, NOT SWITCHED ON HERE. A tournament league needs its
   * `BestBallContest`, its round calendar and its playoff columns written together in one transaction
   * (lib/league-creation/canonical/createCanonicalLeagueInTransaction.ts). This route used to flip the
   * label alone, leaving a "tournament" with no contest that no round would ever advance.
   */
  if (normalizedBestBall.contestStructure === 'tournament' && before.contestStructure !== 'tournament' && !current.bbContestId) {
    return NextResponse.json(
      {
        error:
          'A Best Ball tournament is set up when the league is created, together with its contest and round calendar. It cannot be switched on from settings.',
      },
      { status: 409 },
    )
  }

  if (current.bbContestId && body.bestBall) {
    if (FIXED_WITH_CONTEST.some((key) => !same(before[key], normalizedBestBall[key]))) {
      return NextResponse.json(
        { error: 'Tournament structure is fixed after contest creation; scoring and transaction settings remain editable.' },
        { status: 409 },
      )
    }
  }

  if (!same(before.playoffTeams, normalizedBestBall.playoffTeams) && teamCount != null && normalizedBestBall.playoffTeams > teamCount) {
    return NextResponse.json(
      { error: `Playoff teams (${normalizedBestBall.playoffTeams}) cannot be more than the league's ${teamCount} teams.` },
      { status: 400 },
    )
  }

  const nextWaivers =
    typeof body.bbWaiversEnabled === 'boolean' ? body.bbWaiversEnabled : normalizedBestBall.waiversEnabled
  // Always false (refused above when true; normalizeBestBallSettings reads a stored true as false). Written
  // on every save, so a league that saved `true` before 2026-11-07 is corrected the next time it saves.
  const nextTrades = false

  if (normalizedBestBall.mode === 'underdog' && (nextWaivers || nextTrades || normalizedBestBall.substitutionsEnabled)) {
    return NextResponse.json(
      { error: 'Underdog-style Best Ball must keep waivers, trades, and manual substitutions disabled' },
      { status: 400 },
    )
  }

  // Scoring and competition are frozen once the draft has started; transactions are not.
  const lockedChanges = [
    ...new Set(LOCKED_AFTER_DRAFT.filter(({ key }) => !same(before[key], normalizedBestBall[key])).map((f) => f.label)),
  ]
  if (lockedChanges.length > 0) {
    const reason = await structuralSettingsLockReason(leagueId)
    if (reason) {
      return NextResponse.json(
        {
          error: `The ${lockedChanges.join(', ')} cannot change ${reason}: it would re-score teams drafted under the current rules. Waivers, trades, free agency and manual substitutions can still change.`,
          lockedFields: lockedChanges,
        },
        { status: 409 },
      )
    }
  }

  let mergedSettings: Record<string, unknown> = {
    ...settingsRecord,
    canonical_draft_mode: normalizedBestBall.draftMode,
    best_ball_settings: {
      ...normalizedBestBall,
      waiversEnabled: nextWaivers,
      tradesEnabled: nextTrades,
    },
  }

  /*
   * 🛑 PLAYOFF AND SEASON-LENGTH EDITS NEVER REACHED THE COLUMNS. `League.playoffTeams` and
   * `League.playoffStartWeek` are what the playoff resolver reads FIRST, and this route wrote only the
   * JSON block — so changing either here changed nothing. Written now as creation writes them
   * (createCanonicalLeagueInTransaction.ts): the start week is the week after the regular season when
   * there is a bracket, the week after the last round for a tournament; with no bracket the column keeps
   * the value creation gave it. Only when one of those settings actually changed.
   */
  const playoffColumns: { playoffTeams?: number; playoffStartWeek?: number; playoffWeeksPerRound?: number; playoffSeedingRule?: string } = {}
  const changed = (...keys: Array<keyof BestBallCreateSettings>) => keys.some((key) => !same(before[key], normalizedBestBall[key]))
  const bb = normalizedBestBall
  if (changed('playoffTeams')) {
    playoffColumns.playoffTeams = bb.playoffTeams
    const ps = record(mergedSettings.playoffSettings)
    if (ps) mergedSettings.playoffSettings = { ...ps, playoffTeams: bb.playoffTeams, playoff_team_count: bb.playoffTeams }
  }
  if (changed('playoffTeams', 'regularSeasonLength', 'contestStructure', 'tournamentAdvancementRounds', 'roundEndWeeks')) {
    const startWeek =
      bb.contestStructure === 'tournament'
        ? tournamentRoundEnds(bb).at(-1)! + 1
        : bb.playoffTeams > 0
          ? bb.regularSeasonLength + 1
          : null
    if (startWeek != null) {
      playoffColumns.playoffStartWeek = startWeek
      mergedSettings = withPlayoffStartWeekCopies(mergedSettings, startWeek)
    }
  }
  if (changed('playoffTeams', 'playoffFormat') && bb.playoffTeams > 0 && bb.playoffFormat !== 'none') playoffColumns.playoffWeeksPerRound = 1
  if (changed('matchupFormat', 'playoffFormat')) {
    const seeding =
      bb.matchupFormat === 'cumulative' || bb.playoffFormat === 'advancement'
        ? 'points_only'
        : current.playoffSeedingRule === 'points_only'
          ? 'record_then_points'
          : null
    if (seeding) playoffColumns.playoffSeedingRule = seeding
  }

  const transactionColumns = {
    bbWaiversEnabled: nextWaivers,
    bbTradesEnabled: nextTrades,
    bbFaEnabled: typeof body.bbFaEnabled === 'boolean' ? body.bbFaEnabled : nextWaivers,
  }

  const league = await prisma.league.update({
    where: { id: leagueId },
    data: {
      ...transactionColumns,
      bbMatchupFormat: normalizedBestBall.matchupFormat,
      bbScoringPeriod: normalizedBestBall.scoringPeriod,
      bbTiebreaker: normalizedBestBall.tieRule,
      bestBallVariant: normalizedBestBall.contestStructure === 'tournament' ? 'tournament' : 'standard',
      ...playoffColumns,
      settings: toPrismaJsonInput(mergedSettings),
    },
  })

  /*
   * The change history: one `settings_patch` audit row (the League Log and the Commissioner Hub
   * timeline read these) naming exactly the fields that changed, before and after — and, for the playoff
   * columns the league rules explainer knows, its silent `settings_changed` event for the league home's
   * "What changed" card. Both best-effort: neither may fail a save that has already landed.
   */
  const beforeState: Record<string, unknown> = {}
  const afterState: Record<string, unknown> = {}
  const noteChange = (key: string, b: unknown, a: unknown) => {
    if (same(b, a)) return
    beforeState[key] = b ?? null
    afterState[key] = a ?? null
  }
  for (const key of Object.keys(normalizedBestBall) as Array<keyof BestBallCreateSettings>) {
    if (key === 'dailyBestBall' || key === 'waiversEnabled' || key === 'tradesEnabled') continue
    noteChange(key, before[key], normalizedBestBall[key])
  }
  const currentColumns = current as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries({ ...transactionColumns, ...playoffColumns })) noteChange(key, currentColumns[key], value)
  const updatedFields = Object.keys(afterState)
  if (updatedFields.length > 0) {
    await logAction({
      leagueId,
      userId,
      actionType: 'settings_patch',
      entityType: 'league',
      entityId: leagueId,
      beforeState: beforeState as never,
      afterState: afterState as never,
      metadata: { section: 'conceptRules', source: 'best-ball-settings', updatedFields } as never,
    }).catch((e: unknown) => {
      console.warn('[bestball/settings] audit row', e instanceof Error ? e.message : 'unknown error')
    })
    const ruleBefore = {
      playoffTeams: current.playoffTeams ?? null,
      playoffStartWeek: current.playoffStartWeek ?? null,
      playoffWeeksPerRound: current.playoffWeeksPerRound ?? null,
    }
    await publishRuleChangesEvent({
      leagueId,
      actorUserId: userId,
      section: 'best-ball',
      changes: diffRuleSnapshots(ruleBefore, { ...ruleBefore, ...playoffColumns }),
    })
  }

  return NextResponse.json({ league: withClientLeagueSettings(league) })
}
