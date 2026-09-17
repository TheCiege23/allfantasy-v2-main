import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  isLeagueWeekRefusal,
  leagueWeekBasis,
  priceLeagueWeek,
} from '@/lib/decision-os/trade/leagueWeekPricing'
import { injuryCoverageFor, resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { myRosterCandidates } from './myRoster'
import { translateRostersByLeague } from './rosterIdSpace'
import { composePlayerIdentities } from './playerIdentityCompose'
import { fragilePositions, rosterSlots, topStack } from './portfolioInsights'
import { isAtRisk, isRuledOut } from './injuryStatus'
import { resolveSportsWeek } from './sportsWeek'
import { getByeWeeks } from './byeWeeks'
import { canFillSlot, startingSlots } from './slotEligibility'
import { normalizePosition } from './positionNormalization'
import { pctOf, simulateSeason, type SimAdjustment, type SimInput } from './outlookSim'
import {
  bestLineup,
  scenarioEffect,
  setLineupPoints,
  EMPTY_SCENARIO,
  type ScenarioModel,
  type ScenarioPlayer,
  type ScenarioTeam,
} from './outlookScenario'

/**
 * Season Outlook for ONE league — the parts that need rosters: the scenario model, what drives the
 * season, the recommended moves priced in playoff odds, and roster durability.
 *
 * Only ever built for the league on screen. A cross-league board of sixty leagues does not need
 * sixty roster models, and building them would put a projection read per league on a page that is
 * already the most expensive in the app.
 *
 * ⚠ EVERY PERCENTAGE HERE COMES FROM A BRANCH RUN AGAINST A BRANCH BASELINE — the same seed, the same
 * iteration count, one input changed. Comparing a 2,000-run variant against the 10,000-run headline
 * would mix the thing being measured with the difference in sampling noise between the two.
 */

export const BRANCH_ITERATIONS = 2_000

/** A driver or a move smaller than this is inside the branch runs' own noise and is not shown. */
const MIN_IMPACT = 1

/** A lineup or waiver change worth less than this per week is not a recommendation. */
const MIN_WEEKLY_GAIN = 1

/** Free agents considered per position. */
const FREE_AGENTS_PER_POSITION = 5
/** Projection rows read to find them — the top of one week's feed, which holds ~1,000. */
const FREE_AGENT_SCAN = 600

export type OutlookDriver = {
  key: 'strength' | 'schedule' | 'luck' | 'swing' | 'injuries' | 'byes'
  label: string
  detail: string
  /** Points of playoff probability this factor is worth to you, signed. Swing is unsigned. */
  impact: number
  /** True when `impact` is a spread (±), not a direction. */
  spread: boolean
}

export type OutlookMove = {
  key: string
  kind: 'lineup' | 'waiver'
  title: string
  detail: string
  /** The week it applies to, or null for the rest of the season. */
  week: number | null
  pointsPerWeek: number
  playoffDelta: number
  titleDelta: number
  href: string
}

export type OutlookDurability = {
  basisWeek: { season: string; week: number } | null
  starters: number
  age: {
    averageAge: number | null
    knownAges: number
    older: Array<{ name: string; position: string | null; age: number }>
  }
  /** Dedicated slots with no healthy backup. Null when the league stores no slots. */
  depth: Array<{ position: string; starters: number; healthy: number; players: string[] }> | null
  injuries: Array<{
    name: string
    position: string | null
    status: string
    kind: 'out' | 'risk'
    points: number | null
    starting: boolean
  }>
  injuryFeedNote: string | null
  /** `pointsLost` is null when the roster cannot be priced — the bye itself is still a fact. */
  byes: Array<{ week: number; players: string[]; pointsLost: number | null }>
  concentration: {
    topPosition: { position: string; share: number } | null
    topPlayer: { name: string; share: number } | null
    stack: { team: string; players: string[] } | null
  }
  flags: string[]
}

export type OutlookFocus = {
  scenario: ScenarioModel
  drivers: OutlookDriver[]
  moves: OutlookMove[]
  durability: OutlookDurability | null
  /** What the branch runs used, printed in the assumptions panel. */
  branchIterations: number
  notes: string[]
}

type Obj = Record<string, unknown>

function sourceManagerId(playerData: unknown): string | null {
  const v = (playerData as Obj | null)?.source_manager_id
  return typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : null
}

const round1 = (n: number) => Math.round(n * 10) / 10

// ── Roster model ───────────────────────────────────────────────────────

export async function loadScenarioModel(args: {
  leagueId: string
  userId: string
  sport: string
  platform: string
  settings: unknown
  youRosterId: string | null
  sim: SimInput
  seed: number
  weeks: number[]
  names: ReadonlyMap<string, string>
  now: Date
}): Promise<{ model: ScenarioModel; injuryFeedNote: string | null }> {
  const base: ScenarioModel = {
    leagueId: args.leagueId,
    basisWeek: null,
    refusal: null,
    slots: startingSlots(args.settings) ?? [],
    teams: [],
    freeAgents: [],
    sim: args.sim,
    seed: args.seed,
    weeks: args.weeks,
    youRosterId: args.youRosterId,
  }

  const basis = await leagueWeekBasis({ sport: args.sport, scoringSettings: args.settings })
  if (isLeagueWeekRefusal(basis)) {
    return { model: { ...base, refusal: `Roster changes cannot be priced here: ${basis.detail}.` }, injuryFeedNote: null }
  }
  if (base.slots.length === 0) {
    return {
      model: { ...base, refusal: 'Roster changes cannot be priced here: this league stores no starting lineup slots.' },
      injuryFeedNote: null,
    }
  }

  const [teams, rawRosters] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId: args.leagueId },
      select: { externalId: true, platformUserId: true, claimedByUserId: true, teamName: true, ownerName: true },
    }),
    prisma.roster.findMany({
      where: { leagueId: args.leagueId },
      select: { leagueId: true, platformUserId: true, playerData: true },
    }),
  ]).catch(() => [[], []] as const)

  const rosters = await translateRostersByLeague(
    rawRosters,
    new Map([[args.leagueId, args.platform]]),
  ).catch(() => [...rawRosters])

  /* One roster per team: the source manager id first, then the claimed-team candidates. */
  const simIds = new Set(args.sim.teams.map((t) => t.rosterId))
  const used = new Set<number>()
  const matched: Array<{ rosterId: string; slots: Map<string, 'S' | 'B' | 'I' | 'T'> }> = []
  for (const team of teams) {
    if (!team.externalId || !simIds.has(team.externalId)) continue
    let idx = rosters.findIndex(
      (r, i) => !used.has(i) && team.platformUserId != null && sourceManagerId(r.playerData) === team.platformUserId,
    )
    if (idx < 0) {
      const candidates = myRosterCandidates(team, team.claimedByUserId ?? '')
      for (const c of candidates) {
        idx = rosters.findIndex((r, i) => !used.has(i) && r.platformUserId === c)
        if (idx >= 0) break
      }
    }
    if (idx < 0) continue
    used.add(idx)
    matched.push({ rosterId: team.externalId, slots: rosterSlots(rosters[idx].playerData) })
  }

  const rosteredIds = [...new Set(matched.flatMap((m) => [...m.slots.keys()]))]
  if (rosteredIds.length === 0) {
    return {
      model: { ...base, basisWeek: basis.week, refusal: 'Roster changes cannot be priced here: no rosters are synced for this league.' },
      injuryFeedNote: null,
    }
  }

  /* Identity and age. */
  const identityRows = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: rosteredIds }, sport: { equals: 'NFL', mode: 'insensitive' } },
      select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true, age: true },
    })
    .catch(() => [])
  const identity = composePlayerIdentities(identityRows)
  const ageOf = new Map<string, number>()
  for (const r of identityRows) {
    if (r.sleeperId && typeof r.age === 'number' && r.age > 0 && !ageOf.has(r.sleeperId)) ageOf.set(r.sleeperId, r.age)
  }

  /* The free-agent pool: the top of this week's feed, minus everyone rostered here. */
  const rostered = new Set(rosteredIds)
  const feed = await prisma.fantasyProjection
    .findMany({
      where: { sport: 'NFL', season: basis.week.season, week: basis.week.week, source: { not: 'allfantasy' } },
      orderBy: { projectedPoints: 'desc' },
      take: FREE_AGENT_SCAN,
      select: { playerId: true, stats: true },
    })
    .catch(() => [])
  const faMeta = new Map<string, { name: string | null; position: string | null; team: string | null }>()
  const perPosition = new Map<string, number>()
  /* Offensive positions this league can start. Defensive free agents are not scanned. */
  const slotPositions = new Set(
    ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].filter((pos) => base.slots.some((slot) => canFillSlot(slot, pos))),
  )
  for (const row of feed) {
    if (rostered.has(row.playerId) || faMeta.has(row.playerId)) continue
    const stats = (row.stats ?? {}) as Obj
    const position = typeof stats.position === 'string' ? stats.position.toUpperCase() : null
    if (!position || !slotPositions.has(position)) continue
    const n = perPosition.get(position) ?? 0
    if (n >= FREE_AGENTS_PER_POSITION) continue
    perPosition.set(position, n + 1)
    faMeta.set(row.playerId, {
      name: typeof stats.name === 'string' ? stats.name : null,
      position,
      team: typeof stats.team === 'string' ? stats.team : null,
    })
  }

  /* Short codes: some identity rows carry "Wide Receiver", and every consumer compares codes. */
  const positions = new Map<string, string | null>()
  for (const id of rosteredIds) positions.set(id, normalizePosition(identity.get(id)?.position ?? null) || null)
  for (const [id, m] of faMeta) positions.set(id, m.position)

  const priced = await priceLeagueWeek(basis, [...positions.keys()], positions)

  /* Injuries — never shown when stale, never guessed when the feed cannot answer. */
  let injuryFeedNote: string | null = null
  const injuryOf = new Map<string, { status: string; kind: 'out' | 'risk' }>()
  const coverage = injuryCoverageFor('NFL')
  if (!coverage.covered) {
    injuryFeedNote = coverage.reason ?? 'No injury feed covers this sport.'
  } else {
    const lookups = [...positions.keys()]
      .map((id) => ({
        id,
        name: identity.get(id)?.name ?? faMeta.get(id)?.name ?? null,
        position: positions.get(id) ?? null,
        team: identity.get(id)?.team ?? faMeta.get(id)?.team ?? null,
      }))
      .filter((x): x is { id: string; name: string; position: string | null; team: string | null } => Boolean(x.name))
    const res = await resolveInjuryFacts({
      sport: 'NFL',
      players: lookups.map((x) => ({ name: x.name, position: x.position, team: x.team })),
      now: args.now,
    }).catch(() => null)
    if (!res) injuryFeedNote = 'The injury feed could not be read, so no player is marked hurt — that is unknown, not healthy.'
    else {
      if (res.feedStale) injuryFeedNote = 'The injury feed is behind, so injury marks may be missing.'
      for (const x of lookups) {
        const fact = res.byPlayer.get(normalizeMatchName(x.name))
        if (!fact || fact.stale || !fact.status) continue
        const status = String(fact.status)
        const kind = isRuledOut(status) ? 'out' : isAtRisk(status) ? 'risk' : null
        if (kind) injuryOf.set(x.id, { status, kind })
      }
    }
  }

  /* Byes over the remaining weeks. */
  const byeOf = new Map<string, number>()
  const sportsWeek = await resolveSportsWeek('NFL', args.now).catch(() => null)
  if (sportsWeek && args.weeks.length > 0) {
    const playerTeams = new Map<string, string | null>()
    for (const id of positions.keys()) playerTeams.set(id, identity.get(id)?.team ?? faMeta.get(id)?.team ?? null)
    const from = args.weeks[0]
    const byes = await getByeWeeks({
      sport: 'NFL',
      season: sportsWeek.season,
      playerTeams,
      fromWeek: from,
      horizon: Math.max(0, args.weeks[args.weeks.length - 1] - from),
    }).catch(() => null)
    for (const [week, ids] of byes?.byWeek ?? []) for (const id of ids) if (!byeOf.has(id)) byeOf.set(id, week)
  }

  const player = (id: string, slot: ScenarioPlayer['slot']): ScenarioPlayer => ({
    id,
    name: identity.get(id)?.name ?? faMeta.get(id)?.name ?? `Player ${id}`,
    position: positions.get(id) ?? priced.get(id)?.position ?? null,
    team: identity.get(id)?.team ?? faMeta.get(id)?.team ?? null,
    points: priced.get(id)?.projectedPoints ?? null,
    slot,
    injury: injuryOf.get(id) ?? null,
    byeWeek: byeOf.get(id) ?? null,
    age: ageOf.get(id) ?? null,
  })

  const scenarioTeams: ScenarioTeam[] = matched.map((m) => ({
    rosterId: m.rosterId,
    name: args.names.get(m.rosterId) ?? 'Unnamed team',
    isYou: m.rosterId === args.youRosterId,
    players: [...m.slots.entries()].map(([id, slot]) => player(id, slot)),
  }))

  const freeAgents = [...faMeta.keys()]
    .map((id) => player(id, 'F'))
    .filter((p) => p.points != null && p.injury?.kind !== 'out')
    .sort((a, b) => (b.points as number) - (a.points as number))

  return {
    model: { ...base, basisWeek: basis.week, teams: scenarioTeams, freeAgents },
    injuryFeedNote,
  }
}

