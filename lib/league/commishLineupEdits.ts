/**
 * Commish lineup editor: set any team's starters (slot by slot), bench, IR, taxi and devy for the
 * current week. Rearranges the players a team already has — adds, drops and moves between teams are
 * Edit Rosters (lib/league/commishRosterEdits.ts).
 *
 * The write goes through `commissionerForceRosterLineup`, the lineup engine's commish path: it checks
 * the league's slot template, skips kickoff and "lock all moves" locks (fixing a lineup is the point),
 * keeps `RedraftRosterPlayer.slotType` in step so SCORING follows the new lineup, records move history
 * and audits.
 *
 * 🛑 THE CALLER SENDS PLAYER IDS PER SECTION, NEVER `playerData`. The older commish override route takes
 * a raw `playerData` object, which can name players the team does not have. Here the submitted ids must
 * be exactly the team's current players, each once — the lineup is rebuilt server-side from rows we read.
 *
 * ⚠ STARTERS ARE POSITIONAL. `starters[i]` fills the i-th expanded template slot (QB, RB1, RB2, …, FLEX),
 * and the persisted array has no hole marker — an empty string is dropped on save, which would slide
 * every later starter up into the wrong slot. So an empty slot is accepted only after the last filled one.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { isRosterChopped } from '@/lib/guillotine/guillotineGuard'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { expandStarterSlots, fitsSlot, type ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import {
  buildPlayerDataFromSections,
  getNormalizedLineupSections,
  getSlotLimitsFromTemplate,
  type RosterSectionKey,
} from '@/lib/roster/LineupTemplateValidation'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { weekFromLeagueSettingsForLineup } from '@/lib/roster/buildPersistedRosterDataFromRosterState'
import { commissionerForceRosterLineup } from '@/lib/roster-lineup-engine/commissionerRosterOverride'
import { syncAfRosterLineupAssignments } from '@/lib/roster-lineup-engine/lineupAssignmentSync'
import { editableWeeks } from '@/lib/redraft/completedWeeks'
import { loadFrozenWeekRoster, replaceFrozenWeekRoster } from '@/lib/redraft/rosterWeekHistory'
import { playedPlayoffMatchups, rescorePlayoffMatchup, type PlayoffWeekMatchup } from '@/lib/league/commishPlayoffLineup'
import { resolvePastWeekFormat } from '@/lib/league/pastWeekFormatPolicy'

export class CommishLineupError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export const RESERVE_SECTIONS = ['bench', 'ir', 'taxi', 'devy'] as const
export type ReserveSection = (typeof RESERVE_SECTIONS)[number]

export type CommishLineupInput = {
  /** One entry per expanded starter slot; '' (or null) for an empty slot. */
  starters: Array<string | null>
} & Record<ReserveSection, string[]>

export type LineupPlayer = { id: string; name: string; position: string | null; team: string | null }

/**
 * Structural checks with no database: the submitted ids are exactly the roster, each once; starters
 * fit their slots with no gap above a filled slot; no section is over its limit. Exported for tests.
 */
export function validateCommishLineup(input: {
  lineup: CommishLineupInput
  rosterIds: string[]
  slots: Array<Pick<ExpandedStarterSlot, 'label' | 'allowedPositions'>>
  limits: Record<RosterSectionKey, number>
  positionOf: (id: string) => string | null
  nameOf: (id: string) => string
}): string | null {
  const { lineup, slots, limits } = input
  if (lineup.starters.length > slots.length) return 'There are more starters than starting slots.'
  const starters = lineup.starters.map((s) => (s ?? '').trim())
  const lastFilled = starters.reduce((last, id, i) => (id ? i : last), -1)
  if (starters.slice(0, lastFilled).some((id) => !id)) {
    return 'Fill the starting slots from the top: an empty slot can only come after the last filled one.'
  }
  const placed = [...starters.filter(Boolean), ...RESERVE_SECTIONS.flatMap((k) => lineup[k])]
  if (new Set(placed).size !== placed.length) return 'Each player can be in only one spot.'
  const roster = new Set(input.rosterIds)
  if (placed.some((id) => !roster.has(id))) return 'A player is not on this team.'
  if (placed.length !== roster.size) return 'Every player on the team needs a spot.'
  for (let i = 0; i < starters.length; i += 1) {
    const id = starters[i]
    if (id && !fitsSlot(slots[i]!, input.positionOf(id))) {
      return `${input.nameOf(id)} cannot start at ${slots[i]!.label}.`
    }
  }
  for (const k of RESERVE_SECTIONS) {
    if (lineup[k].length > limits[k]) {
      return limits[k] === 0 ? `This league has no ${k.toUpperCase()} spots.` : `${k.toUpperCase()} holds at most ${limits[k]}.`
    }
  }
  return null
}

