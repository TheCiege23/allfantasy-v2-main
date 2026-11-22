/**
 * Each format's EXISTING summary payload → `WhatsNextFacts`. No new routes: the banner reads exactly
 * what the format's own home already fetches, so the two cannot disagree about the phase.
 *
 *   big_brother  GET /api/leagues/[id]/big-brother/summary   (cycle.phase is BigBrotherWeekPhase)
 *   survivor     GET /api/leagues/[id]/survivor/summary      (phase derived: council, challenge, finale)
 *   zombie       GET /api/leagues/[id]/zombie/summary        (league.status + the viewer's role)
 *   guillotine   GET /api/leagues/[id]/guillotine/summary    (chop line + home.nextChopAt)
 *   pirate       GET /api/leagues/[id]/pirate                (protections lock + open claims)
 *   everything else: the league's own lifecycle, no fetch
 *
 * Every reader is defensive: a missing or reshaped field degrades to a quieter banner, never a throw.
 */
import { isZombieLeagueLike } from '@/lib/zombie/isZombieLeagueLike'
import { resolveSourceScreenLink } from '@/lib/league-links/sourceLinkResolver'
import { getImportProviderLabel } from '@/lib/league-import/provider-ui-config'
import type { ImportProvider } from '@/lib/league-import/types'
import { nativeLeaguePhase } from '@/lib/league/nativeLeagueNavigation'
import { type EngineFormat } from './formatPhaseGuides'
import type { WhatsNextFacts, WhatsNextFormatId } from './types'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const future = (iso: string | null, now: number) => (iso && Date.parse(iso) > now ? iso : null)