// ── Drivers, moves, durability ─────────────────────────────────────────

export type FocusInput = {
  leagueId: string
  leagueName: string
  sim: SimInput
  seed: number
  youRosterId: string
  weeks: number[]
  /** All-play expected wins so far this season, for the luck driver. Null when unknown. */
  expectedWins: number | null
  remainingRank: number | null
  remainingOpponentMu: number | null
  leagueMu: number | null
  teamsRanked: number
  swing: { week: number; opponentName: string | null; ifWin: number; ifLose: number } | null
  model: ScenarioModel
  injuryFeedNote: string | null
}

export function buildFocusInsights(input: FocusInput): Omit<OutlookFocus, 'scenario'> {
  const { sim, seed, youRosterId: you, model } = input
  const notes: string[] = []
  const me = sim.teams.find((t) => t.rosterId === you)
  const run = (opts: { adjustments?: SimAdjustment[]; neutral?: boolean; teams?: SimInput['teams'] }) => {
    const t = simulateSeason(opts.teams ? { ...sim, teams: opts.teams } : sim, {
      iterations: BRANCH_ITERATIONS,
      seed,
      adjustments: opts.adjustments,
      neutralScheduleFor: opts.neutral ? you : null,
    })
    const c = t.counts[you] ?? { playoff: 0, bye: 0, title: 0 }
    return { playoff: pctOf(c.playoff, t.iterations), title: pctOf(c.title, t.iterations) }
  }

  const baseline = run({})
  const drivers: OutlookDriver[] = []
  const moves: OutlookMove[] = []

  if (me?.profile && input.weeks.length > 0) {
    /* Strength: you, at the league's average. */
    if (input.leagueMu != null) {
      const gap = me.profile.mu - input.leagueMu
      const flat = run({ adjustments: [{ rosterId: you, points: -gap }] })
      drivers.push({
        key: 'strength',
        label: 'Your scoring',
        detail: `${Math.abs(round1(gap))} points a week ${gap >= 0 ? 'above' : 'below'} the league average, over ${me.profile.n} weeks on file.`,
        impact: baseline.playoff - flat.playoff,
        spread: false,
      })
    }

    /* Schedule: the same games against a league-average opponent. */
    const neutral = run({ neutral: true })
    drivers.push({
      key: 'schedule',
      label: 'Remaining schedule',
      detail:
        input.remainingRank != null && input.remainingOpponentMu != null && input.leagueMu != null
          ? `${ordinal(input.remainingRank)} hardest of ${input.teamsRanked}: opponents average ${round1(input.remainingOpponentMu)} against a league average of ${round1(input.leagueMu)}.`
          : 'Your remaining opponents, against a league-average team.',
      impact: baseline.playoff - neutral.playoff,
      spread: false,
    })

    /* Luck: your record against what your weekly scores would have earned against everyone. */
    if (input.expectedWins != null && Math.abs(me.wins - input.expectedWins) >= 0.75) {
      const fair = Math.round(input.expectedWins)
      const games = me.wins + me.losses
      const teams = sim.teams.map((t) =>
        t.rosterId === you ? { ...t, wins: fair, losses: Math.max(0, games - fair) } : t,
      )
      const even = run({ teams })
      const diff = me.wins - input.expectedWins
      drivers.push({
        key: 'luck',
        label: 'Record against points',
        detail: `${Math.abs(round1(diff))} ${Math.abs(diff) >= 1.5 ? 'wins' : 'win'} ${diff > 0 ? 'more' : 'fewer'} than your weekly scores would have earned against the whole league (${round1(input.expectedWins)} expected).`,
        impact: baseline.playoff - even.playoff,
        spread: false,
      })
    }
  }

  if (input.swing) {
    drivers.push({
      key: 'swing',
      label: `Week ${input.swing.week}${input.swing.opponentName ? ` vs ${input.swing.opponentName}` : ''}`,
      detail: `Win and you are at ${Math.round(input.swing.ifWin)}%; lose and you are at ${Math.round(input.swing.ifLose)}%.`,
      impact: (input.swing.ifWin - input.swing.ifLose) / 2,
      spread: true,
    })
  }

  const youTeam = model.teams.find((t) => t.isYou) ?? null
  let durability: OutlookDurability | null = null

  if (!model.refusal && youTeam && me?.profile) {
    const players = youTeam.players
    const firstWeek = input.weeks[0]

    /* Injuries this week: every ruled-out player of yours, out for one week. */
    const hurt = players.filter((p) => p.injury?.kind === 'out')
    if (hurt.length > 0) {
      /* `bestLineup` already skips ruled-out players, so price the difference against them healthy. */
      const healthy = players.map((p) => (p.injury?.kind === 'out' ? { ...p, injury: null } : p))
      const lost = bestLineup(healthy, model.slots, firstWeek).points - bestLineup(players, model.slots, firstWeek).points
      if (lost >= 0.05) {
        const outRun = run({ adjustments: [{ rosterId: you, fromWeek: firstWeek, toWeek: firstWeek, points: -lost }] })
        drivers.push({
          key: 'injuries',
          label: 'Injuries',
          detail: `${hurt.map((p) => p.name).join(', ')} ${hurt.length === 1 ? 'is' : 'are'} ruled out — ${round1(lost)} lineup points in week ${firstWeek}, if only for that week.`,
          impact: outRun.playoff - baseline.playoff,
          spread: false,
        })
      }
    }

    /*
     * Byes over the rest of the season. The lineup is the best priced one, or — when nothing on the
     * roster is priced — the one actually set, so the bye weeks are still reported without a cost.
     */
    const byeRows: OutlookDurability['byes'] = []
    const full = bestLineup(players, model.slots)
    const priced = full.starterIds.length > 0
    const lineupIds = lineupOf(players, full)
    for (const week of input.weeks) {
      const lostPts = priced ? full.points - bestLineup(players, model.slots, week).points : 0
      const off = players.filter((p) => p.byeWeek === week && lineupIds.includes(p.id)).map((p) => p.name)
      if (off.length > 0) byeRows.push({ week, players: off, pointsLost: priced ? round1(lostPts) : null })
    }

    /*
     * 🛑 EVERY TEAM'S BYES, NOT JUST YOURS. Charging only your bye weeks measured "what if you had
     * none while everyone else still did" — on the production copy that read as 15 points of
     * playoff odds for a perfectly ordinary bye schedule. Rivals lose starters too; what moves YOUR
     * odds is how your bye burden compares with theirs, so each priced roster gets its own weeks.
     */
    const byeAdjust: SimAdjustment[] = []
    for (const team of model.teams) {
      const teamFull = bestLineup(team.players, model.slots)
      if (teamFull.starterIds.length === 0) continue
      for (const week of input.weeks) {
        const lost = teamFull.points - bestLineup(team.players, model.slots, week).points
        if (lost >= 0.05) byeAdjust.push({ rosterId: team.rosterId, fromWeek: week, toWeek: week, points: -lost })
      }
    }
    if (priced && byeAdjust.length > 0) {
      const byeRun = run({ adjustments: byeAdjust })
      const worst = [...byeRows].sort((a, b) => (b.pointsLost ?? 0) - (a.pointsLost ?? 0))[0]
      drivers.push({
        key: 'byes',
        label: 'Bye weeks',
        detail: worst
          ? `Measured against every team's byes. Your worst is week ${worst.week}: ${worst.players.join(', ')} off, ${worst.pointsLost} lineup points.`
          : 'Your bye weeks against everyone else’s.',
        impact: byeRun.playoff - baseline.playoff,
        spread: false,
      })
    }

    /* ── Moves ─────────────────────────────────────────────────────── */
    const basisWeek = model.basisWeek?.week ?? null
    if (basisWeek != null && input.weeks.includes(basisWeek)) {
      const set = setLineupPoints(players)
      const best = bestLineup(players, model.slots, basisWeek)
      if (set != null && best.unknown.length === 0 && best.points - set >= MIN_WEEKLY_GAIN) {
        const gain = best.points - set
        const r = run({ adjustments: [{ rosterId: you, fromWeek: basisWeek, toWeek: basisWeek, points: gain }] })
        const ins = best.starterIds.filter((id) => !players.find((p) => p.id === id && p.slot === 'S'))
        const outs = players.filter((p) => p.slot === 'S' && !best.starterIds.includes(p.id))
        moves.push({
          key: `lineup-${basisWeek}`,
          kind: 'lineup',
          title: `Set your best lineup for week ${basisWeek}`,
          detail: `Start ${ins.map((id) => players.find((p) => p.id === id)?.name ?? id).join(', ')} over ${outs.map((p) => `${p.name}${p.injury?.kind === 'out' ? ' (out)' : ''}`).join(', ')}.`,
          week: basisWeek,
          pointsPerWeek: round1(gain),
          playoffDelta: r.playoff - baseline.playoff,
          titleDelta: r.title - baseline.title,
          href: `/core/my-team?league=${encodeURIComponent(input.leagueId)}`,
        })
      }
    } else if (basisWeek != null) {
      notes.push(`The projection feed is on week ${basisWeek}, which is not one of this league's remaining weeks, so no lineup move is suggested.`)
    }

    /* Waivers: the best add, with the drop that costs the least. */
    const before = bestLineup(players, model.slots).points
    const droppable = players.filter((p) => p.slot !== 'S' && p.slot !== 'T')
    const candidates: Array<{ add: ScenarioPlayer; drop: ScenarioPlayer | null; gain: number }> = []
    for (const add of model.freeAgents.slice(0, 30)) {
      let bestPick: { drop: ScenarioPlayer | null; gain: number } | null = null
      const options: Array<ScenarioPlayer | null> = droppable.length > 0 ? droppable : [null]
      for (const drop of options) {
        const after = [...players.filter((p) => p.id !== drop?.id), { ...add, slot: 'B' as const }]
        const gain = bestLineup(after, model.slots).points - before
        if (!bestPick || gain > bestPick.gain) bestPick = { drop, gain }
      }
      if (bestPick && bestPick.gain >= MIN_WEEKLY_GAIN) candidates.push({ add, ...bestPick })
    }
    candidates.sort((a, b) => b.gain - a.gain)
    const seenDrops = new Set<string>()
    for (const c of candidates) {
      if (moves.filter((m) => m.kind === 'waiver').length >= 2) break
      if (c.drop && seenDrops.has(c.drop.id)) continue
      if (c.drop) seenDrops.add(c.drop.id)
      const effect = scenarioEffect(model, { ...EMPTY_SCENARIO, waivers: [{ addId: c.add.id, dropId: c.drop?.id ?? null }] })
      const r = run({ adjustments: effect.adjustments })
      moves.push({
        key: `waiver-${c.add.id}`,
        kind: 'waiver',
        title: `Add ${c.add.name}${c.drop ? `, drop ${c.drop.name}` : ''}`,
        detail: `${c.add.position ?? ''}${c.add.team ? `, ${c.add.team}` : ''} — ${round1(c.add.points ?? 0)} projected in week ${model.basisWeek?.week}. Worth about ${round1(c.gain)} lineup points a week to you.`,
        week: null,
        pointsPerWeek: round1(c.gain),
        playoffDelta: r.playoff - baseline.playoff,
        titleDelta: r.title - baseline.title,
        href: `/core/waivers?league=${encodeURIComponent(input.leagueId)}`,
      })
    }

    durability = buildDurability(model, youTeam, byeRows, input.injuryFeedNote)
  } else if (model.refusal) {
    notes.push(model.refusal)
  } else if (!youTeam) {
    notes.push('Your roster could not be matched in this league, so roster-based drivers and moves are not shown.')
  }

  const shown = drivers
    .filter((d) => Math.abs(d.impact) >= MIN_IMPACT)
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
  if (drivers.length > shown.length) {
    notes.push(
      `${drivers.length - shown.length} factor${drivers.length - shown.length === 1 ? '' : 's'} moved your odds by less than ${MIN_IMPACT} point and ${drivers.length - shown.length === 1 ? 'is' : 'are'} not listed.`,
    )
  }

  return {
    drivers: shown,
    moves: moves.sort((a, b) => b.playoffDelta - a.playoffDelta || b.pointsPerWeek - a.pointsPerWeek),
    durability,
    branchIterations: BRANCH_ITERATIONS,
    notes,
  }
}