async function loadContext(leagueId: string, rosterId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, sport: true, leagueVariant: true, settings: true, season: true, playoffWeeksPerRound: true },
  })
  if (!league) throw new CommishLineupError('League not found', 404)
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') {
    throw new CommishLineupError('Imported leagues are edited on their host platform.', 409)
  }
  const roster = await prisma.roster.findFirst({
    where: { id: rosterId, leagueId },
    select: { id: true, playerData: true, redraftRosterId: true },
  })
  if (!roster) throw new CommishLineupError('That team is not in this league.', 404)

  const sport = String(league.sport ?? 'NFL')
  let template
  try {
    template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, league.leagueVariant ?? undefined), leagueId)
  } catch {
    throw new CommishLineupError('Could not load this league’s lineup slots.', 409)
  }
  const slots = expandStarterSlots(template)
  const limits = getSlotLimitsFromTemplate(template)

  const rosterIds = getRosterPlayerIds(roster.playerData)
  const sections = getNormalizedLineupSections(roster.playerData)
  const rows = roster.redraftRosterId
    ? await prisma.redraftRosterPlayer.findMany({
        where: { rosterId: roster.redraftRosterId, droppedAt: null },
        select: { playerId: true, playerName: true, position: true, team: true },
      })
    : []
  const meta = new Map(rows.map((r) => [r.playerId, r]))
  const sectionRow = new Map(
    (Object.keys(sections) as RosterSectionKey[]).flatMap((k) => sections[k].map((row) => [String(row.id), row] as const)),
  )
  const players: LineupPlayer[] = rosterIds.map((id) => {
    const m = meta.get(id)
    const row = sectionRow.get(id) ?? {}
    const rowPos = typeof row.position === 'string' && row.position !== 'UTIL' ? row.position : null
    const rowName = typeof row.name === 'string' && row.name !== id ? row.name : null
    return {
      id,
      name: (m?.playerName && m.playerName !== id ? m.playerName : rowName) ?? id,
      position: m?.position ?? rowPos,
      team: m?.team ?? (typeof row.team === 'string' && row.team !== '—' ? row.team : null),
    }
  })

  // Current placement. Players the sections do not mention (an older roster shape) sit on the bench.
  const placed = new Set<string>()
  const pick = (k: RosterSectionKey) =>
    sections[k].map((r) => String(r.id)).filter((id) => rosterIds.includes(id) && !placed.has(id) && placed.add(id))
  const current = {
    starters: pick('starters').slice(0, slots.length),
    bench: [] as string[],
    ir: pick('ir'),
    taxi: pick('taxi'),
    devy: pick('devy'),
  }
  current.bench = [...pick('bench'), ...rosterIds.filter((id) => !placed.has(id))]

  return { league, roster, slots, limits, players, current, sectionRow, rosterIds }
}

export async function loadCommishLineup(leagueId: string, rosterId: string) {
  const ctx = await loadContext(leagueId, rosterId)
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { season: 'desc' },
    select: { id: true, currentWeek: true, playoffStartWeek: true },
  })
  const played = season ? await playoffMatchupsFor(ctx, season) : []
  return {
    rosterId,
    week: weekFromLeagueSettingsForLineup(ctx.league.settings),
    /** Completed weeks whose lineup can still be changed (the past-week editor), playoff weeks included. */
    pastWeeks: season ? pastWeekList(season, played) : [],
    playoffWeeks: playoffWeekList(played),
    slots: ctx.slots.map((s) => ({ label: s.label, allowedPositions: s.allowedPositions })),
    limits: ctx.limits,
    players: ctx.players,
    lineup: {
      starters: Array.from({ length: ctx.slots.length }, (_, i) => ctx.current.starters[i] ?? ''),
      bench: ctx.current.bench,
      ir: ctx.current.ir,
      taxi: ctx.current.taxi,
      devy: ctx.current.devy,
    },
  }
}