function joinNames(names: string[]): string | null {
  if (names.length === 0) return null
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

// ── Which guide a league uses ────────────────────────────────────────────────────────────────

export type WhatsNextLeagueLike = {
  leagueVariant?: string | null
  leagueType?: string | null
  format?: string | null
  guillotineMode?: boolean | null
  bestBallMode?: boolean | null
  isDynasty?: boolean | null
}

/** Specialty engines first (a Big Brother league is also "redraft" underneath), then lifecycle formats. */
export function whatsNextFormatFor(league: WhatsNextLeagueLike): WhatsNextFormatId {
  const keys = [league.leagueVariant, league.leagueType, league.format].map((v) => String(v ?? '').trim().toLowerCase())
  const has = (...values: string[]) => keys.some((k) => values.includes(k))
  if (has('big_brother', 'bigbrother')) return 'big_brother'
  if (has('survivor')) return 'survivor'
  if (isZombieLeagueLike(league)) return 'zombie'
  if (league.guillotineMode || has('guillotine', 'guilly')) return 'guillotine'
  if (has('pirate')) return 'pirate'
  if (has('tournament', 'tournament_mode')) return 'tournament'
  if (league.bestBallMode || has('best_ball', 'bestball')) return 'best_ball'
  if (has('c2c', 'merged_devy_c2c')) return 'c2c'
  if (has('devy', 'devy_dynasty')) return 'devy'
  if (has('salary_cap', 'salary')) return 'salary_cap'
  if (has('idp', 'dynasty_idp')) return 'idp'
  if (has('keeper')) return 'keeper'
  if (league.isDynasty || has('dynasty')) return 'dynasty'
  return 'redraft'
}

/** The summary route an engine format's banner reads. */
export function whatsNextEndpoint(leagueId: string, format: EngineFormat): string {
  const id = encodeURIComponent(leagueId)
  switch (format) {
    case 'big_brother':
      return `/api/leagues/${id}/big-brother/summary`
    case 'survivor':
      return `/api/leagues/${id}/survivor/summary`
    case 'zombie':
      return `/api/leagues/${id}/zombie/summary`
    case 'guillotine':
      return `/api/leagues/${id}/guillotine/summary`
    case 'pirate':
      return `/api/leagues/${id}/pirate`
  }
}

// ── Big Brother ──────────────────────────────────────────────────────────────────────────────

export function bigBrotherFacts(payload: unknown, now = Date.now()): WhatsNextFacts | null {
  const s = obj(payload)
  if (!s) return null
  const names = (obj(s.rosterDisplayNames) ?? {}) as Record<string, unknown>
  const name = (id: unknown) => (str(id) ? str(names[id as string]) ?? null : null)
  const myRosterId = str(s.myRosterId)
  const myStatus = str(s.myStatus)
  const cycle = obj(s.cycle)

  if (!cycle) return { format: 'big_brother', phase: 'PRE_SEASON' }

  const phase = str(cycle.phase) ?? 'HOH_OPEN'
  const week = num(cycle.week)
  const hohId = str(cycle.hohRosterId)
  const finalNominees = arr(s.finalNomineeRosterIds).map(str).filter((v): v is string => v != null)
  const nomineeIds = finalNominees.length ? finalNominees : [cycle.nominee1RosterId, cycle.nominee2RosterId].map(str).filter((v): v is string => v != null)
  const vetoPlayers = arr(cycle.vetoParticipantRosterIds).map(str).filter((v): v is string => v != null)
  const vetoHolder = str(cycle.vetoWinnerRosterId)
  const vetoSaved = str(cycle.vetoSavedRosterId)
  const finalists = arr(s.finalists).map((f) => str(obj(f)?.rosterId)).filter((v): v is string => v != null)
  const juryIds = arr(s.jury).map((j) => str(obj(j)?.rosterId)).filter((v): v is string => v != null)
  const ballot = obj(s.ballot)
  const home = obj(s.home)
  const next = obj(home?.nextDecision)

  const vars = {
    hoh: name(hohId),
    nominees: joinNames(nomineeIds.map((id) => name(id) ?? 'A houseguest')),
    vetoPlayers: joinNames(vetoPlayers.map((id) => name(id) ?? 'A houseguest')),
    vetoHolder: name(vetoHolder),
    vetoSaved: name(vetoSaved),
    evicted: name(cycle.evictedRosterId),
    finalists: joinNames(finalists.map((id) => name(id) ?? 'A houseguest')),
  }

  // A deadline the engine scheduled for THIS phase (home.nextDecision), else the vote deadline while voting.
  let deadlineIso = future(str(next?.at), now)
  let deadlineLabel = deadlineIso ? str(next?.label) : null
  if (!deadlineIso && phase === 'VOTING_OPEN') {
    deadlineIso = future(str(cycle.voteDeadlineAt) ?? str(ballot?.voteDeadlineAt), now)
    deadlineLabel = deadlineIso ? 'Voting closes' : null
  }

  // Finale: the summary names finalists once the house is down to the final 2 or 3.
  if (finalists.length > 0 && !cycle.evictedRosterId) {
    return {
      format: 'big_brother',
      phase: 'FINALE',
      week,
      vars,
      viewerIsActor: myRosterId != null && (juryIds.includes(myRosterId) || myStatus === 'JURY'),
      viewerIsInvolved: myRosterId != null && finalists.includes(myRosterId),
      deadlineIso,
      deadlineLabel,
    }
  }

  const mine = (id: string | null) => myRosterId != null && id === myRosterId
  let viewerIsActor = false
  let viewerIsInvolved = false
  let viewerDone = false
  switch (phase) {
    case 'HOH_LOCKED':
      viewerIsInvolved = mine(hohId)
      break
    case 'NOMINATION_OPEN':
    case 'REPLACEMENT_NOMINATION_OPEN':
      viewerIsActor = mine(hohId)
      break
    case 'VETO_DECISION_OPEN':
      viewerIsActor = mine(vetoHolder)
      viewerIsInvolved = myRosterId != null && nomineeIds.includes(myRosterId)
      break
    case 'VOTING_OPEN':
      // `canVote` stays true after voting, so a houseguest who voted is still the actor — and done.
      viewerIsActor = (ballot?.canVote === true || ballot?.hasVoted === true) && ballot?.closed !== true
      viewerDone = ballot?.hasVoted === true
      viewerIsInvolved = myRosterId != null && nomineeIds.includes(myRosterId)
      break
    case 'VETO_CHALLENGE_OPEN':
      viewerIsInvolved = myRosterId != null && vetoPlayers.includes(myRosterId)
      break
    case 'NOMINATION_LOCKED':
    case 'VETO_DRAW':
      viewerIsInvolved = myRosterId != null && nomineeIds.includes(myRosterId)
      break
  }

  return { format: 'big_brother', phase, week, vars, viewerIsActor, viewerIsInvolved, viewerDone, deadlineIso, deadlineLabel }
}

// ── Survivor ─────────────────────────────────────────────────────────────────────────────────

export function survivorFacts(payload: unknown, now = Date.now()): WhatsNextFacts | null {
  const s = obj(payload)
  if (!s) return null
  const names = (obj(s.rosterDisplayNames) ?? {}) as Record<string, unknown>
  const name = (id: unknown) => (str(id) ? str(names[id as string]) ?? null : null)
  const week = num(s.currentWeek)
  const myRosterId = str(s.myRosterId)
  const myTribeId = str(s.myTribeId)
  const merged = s.merged === true
  const tribes = arr(s.tribes).map(obj).filter((t): t is Obj => t != null)
  const tribeName = (id: unknown) => str(tribes.find((t) => t.id === id)?.name)
  const council = obj(s.council)
  const challenges = arr(s.challenges).map(obj).filter((c): c is Obj => c != null)
  const finale = obj(s.finale)
  const votedOut = new Set(arr(s.votedOutHistory).map((v) => str(obj(v)?.rosterId)).filter(Boolean) as string[])
  const stillIn = myRosterId != null && !votedOut.has(myRosterId)

  if (s.paused === true) return { format: 'survivor', phase: 'paused', week }

  if (finale && (finale.open === true || finale.closed === true)) {
    const finalists = arr(finale.finalists).map((f) => str(obj(f)?.rosterId)).filter((v): v is string => v != null)
    const winner = str(finale.winnerRosterId)
    const vars = {
      finalists: joinNames(finalists.map((id) => name(id) ?? 'A castaway')),
      winner: name(winner),
      juryVotes: num(finale.juryVotesRequired) != null ? `${num(finale.juryVotesSubmitted) ?? 0} of ${num(finale.juryVotesRequired)}` : null,
    }
    if (winner || finale.closed === true) return { format: 'survivor', phase: 'crowned', week, vars }
    const juryIds = arr(s.jury).map((j) => str(obj(j)?.rosterId)).filter((v): v is string => v != null)
    return {
      format: 'survivor',
      phase: 'finale_vote',
      week,
      vars,
      viewerIsActor: myRosterId != null && juryIds.includes(myRosterId),
      viewerDone: finale.myJuryVote != null,
      viewerIsInvolved: myRosterId != null && finalists.includes(myRosterId),
    }
  }

  const started = tribes.length > 0 || council != null || challenges.length > 0
  if (!started) return { format: 'survivor', phase: 'pre_season', week }

  if (council && num(council.week) === week && !str(council.closedAt)) {
    const attending = str(council.attendingTribeId)
    const going = merged || (myTribeId != null && attending === myTribeId)
    const deadlineIso = future(str(council.voteDeadlineAt), now)
    return {
      format: 'survivor',
      phase: council.phase === 'revote' ? 'revote' : 'tribal_open',
      week,
      vars: { tribe: merged ? 'Everyone' : tribeName(attending) },
      viewerIsActor: going && stillIn,
      viewerDone: s.myCouncilVoteSubmitted === true,
      deadlineIso,
      deadlineLabel: deadlineIso ? 'Votes close' : null,
    }
  }

  if (council && num(council.week) === week && str(council.closedAt) && council.revealComplete === false && arr(council.revealSequence).length > 0) {
    return { format: 'survivor', phase: 'reveal', week }
  }

  const open = challenges.find((c) => num(c.week) === week && c.resultJson == null && future(str(c.lockAt), now))
  if (open) {
    return { format: 'survivor', phase: 'challenge', week, deadlineIso: str(open.lockAt), deadlineLabel: 'Challenge locks' }
  }

  return { format: 'survivor', phase: 'in_week', week }
}

// ── Zombie ───────────────────────────────────────────────────────────────────────────────────

const ZOMBIE_ROLE_ADVICE: Record<string, string> = {
  Survivor: "You're still human. Win your matchup — lose to a zombie and you're infected.",
  Zombie: "You're a zombie. Beat a survivor this week to infect them.",
  Whisperer: "You're the Whisperer. Beat survivors to infect them, and time your ambushes.",
}

export function zombieFacts(payload: unknown): WhatsNextFacts | null {
  const s = obj(payload)
  if (!s) return null
  const league = obj(s.league)
  const status = str(league?.status) ?? 'setup'
  const week = num(s.week) ?? num(league?.currentWeek)
  if (status === 'setup') return { format: 'zombie', phase: 'setup', week }
  if (status === 'paused') return { format: 'zombie', phase: 'paused', week }
  const survivors = arr(s.survivors).length
  return {
    format: 'zombie',
    phase: 'in_season',
    week,
    vars: {
      survivorCount: survivors > 0 ? String(survivors) : null,
      roleAdvice: ZOMBIE_ROLE_ADVICE[str(s.myStatus) ?? ''] ?? null,
    },
  }
}

// ── Guillotine ───────────────────────────────────────────────────────────────────────────────

export function guillotineFacts(payload: unknown, now = Date.now()): WhatsNextFacts | null {
  const s = obj(payload)
  if (!s) return null
  const week = num(s.weekOrPeriod)
  const tiers = arr(s.dangerTiers).map(obj).filter((t): t is Obj => t != null)
  const standings = arr(s.survivalStandings)
  const home = obj(s.home)
  const config = obj(s.config)
  const startWeek = num(config?.eliminationStartWeek)
  const perChop = Math.max(1, num(config?.teamsPerChop) ?? 1)
  const alive = num(home?.aliveCount) ?? (standings.length || null)

  if (tiers.length === 0 && standings.length === 0) return { format: 'guillotine', phase: 'pre_season', week }
  if (alive != null && alive <= 1) return { format: 'guillotine', phase: 'complete', week }

  const deadlineIso = future(str(home?.nextChopAt), now)
  const deadlineLabel = deadlineIso ? str(home?.chopLabel) ?? 'Chop' : null
  if (startWeek != null && week != null && week < startWeek) {
    return { format: 'guillotine', phase: 'before_chops', week, vars: { chopStartWeek: String(startWeek) }, deadlineIso: null, deadlineLabel: null }
  }

  let chopAdvice: string | null = null
  const myRosterId = str(s.myRosterId)
  const mineIndex = myRosterId ? tiers.findIndex((t) => t.rosterId === myRosterId) : -1
  if (mineIndex >= 0) {
    const lineAt = num(tiers[Math.min(perChop, tiers.length) - 1]?.pointsFromChopZone) ?? 0
    const margin = (num(tiers[mineIndex].pointsFromChopZone) ?? 0) - lineAt
    chopAdvice =
      mineIndex < perChop
        ? "You're on the chop line right now. Check your lineup — the lowest score is chopped."
        : `You're ${(Math.round(margin * 10) / 10).toFixed(1)} pts clear of the chop line. Keep your lineup set.`
  }
  return {
    format: 'guillotine',
    phase: 'chop_week',
    week,
    vars: { teamsLeft: alive != null ? String(alive) : null, chopAdvice },
    deadlineIso,
    deadlineLabel,
  }
}

// ── Pirate ───────────────────────────────────────────────────────────────────────────────────

export function pirateFacts(payload: unknown, now = Date.now()): WhatsNextFacts | null {
  const s = obj(payload)
  if (!s) return null
  const week = num(s.week)
  const myRosterId = str(s.myRosterId)
  const rosters = arr(s.rosters).map(obj).filter((r): r is Obj => r != null)
  const name = (id: string | null) => {
    const r = rosters.find((row) => row.id === id)
    return str(r?.teamName) ?? str(r?.name) ?? str(r?.displayName) ?? null
  }
  const claims = arr(s.claims).map(obj).filter((c): c is Obj => c != null && c.status === 'awaiting_selection')
  const claim =
    claims.find((c) => c.winnerRosterId === myRosterId) ?? claims.find((c) => c.loserRosterId === myRosterId) ?? claims[0]
  if (claim) {
    const claimant = str(claim.winnerRosterId)
    const victim = str(claim.loserRosterId)
    const deadlineIso = future(str(claim.selectionDeadlineAt) ?? str(claim.deadlineAt), now)
    return {
      format: 'pirate',
      phase: 'claim_pending',
      week: num(claim.week) ?? week,
      vars: { claimant: name(claimant), victim: name(victim) },
      viewerIsActor: myRosterId != null && claimant === myRosterId,
      viewerIsInvolved: myRosterId != null && victim === myRosterId,
      deadlineIso,
      deadlineLabel: deadlineIso ? 'Choose by' : null,
    }
  }
  const lockAt = future(str(s.lockAt), now)
  if (s.canEditProtections === true) {
    return { format: 'pirate', phase: 'protections_open', week, deadlineIso: lockAt, deadlineLabel: lockAt ? 'Protections lock' : null }
  }
  return { format: 'pirate', phase: 'locked', week }
}

// ── Season lifecycle ─────────────────────────────────────────────────────────────────────────

export type LifecycleLeague = {
  id: string
  lifecycleState?: string | null
  status?: string | null
  currentWeek?: number | null
}

export function lifecycleFacts(format: WhatsNextFormatId, league: LifecycleLeague, draftDateIso: string | null, now = Date.now()): WhatsNextFacts {
  const bucket = nativeLeaguePhase(league as never)
  const week = typeof league.currentWeek === 'number' ? league.currentWeek : null
  const vars = { leagueId: league.id }
  if (bucket === 'Draft') return { format, phase: 'drafting', week, vars }
  if (bucket === 'Regular season') return { format, phase: 'in_season', week, vars }
  if (bucket === 'Playoffs') return { format, phase: 'playoffs', week, vars }
  if (bucket === 'Offseason') return { format, phase: 'offseason', week, vars }
  const draftAt = future(draftDateIso, now)
  if (draftAt) return { format, phase: 'draft_scheduled', week, vars, deadlineIso: draftAt, deadlineLabel: 'Draft starts' }
  return { format, phase: 'setup', week, vars }
}

// ── Imported leagues ─────────────────────────────────────────────────────────────────────────

export type ImportedLeagueLike = {
  platform: string
  /** The provider's league id — the one the league header's source link uses. */
  sourceLeagueId: string | null
  season?: number | string | null
  name?: string | null
  status?: string | null
}

/** The provider statuses that mean something; anything else (or nothing) is `unknown`. */
const IMPORTED_STATUS: Record<string, string> = {
  pre_draft: 'pre_draft',
  drafting: 'drafting',
  in_season: 'in_season',
  complete: 'complete',
}

const SHORT_PLATFORM: Record<string, string> = { mfl: 'MFL' }

/**
 * An imported league's phase, from the status its provider reported. Host links come from the
 * allowlisted source-link resolver (never built here): the lineup screen where its format is verified,
 * the league page otherwise. No week number — an imported season's week defaults to 1.
 */
export function importedFacts(league: ImportedLeagueLike, draftDateIso: string | null, now = Date.now()): WhatsNextFacts {
  const provider = league.platform.toLowerCase()
  const platform = SHORT_PLATFORM[provider] ?? getImportProviderLabel(provider as ImportProvider)
  const ctx = { platform: provider, sourceLeagueId: league.sourceLeagueId, season: league.season ?? null, leagueName: league.name ?? null }
  const hostLeagueUrl = resolveSourceScreenLink({ ...ctx, screen: 'league' })?.href ?? null
  const hostLineupUrl = resolveSourceScreenLink({ ...ctx, screen: 'lineup' })?.href ?? hostLeagueUrl
  const vars = { platform, hostLeagueUrl, hostLineupUrl }
  let phase = IMPORTED_STATUS[String(league.status ?? '').toLowerCase()] ?? 'unknown'
  const draftAt = future(draftDateIso, now)
  if (phase === 'pre_draft' && draftAt) phase = 'draft_scheduled'
  return {
    format: 'imported',
    phase,
    formatLabel: platform,
    vars,
    ...(phase === 'draft_scheduled' ? { deadlineIso: draftAt, deadlineLabel: 'Draft starts' } : {}),
  }
}

/** Engine payload → facts. Null when the payload is unusable, so the panel hides. */
export function engineFacts(format: EngineFormat, payload: unknown, now = Date.now()): WhatsNextFacts | null {
  switch (format) {
    case 'big_brother':
      return bigBrotherFacts(payload, now)
    case 'survivor':
      return survivorFacts(payload, now)
    case 'zombie':
      return zombieFacts(payload)
    case 'guillotine':
      return guillotineFacts(payload, now)
    case 'pirate':
      return pirateFacts(payload, now)
  }
}

