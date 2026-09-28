import 'server-only'

import type { League, LeagueSport } from '@prisma/client'

import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { expandStarterSlots } from '@/lib/league/lineup-expand-template'
import { validateCanonicalRosterPayload } from '@/lib/roster-lineup-engine/rosterValidationService'
import { resolveFullLineupLockContext } from '@/lib/roster-lineup-engine/lineupLockService'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import type { LineupValidationContext } from '@/lib/roster-lineup-engine/types'
import { isRosterChopped } from '@/lib/guillotine/guillotineGuard'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { isSportsDataEnabled } from '@/lib/sports-evidence/gates'
import { CertifiedLineupIntegrationService, extractPlayerRefs } from '@/lib/sports-evidence/lineupIntegration'
import type { RosterTemplateDto } from '@/lib/multi-sport/RosterTemplateService'
import { signChimmyActionToken } from './actionToken'
import { checkStartedGames } from './gameLocks'
import { planLineupMoves, type LineupPlan, type PlanSlot } from './lineupPlan'
import {
  describeRosterPlayers,
  displayName,
  lineupFingerprint,
  loadActionScope,
  loadOwnRoster,
  type RosterPlayerInfo,
} from './nativeActionScope'
import { resolveNamesOnRoster } from './nameMatch'
import type { ChimmyActionCard, ChimmyActionTokenPayload, LineupMoveSpec } from './types'

/**
 * "Set my lineup" for a native league — PROPOSE builds a confirm card; EXECUTE (only from the
 * confirm route, only after the user's tap) re-validates from scratch and saves through the SAME
 * engine the Roster tab saves through.
 *
 * What is checked, both times:
 *   - membership and a NATIVE league (`loadActionScope`);
 *   - the asker's own roster, found the way `/api/leagues/roster/save` finds it;
 *   - guillotine elimination, and the global lineup lock (weekly/daily policy, commissioner lock,
 *     specialty phase, lifecycle) via `resolveFullLineupLockContext`;
 *   - that no MOVED player's game has started (`checkStartedGames` — the engine stores per-player
 *     kickoff locks but does not enforce them, see gameLocks.ts);
 *   - slot eligibility (`planLineupMoves`) and the league's full roster validator;
 *   - at execute only: the lineup has not changed since the card was built (fingerprint), the
 *     certified sports-data gate exactly as the save route runs it, then the engine's own lock check.
 */

const INJURY_FLAG = /^(out|o|ir|injured reserve|doubtful|d|questionable|q|pup|suspended|sus|nfi|dnr)$/i

type Outcome = { ok: true; text: string; card: ChimmyActionCard } | { ok: false; text: string }

function toSlots(template: RosterTemplateDto): PlanSlot[] {
  return expandStarterSlots(template).map((s) => ({ index: s.index, label: s.label, allowedPositions: s.allowedPositions }))
}

async function loadTemplate(league: League): Promise<RosterTemplateDto | null> {
  const sport = String(league.sport ?? 'NFL')
  const formatType = getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined)
  return getRosterTemplateForLeague(sport as LeagueSport, formatType, league.id).catch(() => null)
}

function validationContext(league: League, template: RosterTemplateDto, season: number, week: number): LineupValidationContext {
  return {
    league: {
      id: league.id,
      sport: league.sport,
      leagueVariant: league.leagueVariant,
      settings: league.settings,
      lifecycleState: league.lifecycleState,
      lockAllMoves: league.lockAllMoves,
      irAllowOut: league.irAllowOut,
      irAllowCovid: league.irAllowCovid,
      irAllowSuspended: league.irAllowSuspended,
      irAllowNA: league.irAllowNA,
      irAllowDNR: league.irAllowDNR,
      irAllowDoubtful: league.irAllowDoubtful,
      taxiSlots: league.taxiSlots,
      taxiAllowNonRookies: league.taxiAllowNonRookies,
      taxiYearsLimit: league.taxiYearsLimit,
      guillotineMode: league.guillotineMode,
      bestBallMode: league.bestBallMode,
    },
    template,
    season,
    week,
  }
}