export async function saveCommishLineup(input: {
  leagueId: string
  rosterId: string
  lineup: CommishLineupInput
  actorUserId: string
}) {
  const ctx = await loadContext(input.leagueId, input.rosterId)
  if (await isRosterChopped(input.leagueId, input.rosterId)) {
    throw new CommishLineupError('A chopped Guillotine team cannot change.', 409)
  }
  const byId = new Map(ctx.players.map((p) => [p.id, p]))
  const problem = validateCommishLineup({
    lineup: input.lineup,
    rosterIds: ctx.rosterIds,
    slots: ctx.slots,
    limits: ctx.limits,
    positionOf: (id) => byId.get(id)?.position ?? null,
    nameOf: (id) => byId.get(id)?.name ?? id,
  })
  if (problem) throw new CommishLineupError(problem)

  // Rebuild the rows from what we read, keeping any metadata the stored rows already carried.
  const rowFor = (id: string): Record<string, unknown> => {
    const p = byId.get(id)!
    return { ...(ctx.sectionRow.get(id) ?? {}), id, name: p.name, position: p.position ?? 'UTIL', team: p.team ?? '—' }
  }
  const sections: Record<RosterSectionKey, Array<Record<string, unknown>>> = {
    starters: input.lineup.starters.map((s) => (s ?? '').trim()).filter(Boolean).map(rowFor),
    bench: input.lineup.bench.map(rowFor),
    ir: input.lineup.ir.map(rowFor),
    taxi: input.lineup.taxi.map(rowFor),
    devy: input.lineup.devy.map(rowFor),
  }
  const week = weekFromLeagueSettingsForLineup(ctx.league.settings)
  const result = await commissionerForceRosterLineup({
    leagueId: input.leagueId,
    rosterId: input.rosterId,
    commissionerUserId: input.actorUserId,
    nextPlayerData: buildPlayerDataFromSections(ctx.roster.playerData, sections),
    season: ctx.league.season ?? new Date().getFullYear(),
    week,
    reason: 'Set by the commish in Edit Lineup',
  })
  if (!result.ok) throw new CommishLineupError(result.error, result.status ?? 400)
  return loadCommishLineup(input.leagueId, input.rosterId)
}

// ─── Past weeks ────────────────────────────────────────────────────────────────
/*
 * A completed week's lineup lives in `af_roster_lineup_assignments` (AF roster, season, week), which
 * is what scoring reads for that week (lib/redraft/weekLineupSlots.ts). Editing it rewrites those rows
 * through the engine's own writer — the team's CURRENT lineup is untouched — then re-scores that week's
 * matchup and rebuilds the standings, which are cumulative.
 *
 * ⚠ A WEEK WITH NO SAVED LINEUP was scored from each player's current slot. The editor starts from the
 * current lineup and says so; saving writes a full lineup for the week, so from then on it is exact.
 *
 * WHO IS ON THE TEAM is the week's recorded roster (`redraft_roster_weeks`, rosterWeekHistory.ts), not
 * today's: a player traded away in week 5 is still on the team for week 3 and can be started there, and
 * one picked up in week 5 is not. A week sealed before that record existed has none, so the editor uses
 * the current roster (and says so) — and saving records it, so later trades no longer move that week.
 *
 * PLAYOFF WEEKS the team played are editable too (lib/league/commishPlayoffLineup.ts): the round is
 * re-scored from all its weeks, and a changed result moves the new winner into the next round only
 * while that round is unplayed. Any other flip is refused AFTER the lineup was written, so the week's
 * previous lineup rows are restored before the refusal is returned. Standings are not rebuilt for a
 * playoff week — they are the regular season's.
 *
 * SPECIALTY FORMATS follow lib/league/pastWeekFormatPolicy.ts: Zombie, Big Brother and Tournament re-score
 * the matchup and standings only, and the editor says their own outcome for that week (infections,
 * HOH/eviction, advancement) stands; IDP is ordinary; Guillotine, Survivor, Survivor Guillotine, Devy and
 * C2C are refused.
 *
 * Refused: a matchup whose score was set by hand in Edit Matchup Scores (re-scoring would silently
 * replace the commish's number) or whose playoff winner was picked in Edit Playoff Bracket.
 */

/** This team's played playoff matchups (title bracket, final), for the past-week editor. */
async function playoffMatchupsFor(
  ctx: { roster: { redraftRosterId: string | null }; league: { playoffWeeksPerRound?: number | null } },
  season: { id: string; playoffStartWeek: number | null },
): Promise<PlayoffWeekMatchup[]> {
  if (!ctx.roster.redraftRosterId || season.playoffStartWeek == null) return []
  return playedPlayoffMatchups({
    seasonId: season.id,
    redraftRosterId: ctx.roster.redraftRosterId,
    playoffStartWeek: season.playoffStartWeek,
    weeksPerRound: ctx.league.playoffWeeksPerRound ?? null,
  })
}

