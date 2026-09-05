import 'server-only'
/**
 * Fantasy OS Phase 5E-b — shared certified Lineup integration service (Part 1).
 *
 * ONE server-only service used by every wired Lineup path (lock-state, auto-sub, validate, today-actions).
 * It composes the certified player + games snapshots, team identity, player→game resolution, and the 5D-c
 * auto-switch safety contract. It supplies EVIDENCE only — it does NOT duplicate lock-policy logic; the
 * existing `lineupLockService` remains the final lock authority. Fails closed to `unavailable`; never
 * fabricates; never returns raw provider fields.
 */
import { SportsRuntimeStore } from '@/lib/sports-data-gateway/runtime/store'
import { getCertifiedSchedule } from '@/lib/sports-data-gateway/runtime/scheduleRuntime'
import { buildCertifiedFreshness } from '@/lib/sports-data-gateway/runtime/freshnessPure'
import { resolvePlayerGame } from '@/lib/sports-data-gateway/runtime/playerGameResolution'
import { assembleLiveLineupContext, evaluateAutoSwitchSafety, type LiveLineupSportsContext, type AutoSwitchSafetyResult } from '@/lib/sports-data-gateway/runtime/lineupSafety'
import { buildRuntimeContext, identityStatusFrom, unavailableRuntimeContext, type CertifiedSportsRuntimeContext } from './context'

export type PlayerRef = { canonicalPlayerId: string; providerSleeperId?: string | null }

/** Defensively extract player refs from a roster's playerData (unknown shape). Sleeper ids are numeric strings. */
export function extractPlayerRefs(playerData: unknown): PlayerRef[] {
  const out: PlayerRef[] = []
  const push = (id: unknown) => {
    const s = typeof id === 'string' ? id : typeof id === 'number' ? String(id) : ''
    if (s) out.push({ canonicalPlayerId: s, providerSleeperId: /^\d+$/.test(s) ? s : null })
  }
  const arr = Array.isArray(playerData)
    ? playerData
    : playerData && typeof playerData === 'object'
      ? ((playerData as Record<string, unknown>).players ?? (playerData as Record<string, unknown>).starters ?? [])
      : []
  for (const p of Array.isArray(arr) ? arr : []) {
    if (typeof p === 'string' || typeof p === 'number') push(p)
    else if (p && typeof p === 'object') push((p as Record<string, unknown>).playerId ?? (p as Record<string, unknown>).id ?? (p as Record<string, unknown>).sleeper_id ?? (p as Record<string, unknown>).sleeperId)
  }
  return out.slice(0, 60) // bound
}

type CertifiedPlayer = { canonicalPlayerId?: string; providerIds?: Record<string, string>; teamId?: string | null }

export type LineupScheduleEvidence = { contexts: LiveLineupSportsContext[]; runtimeContext: CertifiedSportsRuntimeContext; available: boolean }

/** Evidence values that mean a player's game is already locked/started/final/postponed/suspended. Shared classifier — NOT lock policy (the existing lineupLockService remains the lock authority). */
export const LOCKED_LINEUP_EVIDENCE = new Set(['at_or_after_start', 'final', 'postponed', 'suspended'])

/** Informational (never-blocking) certified schedule description for a set of players. Exposes only what the certified plane supports; injuries/projections/availability are explicitly unavailable (never fabricated). */
export type CertifiedScheduleDescription = {
  available: boolean
  freshnessStatus: string
  identityStatus: string
  snapshotVersion: string | null
  players: Array<{ canonicalPlayerId: string; kickoff: string | null; gameStatus: string; lockEvidence: string; locked: boolean }>
  /** Fields the certified schedule plane does not provide — surfaced explicitly rather than guessed. */
  unsupported: { injuries: 'unavailable'; projections: 'unavailable'; availability: 'unavailable' }
}

export class CertifiedLineupIntegrationService {
  constructor(private store = new SportsRuntimeStore()) {}