type Checked =
  | {
      ok: true
      plan: Extract<LineupPlan, { ok: true }>
      info: Map<string, RosterPlayerInfo>
      unverified: string[]
      rosterId: string
    }
  | { ok: false; text: string }

/**
 * Everything both halves check, given moves already resolved to ids. Returns the plan only when
 * the move is legal RIGHT NOW.
 */
async function checkMoves(args: {
  league: League
  userId: string
  rosterId: string
  playerData: unknown
  season: number
  week: number
  moves: LineupMoveSpec[]
  info: Map<string, RosterPlayerInfo>
  now: Date
}): Promise<Checked> {
  const { league } = args
  if (await isRosterChopped(league.id, args.rosterId).catch(() => false)) {
    return { ok: false, text: 'This team has been eliminated and cannot make lineup changes.' }
  }
  const template = await loadTemplate(league)
  if (!template) return { ok: false, text: "This league's starting slots could not be loaded, so no lineup change can be prepared." }

  const plan = planLineupMoves({
    playerData: args.playerData,
    rosterPlayerIds: getRosterPlayerIds(args.playerData),
    slots: toSlots(template),
    players: new Map(
      [...args.info.values()].map((p) => [p.playerId, { playerId: p.playerId, name: displayName(p), position: p.position }]),
    ),
    moves: args.moves,
    nowIso: args.now.toISOString(),
  })
  if (!plan.ok) return { ok: false, text: plan.reason }

  const lock = await resolveFullLineupLockContext({
    leagueId: league.id,
    rosterId: args.rosterId,
    sport: String(league.sport ?? 'NFL'),
    leagueVariant: league.leagueVariant,
    settings: league.settings,
    leagueWeek: args.week,
    editingWeek: args.week,
    season: args.season,
    playerData: args.playerData,
    lockAllMoves: league.lockAllMoves,
    lifecycleState: league.lifecycleState,
    now: args.now,
  })
  if (lock.locked) return { ok: false, text: `Lineups are locked right now: ${lock.reason ?? 'the league lock is on'}.` }

  const moved = [...plan.moveIn.map((m) => m.playerId), ...plan.moveOut]
  const games = await checkStartedGames({
    sport: String(league.sport ?? 'NFL'),
    season: args.season,
    week: args.week,
    players: moved.map((id) => {
      const p = args.info.get(id)
      return { playerId: id, name: displayName(p ?? { playerId: id, name: null }), team: p?.team ?? null, gameTime: p?.gameTime ?? null }
    }),
    now: args.now,
  })
  if (games.started.size > 0) {
    return {
      ok: false,
      text: `${[...games.started.values()].join('; ')} — a player whose game has started can't be moved in or out of the lineup.`,
    }
  }

  const validation = validateCanonicalRosterPayload(plan.nextPlayerData, validationContext(league, template, args.season, args.week))
  if (!validation.ok) {
    return { ok: false, text: `That lineup isn't legal in this league: ${validation.issues.map((i) => i.message).join(' ')}` }
  }
  return { ok: true, plan, info: args.info, unverified: games.unverified, rosterId: args.rosterId }
}

function namesList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return list.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((s) => s.trim().slice(0, 80)).slice(0, 8)
}