/** The best priced lineup's players, or the lineup actually set when nothing is priced. */
function lineupOf(players: readonly ScenarioPlayer[], best: { starterIds: string[] }): string[] {
  return best.starterIds.length > 0 ? best.starterIds : players.filter((p) => p.slot === 'S').map((p) => p.id)
}

/** Age past which a starter at this position is a durability flag. */
const AGE_FLAG: Record<string, number> = { RB: 28, WR: 30, TE: 31, QB: 35 }

function buildDurability(
  model: ScenarioModel,
  you: ScenarioTeam,
  byes: OutlookDurability['byes'],
  injuryFeedNote: string | null,
): OutlookDurability {
  const players = you.players
  const best = bestLineup(players, model.slots)
  const byId = new Map(players.map((p) => [p.id, p]))
  const lineupIds = lineupOf(players, best)
  const starters = lineupIds.map((id) => byId.get(id)).filter((p): p is ScenarioPlayer => Boolean(p))

  const aged = starters.filter((p) => p.age != null)
  const averageAge = aged.length > 0 ? round1(aged.reduce((a, p) => a + (p.age as number), 0) / aged.length) : null
  const older = starters
    .filter((p) => p.age != null && p.position != null && AGE_FLAG[p.position.toUpperCase()] != null && (p.age as number) >= AGE_FLAG[p.position.toUpperCase()])
    .map((p) => ({ name: p.name, position: p.position, age: p.age as number }))

  const slotMap = new Map(players.map((p) => [p.id, p.slot === 'F' ? ('B' as const) : p.slot]))
  const fragile = fragilePositions(
    model.slots,
    slotMap,
    (id) => byId.get(id)?.position ?? null,
    (id) => byId.get(id)?.injury?.kind === 'out',
  )
  const depth = fragile?.map((f) => ({ ...f, players: f.players.map((id) => byId.get(id)?.name ?? id) })) ?? null

  const set = new Set(players.filter((p) => p.slot === 'S').map((p) => p.id))
  const injuries = players
    .filter((p) => p.injury)
    .map((p) => ({
      name: p.name,
      position: p.position,
      status: p.injury!.status,
      kind: p.injury!.kind,
      points: p.points,
      starting: set.has(p.id),
    }))
    .sort((a, b) => Number(b.starting) - Number(a.starting) || (b.points ?? 0) - (a.points ?? 0))

  const total = best.points
  const byPos = new Map<string, number>()
  for (const p of starters) {
    const key = (p.position ?? '?').toUpperCase()
    byPos.set(key, (byPos.get(key) ?? 0) + (p.points ?? 0))
  }
  const topPos = [...byPos.entries()].sort((a, b) => b[1] - a[1])[0]
  const topPlayer = [...starters].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0]
  const stack = topStack(lineupIds, (id) => byId.get(id)?.team ?? null)

  const concentration = {
    topPosition: topPos && total > 0 ? { position: topPos[0], share: topPos[1] / total } : null,
    topPlayer: topPlayer && total > 0 && topPlayer.points != null ? { name: topPlayer.name, share: topPlayer.points / total } : null,
    stack: stack ? { team: stack.team, players: stack.players.map((id) => byId.get(id)?.name ?? id) } : null,
  }

  const flags: string[] = []
  const startingOut = injuries.filter((i) => i.starting && i.kind === 'out')
  if (startingOut.length > 0) flags.push(`${startingOut.length} starter${startingOut.length === 1 ? ' is' : 's are'} ruled out and still in your lineup.`)
  if (depth && depth.length > 0) flags.push(`No healthy backup at ${depth.map((d) => d.position).join(', ')}.`)
  const heavyBye = byes.filter((b) => b.players.length >= 2)
  if (heavyBye.length > 0) flags.push(`${heavyBye.map((b) => `Week ${b.week}`).join(', ')}: two or more starters on bye.`)
  if (older.length >= 2) flags.push(`${older.length} starters are at an age where production usually falls.`)
  if (concentration.topPlayer && concentration.topPlayer.share >= 0.2) {
    flags.push(`${concentration.topPlayer.name} is ${Math.round(concentration.topPlayer.share * 100)}% of your projected lineup.`)
  }
  if (stack && stack.players.length >= 3) flags.push(`${stack.players.length} starters play for ${stack.team}.`)

  return {
    basisWeek: model.basisWeek,
    starters: starters.length,
    age: { averageAge, knownAges: aged.length, older },
    depth,
    injuries,
    injuryFeedNote,
    byes,
    concentration,
    flags,
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