  /** Resolve certified game/lock evidence for a set of players (by canonical id or Sleeper provider id). */
  async getScheduleEvidenceForPlayers(input: { season: string; week: string | null; players: PlayerRef[]; now?: Date }): Promise<LineupScheduleEvidence> {
    const now = input.now ?? new Date()
    let games
    let gamesMeta
    let playerRecords: unknown[]
    try {
      games = await getCertifiedSchedule(this.store, input.season, input.week)
      gamesMeta = await this.store.getCertifiedSnapshotMeta('NFL', 'games', `${input.season}-w${input.week ?? 'x'}`)
      playerRecords = (await this.store.getCertifiedRecords('NFL', 'players')).records
    } catch {
      return { contexts: [], runtimeContext: unavailableRuntimeContext('certified snapshot read failed'), available: false }
    }
    if (!gamesMeta || games.length === 0) {
      return { contexts: [], runtimeContext: unavailableRuntimeContext('no certified games snapshot for this window'), available: false }
    }

    // Build sleeperId → team + canonical lookup from the certified players snapshot (no raw provider fields exposed).
    const bySleeper = new Map<string, { canonicalPlayerId: string; team: string | null }>()
    const byCanonical = new Map<string, { team: string | null }>()
    for (const raw of playerRecords) {
      const p = (raw ?? {}) as CertifiedPlayer
      const canonical = String(p.canonicalPlayerId ?? '')
      const team = (p.teamId as string | null) ?? null
      if (canonical) byCanonical.set(canonical, { team })
      const sid = p.providerIds?.sleeper
      if (sid) bySleeper.set(String(sid), { canonicalPlayerId: canonical, team })
    }

    const freshness = buildCertifiedFreshness(gamesMeta, now)
    let resolved = 0
    const contexts = input.players.map((ref) => {
      const lookup = (ref.providerSleeperId ? bySleeper.get(String(ref.providerSleeperId)) : undefined) ?? { canonicalPlayerId: ref.canonicalPlayerId, team: byCanonical.get(ref.canonicalPlayerId)?.team ?? null }
      const resolution = resolvePlayerGame({ canonicalPlayerId: lookup.canonicalPlayerId || ref.canonicalPlayerId, playerTeamReference: lookup.team, sport: 'NFL', at: now.toISOString(), games, scheduleComplete: false })
      if (resolution.status === 'resolved') resolved++
      return assembleLiveLineupContext({ canonicalPlayerId: lookup.canonicalPlayerId || ref.canonicalPlayerId, resolution, now, freshness })
    })

    return {
      contexts,
      runtimeContext: buildRuntimeContext({ dataContext: freshness, identityStatus: identityStatusFrom(resolved, input.players.length || 1), evidenceIds: gamesMeta.version ? [gamesMeta.version] : [] }),
      available: true,
    }
  }

  /**
   * Pre-persist certified safety for a manual lineup save (Part: persisting write path). Returns a SUPPLEMENTAL
   * rejection only when it has TRUSTWORTHY (current) certified evidence that a STARTED player's game is already
   * locked/started/final/postponed/suspended — a stricter catch the existing authority may miss. It NEVER
   * approves and NEVER weakens the existing decision. On stale/unavailable certified context it does NOT block a
   * human-confirmed manual save (the existing lineupLockService + roster legality remain final) — the limitation
   * is recorded in the emitted evidence. (Automatic/unattended actions fail closed instead — see auto-sub.)
   */
  async evaluateLineupPersistSafety(input: { season: string; week: string | null; starterRefs: PlayerRef[]; now?: Date }): Promise<{ block: boolean; reason: string; freshnessStatus: string; identityStatus: string; blockedPlayers: string[]; snapshotVersion: string | null }> {
    const ev = await this.getScheduleEvidenceForPlayers({ season: input.season, week: input.week, players: input.starterRefs, now: input.now })
    if (!ev.available) {
      return { block: false, reason: 'certified schedule unavailable — existing lock authority remains final', freshnessStatus: 'unavailable', identityStatus: ev.runtimeContext.identityStatus, blockedPlayers: [], snapshotVersion: null }
    }
    const trustworthy = ev.runtimeContext.freshnessStatus === 'current'
    const blocked = trustworthy ? ev.contexts.filter((c) => LOCKED_LINEUP_EVIDENCE.has(c.sportsDataLockEvidence)).map((c) => c.canonicalPlayerId) : []
    return {
      block: blocked.length > 0,
      reason: blocked.length > 0
        ? `certified evidence: ${blocked.length} started player(s) are in a locked/started/final/postponed game`
        : trustworthy ? 'no certified lock condition for started players' : `certified schedule ${ev.runtimeContext.freshnessStatus} — not used to block a manual save`,
      freshnessStatus: ev.runtimeContext.freshnessStatus,
      identityStatus: ev.runtimeContext.identityStatus,
      blockedPlayers: blocked,
      snapshotVersion: ev.runtimeContext.snapshotVersions[0] ?? null,
    }
  }