export async function proposeLineupChange(args: {
  leagueId: string
  userId: string
  start: unknown
  bench: unknown
  now?: Date
}): Promise<Outcome> {
  const now = args.now ?? new Date()
  const start = namesList(args.start)
  const bench = namesList(args.bench)
  if (start.length === 0 && bench.length === 0) {
    return { ok: false, text: 'Name who to START and/or who to BENCH (full player names). Call optimize_my_lineup first if they asked for the best lineup.' }
  }

  const scope = await loadActionScope(args.leagueId, args.userId, 'lineup')
  if (!scope.ok) return { ok: false, text: scope.message }
  const { league, week, season } = scope

  const roster = await loadOwnRoster(league.id, args.userId)
  if (!roster) return { ok: false, text: "The user doesn't have a team in this league, so there is no lineup to set." }

  const info = await describeRosterPlayers(String(league.sport), roster.playerData)
  const resolved = resolveNamesOnRoster([...start, ...bench], info)
  if (!resolved.ok) return { ok: false, text: resolved.message }
  const moves: LineupMoveSpec[] = [
    ...start.map((n) => ({ playerId: resolved.ids.get(n)!, to: 'starters' as const })),
    ...bench.map((n) => ({ playerId: resolved.ids.get(n)!, to: 'bench' as const })),
  ]

  const checked = await checkMoves({ league, userId: args.userId, rosterId: roster.id, playerData: roster.playerData, season, week, moves, info, now })
  if (!checked.ok) {
    return { ok: false, text: `NO CARD WAS MADE. ${checked.text} Tell the user this plainly; nothing was changed.` }
  }

  const { plan } = checked
  const effective: LineupMoveSpec[] = [
    ...plan.moveIn.map((m) => ({ playerId: m.playerId, to: 'starters' as const })),
    ...plan.moveOut.map((id) => ({ playerId: id, to: 'bench' as const })),
  ]
  const signed = signChimmyActionToken({
    userId: args.userId,
    leagueId: league.id,
    spec: { kind: 'lineup', rosterId: roster.id, week, season, moves: effective, baseFingerprint: lineupFingerprint(roster.playerData) },
    now,
  })
  if (!signed) return { ok: false, text: 'Chimmy cannot prepare a confirm card right now (signing is not configured). Say so; nothing was changed.' }

  const player = (id: string) => {
    const p = info.get(id)
    return { name: displayName(p ?? { playerId: id, name: null }), position: p?.position ?? null, team: p?.team ?? null }
  }
  const warnings: string[] = []
  for (const m of plan.moveIn) {
    const status = info.get(m.playerId)?.status
    if (status && INJURY_FLAG.test(status.trim())) warnings.push(`${player(m.playerId).name} is listed ${status}.`)
  }
  if (plan.emptySlots > 0) warnings.push(`This leaves ${plan.emptySlots} starting slot${plan.emptySlots === 1 ? '' : 's'} empty.`)
  for (const id of checked.unverified) warnings.push(`Couldn't confirm ${player(id).name}'s kickoff time — make sure his game hasn't started.`)

  const card: ChimmyActionCard = {
    actionId: signed.payload.actionId,
    kind: 'lineup',
    token: signed.token,
    title: `Lineup change — Week ${week}`,
    league: { id: league.id, name: league.name ?? null, sport: String(league.sport) },
    week,
    season,
    expiresAt: new Date(signed.payload.exp * 1000).toISOString(),
    lineup: {
      moveIn: plan.moveIn.map((m) => ({ ...player(m.playerId), slot: m.slot })),
      moveOut: plan.moveOut.map(player),
    },
    warnings,
  }

  const text = [
    `CONFIRMATION CARD READY — NOTHING HAS CHANGED YET. Week ${week} lineup change in "${league.name ?? 'this league'}":`,
    plan.moveIn.length ? `START ${plan.moveIn.map((m) => `${player(m.playerId).name}${m.slot ? ` (into ${m.slot})` : ''}`).join(', ')}.` : null,
    plan.moveOut.length ? `BENCH ${plan.moveOut.map((id) => player(id).name).join(', ')}.` : null,
    warnings.length ? `Warnings on the card: ${warnings.join(' ')}` : null,
    'A card with a Confirm button appears under your answer. The change happens ONLY if the user taps Confirm, and the card expires in 10 minutes.',
    'Say what the card will do and that it needs their tap. Never say the lineup was set or saved.',
  ]
    .filter(Boolean)
    .join(' ')
  return { ok: true, text, card }
}