function playoffWeekList(played: PlayoffWeekMatchup[]): number[] {
  return [...new Set(played.flatMap((m) => m.weeks))].sort((a, b) => b - a)
}

/** Newest first: the playoff weeks this team played, then the completed regular-season weeks. */
function pastWeekList(season: { currentWeek: number; playoffStartWeek: number | null }, played: PlayoffWeekMatchup[]): number[] {
  return [...playoffWeekList(played), ...editableWeeks(season.currentWeek, season.playoffStartWeek)]
}

async function loadPastWeekContext(leagueId: string, rosterId: string, week: number) {
  const ctx = await loadContext(leagueId, rosterId)
  // Specialty formats: some re-score with a warning, some are refused (lib/league/pastWeekFormatPolicy.ts).
  const format = await resolvePastWeekFormat(leagueId)
  if (!format.ok) throw new CommishLineupError(format.reason, 409)
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { season: 'desc' },
    select: { id: true, season: true, currentWeek: true, playoffStartWeek: true },
  })
  if (!season) throw new CommishLineupError('This league has no AllFantasy season yet.', 404)
  if (!ctx.roster.redraftRosterId) throw new CommishLineupError('This team has no scoring record for that week.', 409)
  const played = await playoffMatchupsFor(ctx, season)
  const weeks = pastWeekList(season, played)
  if (!weeks.includes(week)) {
    throw new CommishLineupError('Only completed weeks this team played can be edited — not the current week, or a playoff round it did not play.', 400)
  }
  // A playoff week belongs to the bracket matchup whose round covers it, not to a RedraftMatchup.
  const playoff = editableWeeks(season.currentWeek, season.playoffStartWeek).includes(week)
    ? null
    : (played.find((m) => m.weeks.includes(week)) ?? null)

  const matchups = playoff ? [] : await prisma.redraftMatchup.findMany({
    where: {
      seasonId: season.id,
      week,
      isMedianMatchup: false,
      OR: [{ homeRosterId: ctx.roster.redraftRosterId }, { awayRosterId: ctx.roster.redraftRosterId }],
    },
    select: { id: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, lineupSnapshots: true },
  })
  const scoreEdited = playoff
    ? playoff.winnerPicked
    : matchups.some((m) => Boolean((m.lineupSnapshots as Record<string, unknown> | null)?.commissionerEdit))

  // The roster this team had in that week, when the week was recorded; otherwise today's.
  const weekRoster = await loadFrozenWeekRoster(ctx.roster.redraftRosterId, week)
  const players: LineupPlayer[] = weekRoster
    ? weekRoster.map((p) => ({ id: p.playerId, name: p.playerName, position: p.position || null, team: p.team }))
    : ctx.players
  const rosterIds = players.map((p) => p.id)
  return { ...ctx, players, rosterIds, weekRosterRecorded: weekRoster != null, season, weeks, playoffWeeks: playoffWeekList(played), matchups, playoff, scoreEdited, formatNote: format.note }
}