  /**
   * Informational certified schedule description (never blocks, never mutates) — used by read-only surfaces
   * (Start/Sit, Today Lineup Actions) to expose kickoff time, game status, lock evidence, freshness and identity.
   * Injuries/projections/availability are NOT provided by the certified schedule plane and are returned as
   * explicitly `unavailable` rather than fabricated. Fails to `available:false` on any read/identity failure.
   */
  async describeScheduleForPlayers(input: { season: string; week: string | null; players: PlayerRef[]; now?: Date }): Promise<CertifiedScheduleDescription> {
    const unsupported = { injuries: 'unavailable', projections: 'unavailable', availability: 'unavailable' } as const
    const ev = await this.getScheduleEvidenceForPlayers({ season: input.season, week: input.week, players: input.players, now: input.now })
    if (!ev.available) {
      return { available: false, freshnessStatus: ev.runtimeContext.freshnessStatus, identityStatus: ev.runtimeContext.identityStatus, snapshotVersion: null, players: [], unsupported }
    }
    return {
      available: true,
      freshnessStatus: ev.runtimeContext.freshnessStatus,
      identityStatus: ev.runtimeContext.identityStatus,
      snapshotVersion: ev.runtimeContext.snapshotVersions[0] ?? null,
      players: ev.contexts.map((c) => ({
        canonicalPlayerId: c.canonicalPlayerId,
        kickoff: c.scheduledStart ?? null,
        gameStatus: c.gameStatus,
        lockEvidence: c.sportsDataLockEvidence,
        locked: LOCKED_LINEUP_EVIDENCE.has(c.sportsDataLockEvidence),
      })),
      unsupported,
    }
  }

  /**
   * Auto-switch safety for an outgoing→replacement move. `authorized`/`rosterLegal` come from the EXISTING
   * authority (never bypassed here). Fails closed when either player's schedule evidence is uncertain.
   */
  async evaluateAutoSwitch(input: { season: string; week: string | null; authorized: boolean; rosterLegal: boolean; outgoing: PlayerRef; replacement: PlayerRef; scheduleFreshnessMaxMinutes?: number; now?: Date }): Promise<AutoSwitchSafetyResult> {
    const now = input.now ?? new Date()
    const ev = await this.getScheduleEvidenceForPlayers({ season: input.season, week: input.week, players: [input.outgoing, input.replacement], now })
    if (!ev.available) return { allowed: false, reason: 'schedule_unavailable', evidence: ['no certified schedule'] }
    const scheduleFresh = ev.runtimeContext.freshnessStatus === 'current'
    // Both players must be resolvable + before-start; use the replacement (incoming) as the switch gate.
    const [outCtx, repCtx] = ev.contexts
    // A locked outgoing player also blocks (cannot pull a locked player). Use the stricter of the two.
    const outResolution = { status: outCtx?.gameResolutionStatus ?? 'missing_schedule', gameStatus: outCtx?.gameStatus, scheduledStart: outCtx?.scheduledStart, evidence: [], canonicalTeamId: outCtx?.canonicalTeamId ?? '', canonicalGameId: outCtx?.canonicalGameId ?? '' } as never
    const repResolution = { status: repCtx?.gameResolutionStatus ?? 'missing_schedule', gameStatus: repCtx?.gameStatus, scheduledStart: repCtx?.scheduledStart, evidence: [], canonicalTeamId: repCtx?.canonicalTeamId ?? '', canonicalGameId: repCtx?.canonicalGameId ?? '' } as never
    const outSafety = evaluateAutoSwitchSafety({ authorized: input.authorized, rosterLegal: input.rosterLegal, resolution: outResolution, now, scheduleFresh })
    if (!outSafety.allowed) return outSafety
    return evaluateAutoSwitchSafety({ authorized: input.authorized, rosterLegal: input.rosterLegal, resolution: repResolution, now, scheduleFresh })
  }
}