export type ExecuteResult = { ok: true; message: string; before: string[]; after: string[]; rosterId: string } | { ok: false; message: string }

/** Runs ONLY from the confirm route, after the token verified and the action id was claimed. */
export async function executeLineupAction(payload: ChimmyActionTokenPayload, userId: string, now: Date = new Date()): Promise<ExecuteResult> {
  const spec = payload.spec
  if (spec.kind !== 'lineup') return { ok: false, message: 'Not a lineup action.' }

  const scope = await loadActionScope(payload.leagueId, userId, 'lineup')
  if (!scope.ok) return { ok: false, message: scope.message }
  const { league } = scope

  const roster = await loadOwnRoster(league.id, userId)
  if (!roster || roster.id !== spec.rosterId) return { ok: false, message: "That lineup card isn't for your team in this league." }
  if (lineupFingerprint(roster.playerData) !== spec.baseFingerprint) {
    return { ok: false, message: 'Your lineup changed after Chimmy made this card, so nothing was applied. Ask Chimmy again for a fresh one.' }
  }
  if (scope.week !== spec.week) {
    return { ok: false, message: `The league has moved on from week ${spec.week}, so nothing was applied. Ask Chimmy again.` }
  }

  const info = await describeRosterPlayers(String(league.sport), roster.playerData)
  const checked = await checkMoves({
    league,
    userId,
    rosterId: roster.id,
    playerData: roster.playerData,
    season: spec.season,
    week: spec.week,
    moves: spec.moves,
    info,
    now,
  })
  if (!checked.ok) return { ok: false, message: `Nothing was changed: ${checked.text}` }
  const { plan } = checked

  /* The save route's certified gate, verbatim in behaviour: NFL, flag-gated, reject-only, fail-open. */
  if (isSportsDataEnabled('lineup') && String(league.sport ?? 'NFL').toUpperCase() === 'NFL') {
    try {
      const guard = await new CertifiedLineupIntegrationService().evaluateLineupPersistSafety({
        season: String(spec.season),
        week: String(spec.week),
        starterRefs: extractPlayerRefs(plan.afterStarterIds),
      })
      if (guard.block) return { ok: false, message: `Nothing was changed: lineup blocked by certified game evidence (${guard.reason}).` }
    } catch {
      /* fail-open, as the save route does: the engine's own lock check below stays authoritative */
    }
  }

  const persisted = await persistRosterLineupWithEngine({
    leagueId: league.id,
    rosterId: roster.id,
    actorUserId: userId,
    nextPlayerData: plan.nextPlayerData,
    season: spec.season,
    week: spec.week,
    source: 'user_save',
    skipLockCheck: false,
  })
  if (!persisted.ok) return { ok: false, message: `Nothing was changed: ${persisted.error}` }

  /* The save route's side effects, so every surface refreshes the same way. */
  void import('@/lib/trade-engine/caching')
    .then(({ handleInvalidationTrigger }) => handleInvalidationTrigger('roster_change', league.id))
    .catch(() => {})
  void import('@/lib/league-notifications/realtimeHint')
    .then(({ publishLeagueRealtimeHint }) =>
      publishLeagueRealtimeHint(league.id, 'lineup_updated', 'Roster or lineup updated', { rosterId: roster.id, week: spec.week }),
    )
    .catch(() => {})

  const name = (id: string) => displayName(info.get(id) ?? { playerId: id, name: null })
  const parts = [
    plan.moveIn.length ? `started ${plan.moveIn.map((m) => name(m.playerId)).join(', ')}` : null,
    plan.moveOut.length ? `benched ${plan.moveOut.map(name).join(', ')}` : null,
  ].filter(Boolean)
  return {
    ok: true,
    message: `Done — ${parts.join(' and ')} for week ${spec.week}.`,
    before: plan.beforeStarterIds,
    after: plan.afterStarterIds,
    rosterId: roster.id,
  }
}