export async function loadCommishPastLineup(leagueId: string, rosterId: string, week: number) {
  const ctx = await loadPastWeekContext(leagueId, rosterId, week)
  const rows = await prisma.afRosterLineupAssignment.findMany({
    where: { rosterId, season: ctx.season.season, week },
    orderBy: [{ section: 'asc' }, { slotIndex: 'asc' }],
    select: { section: true, slotIndex: true, playerId: true },
  })
  const onRoster = new Set(ctx.rosterIds)
  const saved = rows.filter((r) => onRoster.has(r.playerId))
  let lineup: { starters: string[]; bench: string[]; ir: string[]; taxi: string[]; devy: string[] }
  if (saved.length > 0) {
    const of = (k: string) => saved.filter((r) => r.section === k).sort((a, b) => a.slotIndex - b.slotIndex).map((r) => r.playerId)
    const named = new Set(saved.map((r) => r.playerId))
    lineup = {
      starters: Array.from({ length: ctx.slots.length }, (_, i) => of('starters')[i] ?? ''),
      // A player the saved week never named (added afterwards) sits on the bench in the editor.
      bench: [...of('bench'), ...ctx.rosterIds.filter((id) => !named.has(id))],
      ir: of('ir'),
      taxi: of('taxi'),
      devy: of('devy'),
    }
  } else {
    // Today's lineup, keeping only players the team had that week; the rest of that week's roster sits on the bench.
    const keep = (ids: string[]) => ids.filter((id) => onRoster.has(id))
    const starters = Array.from({ length: ctx.slots.length }, (_, i) => {
      const id = ctx.current.starters[i] ?? ''
      return onRoster.has(id) ? id : ''
    })
    const placed = new Set([...starters, ...keep(ctx.current.ir), ...keep(ctx.current.taxi), ...keep(ctx.current.devy)])
    lineup = {
      starters,
      bench: [...keep(ctx.current.bench), ...ctx.rosterIds.filter((id) => !placed.has(id) && !ctx.current.bench.includes(id))],
      ir: keep(ctx.current.ir),
      taxi: keep(ctx.current.taxi),
      devy: keep(ctx.current.devy),
    }
  }
  return {
    rosterId,
    week,
    weeks: ctx.weeks,
    playoffWeeks: ctx.playoffWeeks,
    savedForWeek: saved.length > 0,
    /** False: the week predates the roster record, so this is today's roster (saving records it). */
    weekRosterRecorded: ctx.weekRosterRecorded,
    scoreEdited: ctx.scoreEdited,
    /** A specialty format whose own weekly outcome (infections, HOH/eviction, advancement) a re-score leaves alone. */
    formatNote: ctx.formatNote,
    /** Set for a playoff week: the round it belongs to and every week that round scores. */
    playoff: ctx.playoff ? { roundNumber: ctx.playoff.roundNumber, weeks: ctx.playoff.weeks } : null,
    matchup: ctx.playoff
      ? {
          home: ctx.playoff.homeRosterId === ctx.roster.redraftRosterId,
          myScore: ctx.playoff.homeRosterId === ctx.roster.redraftRosterId ? ctx.playoff.homeScore : ctx.playoff.awayScore,
          theirScore: ctx.playoff.homeRosterId === ctx.roster.redraftRosterId ? ctx.playoff.awayScore : ctx.playoff.homeScore,
        }
      : ctx.matchups[0]
      ? {
          home: ctx.matchups[0].homeRosterId === ctx.roster.redraftRosterId,
          myScore: ctx.matchups[0].homeRosterId === ctx.roster.redraftRosterId ? ctx.matchups[0].homeScore : ctx.matchups[0].awayScore,
          theirScore: ctx.matchups[0].homeRosterId === ctx.roster.redraftRosterId ? ctx.matchups[0].awayScore : ctx.matchups[0].homeScore,
        }
      : null,
    slots: ctx.slots.map((s) => ({ label: s.label, allowedPositions: s.allowedPositions })),
    limits: ctx.limits,
    players: ctx.players,
    lineup,
  }
}

export async function saveCommishPastLineup(input: {
  leagueId: string
  rosterId: string
  week: number
  lineup: CommishLineupInput
  actorUserId: string
}) {
  const ctx = await loadPastWeekContext(input.leagueId, input.rosterId, input.week)
  if (ctx.scoreEdited) {
    throw new CommishLineupError(
      ctx.playoff
        ? 'The commish picked this playoff matchup’s winner in Edit Playoff Bracket, so its lineups are not re-scored.'
        : 'This matchup’s score was set by hand in Edit Matchup Scores. Change the score there instead.',
      409,
    )
  }
  const byId = new Map(ctx.players.map((p) => [p.id, p]))
  const problem = validateCommishLineup({
    lineup: input.lineup,
    rosterIds: ctx.rosterIds,
    slots: ctx.slots,
    limits: ctx.limits,
    positionOf: (id) => byId.get(id)?.position ?? null,
    nameOf: (id) => byId.get(id)?.name ?? id,
  })
  if (problem) throw new CommishLineupError(problem)

  const rowFor = (id: string): Record<string, unknown> => ({ id, position: byId.get(id)?.position ?? 'UTIL' })
  const sections: Record<RosterSectionKey, Array<Record<string, unknown>>> = {
    starters: input.lineup.starters.map((s) => (s ?? '').trim()).filter(Boolean).map(rowFor),
    bench: input.lineup.bench.map(rowFor),
    ir: input.lineup.ir.map(rowFor),
    taxi: input.lineup.taxi.map(rowFor),
    devy: input.lineup.devy.map(rowFor),
  }
  const before = ctx.playoff
    ? [{ matchupId: ctx.playoff.matchupId, homeScore: ctx.playoff.homeScore, awayScore: ctx.playoff.awayScore }]
    : ctx.matchups.map((m) => ({ matchupId: m.id, homeScore: m.homeScore, awayScore: m.awayScore }))

  // Pin who was on the team that week before re-scoring, so a later trade cannot move it again.
  if (!ctx.weekRosterRecorded) {
    const current = await prisma.redraftRosterPlayer.findMany({
      where: { rosterId: ctx.roster.redraftRosterId!, droppedAt: null },
      select: { playerId: true, playerName: true, position: true, team: true, sport: true, slotType: true },
    })
    await replaceFrozenWeekRoster({ rosterId: ctx.roster.redraftRosterId!, seasonId: ctx.season.id, week: input.week, players: current })
  }

  // A playoff re-score can be refused AFTER the lineup is written (it would flip a round whose next
  // round was already played), so keep the week's rows to put back.
  const previousRows = ctx.playoff
    ? await prisma.afRosterLineupAssignment.findMany({
        where: { rosterId: input.rosterId, season: ctx.season.season, week: input.week },
        select: { leagueId: true, rosterId: true, season: true, week: true, section: true, slotIndex: true, playerId: true },
      })
    : []

  // The engine's own per-week writer; `playerData` here is only the week's sections, never saved to the roster.
  await syncAfRosterLineupAssignments({
    leagueId: input.leagueId,
    rosterId: input.rosterId,
    season: ctx.season.season,
    week: input.week,
    playerData: buildPlayerDataFromSections({}, sections),
  })

  const after: Array<{ matchupId: string; homeScore: number | null; awayScore: number | null }> = []
  let advancedChanged = false
  if (ctx.playoff) {
    const result = await rescorePlayoffMatchup({
      leagueId: input.leagueId,
      seasonId: ctx.season.id,
      seasonYear: ctx.season.season,
      matchup: ctx.playoff,
    })
    if (!result.ok) {
      await prisma.afRosterLineupAssignment.deleteMany({ where: { rosterId: input.rosterId, season: ctx.season.season, week: input.week } })
      if (previousRows.length > 0) await prisma.afRosterLineupAssignment.createMany({ data: previousRows })
      throw new CommishLineupError(result.reason, 409)
    }
    after.push({ matchupId: ctx.playoff.matchupId, homeScore: result.homeScore, awayScore: result.awayScore })
    advancedChanged = result.flipped
  } else {
    const { updateMatchupScores } = await import('@/lib/redraft/scoringEngine')
    const { updateStandings } = await import('@/lib/redraft/standingsEngine')
    for (const m of ctx.matchups) {
      const s = await updateMatchupScores(m.id)
      after.push({ matchupId: m.id, homeScore: s?.homeScore ?? null, awayScore: s?.awayScore ?? null })
    }
    // Standings are cumulative: rebuild through the latest completed week, never just the edited one.
    await updateStandings(ctx.season.id, Math.max(input.week, ctx.season.currentWeek - 1))
  }

  const { logAction } = await import('@/server/services/auditService')
  await logAction({
    leagueId: input.leagueId,
    userId: input.actorUserId,
    actionType: 'commish_edit_past_lineup',
    entityType: 'roster',
    entityId: input.rosterId,
    beforeState: before as never,
    afterState: { week: input.week, lineup: input.lineup, scores: after, playoffRound: ctx.playoff?.roundNumber ?? null, advancedChanged } as never,
  }).catch(() => undefined)
  void import('@/lib/league-events/publisher')
    .then(({ publishLeagueFanoutEvent }) =>
      publishLeagueFanoutEvent({
        leagueId: input.leagueId,
        eventType: 'commissioner_override',
        title: `Commish lineup change — week ${input.week}`,
        message: ctx.playoff
          ? advancedChanged
            ? `The commish changed a lineup for week ${input.week}; playoff round ${ctx.playoff.roundNumber} was re-scored and a different team now advances.`
            : `The commish changed a lineup for week ${input.week}; playoff round ${ctx.playoff.roundNumber} was re-scored.`
          : `The commish changed a lineup for week ${input.week}; the matchup and standings were re-scored.`,
        category: 'league_announcements',
        visibility: 'all_members',
        actorUserId: input.actorUserId,
        meta: { rosterId: input.rosterId, week: input.week, scores: after, playoffRound: ctx.playoff?.roundNumber ?? null, advancedChanged },
        dedupeKey: `commish_past_lineup:${input.rosterId}:${input.week}:${Date.now()}`,
      }),
    )
    .catch(() => {})

  return loadCommishPastLineup(input.leagueId, input.rosterId, input.week)
}
