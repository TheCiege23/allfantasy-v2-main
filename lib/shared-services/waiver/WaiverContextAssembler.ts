/**
 * Waiver Context Assembler — Waiver OS foundation, Phase 7.
 *
 * Assembles a provider-neutral WaiverAIEngineInput (the real, canonical
 * recommender's own input shape) from real, already-persisted data:
 * Roster.playerData (via lib/roster/LineupTemplateValidation.ts's
 * getNormalizedLineupSections — the same real starters/bench/ir/taxi/devy
 * shape every provider's import bootstraps into, confirmed by reading
 * lib/waiver-wire/roster-utils.ts's own docs before writing this file), the
 * real league waiver settings resolver (getEffectiveLeagueWaiverSettings —
 * reused, not reinvented), and the real sport-scoped free-agent pool
 * (getPlayerPoolForLeague — the same function the live
 * app/api/waiver-wire/leagues/[leagueId]/players/route.ts uses).
 *
 * Unlike Trade OS's Phase 4 assembler, this module never calls
 * runImportedLeagueNormalizationPipeline (no live external re-fetch) — Roster
 * and League rows are already the canonical, provider-neutral model once a
 * league has been imported OR created natively. That means natively-created
 * leagues ARE assemblable here, unlike Trade OS's provider-only limitation.
 *
 * Player valuation reuses the canonical player-valuation gateway's batch resolver +
 * findPlayerByName, the same real valuation source
 * lib/league-trade-engine/tradeLearningCapture.ts already uses for live
 * capture — not a new value source invented for this phase. A player with no
 * FantasyCalc match gets the same conservative flat fallback value (200) that
 * file already documents and uses.
 *
 * Phase 14 update: raw provider player ids (e.g. real, un-normalized Sleeper
 * rosters — see the Phase 13 real-data validation) are now resolved via the
 * canonical, cross-domain `lib/shared-services/player-identity` resolver
 * instead of a local pool lookup. This is the ONLY consumer migrated onto it
 * this phase — see docs/os/FANTASY_OS_PLAYER_IDENTITY.md.
 */

import { prisma } from '@/lib/prisma'
import { parseSettingsSnapshot } from '@/lib/league-contract/types'
import { getEffectiveLeagueWaiverSettings } from '@/lib/waiver-wire/settings-service'
import { getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { fetchFantasyCalcValues, findPlayerByName, type FantasyCalcPlayer } from '@/lib/player-valuations/canonicalPlayerValuations'
import { expandRosterPositionTokens } from '@/lib/trade-engine/rosterPositionFormat'
import { computeTeamNeeds } from '@/lib/waiver-engine/team-needs'
import type { LeagueSport } from '@prisma/client'
import type { WaiverAIEngineInput, WaiverRosterPlayer, UserGoal } from './types'
import { resolvePlayers } from '@/lib/shared-services/player-identity'
import { IMPORT_PROVIDERS, type ImportProvider } from '@/lib/league-import/types'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedWaiverIntegrationService, type CertifiedScheduleDescription } from '@/lib/fantasy-os/sports-runtime/waiverIntegration'
import { extractPlayerRefs } from '@/lib/fantasy-os/sports-runtime/lineupIntegration'

/** Same conservative flat fallback used by tradeLearningCapture.ts's live capture — not a new invention. */
const UNMATCHED_PLAYER_FALLBACK_VALUE = 200

const SECTION_TO_SLOT: Record<RosterSectionKey, WaiverRosterPlayer['slot']> = {
  starters: 'starter',
  bench: 'bench',
  ir: 'ir',
  // Devy prospects have no dedicated WaiverRosterPlayer slot — 'taxi' ("stashed, not yet
  // contributing") is the closest honest analog. Documented approximation, not a silent guess.
  taxi: 'taxi',
  devy: 'taxi',
}

export interface BuildWaiverDecisionContextInput {
  leagueId: string
  rosterId: string
  currentWeek?: number
  goal?: UserGoal
  /** Max free agents to consider from the pool. Defaults to 300 (vs the live route's 800 — shadow evaluation runs synchronously per-call, not paginated). */
  maxFreeAgents?: number
  /**
   * Phase 15: how many ranked suggestions the caller wants back. Defaults to
   * 10 — previously hardcoded regardless of what the caller asked for (a
   * real, disclosed Decision Context gap; see lib/decision-os/waiver/WaiverRequestContext.ts).
   */
  maxResults?: number
}

export interface WaiverDecisionContext {
  leagueId: string
  rosterId: string
  /** League.platform — 'native' or a real ImportProvider value. */
  platform: string
  sport: string
  /** Roster.platformUserId — used as the Knowledge Graph manager key, same convention as WaiverSignalHook.ts's callers. */
  managerKey: string | null
  assembledAt: string
  engineInput: WaiverAIEngineInput
  faabRemaining: number | null
  waiverPriority: number | null
  waiverType: string
  faabBudget: number | null
  /** From computeTeamNeeds (lib/waiver-engine/team-needs.ts), same derivation lib/waiver-ai-engine/suggest.ts uses internally — precomputed here and passed through engineInput.teamNeeds so suggest.ts's own fallback recompute is skipped, guaranteeing this and the scoring engine see identical needs/surplus. Empty when rosterPositions couldn't be resolved (League.starters missing/non-array) — a real, documented data gap, not a guess. */
  needs: string[]
  surplus: string[]
  dataCompleteness: {
    freeAgentPoolSize: number
    valuedFreeAgentCount: number
    rosterPlayerCount: number
    unmatchedValuationCount: number
  }
  /**
   * Phase 5E-e: OPTIONAL certified schedule context for this roster's players. Additive EVIDENCE only — it does
   * NOT feed `engineInput` and never changes the deterministic recommender's output. `null` unless the `waiver`
   * sports-data gate is enabled and certified snapshots resolve (schedule-only; injuries/projections/etc are
   * surfaced by the description as explicitly `unavailable`).
   */
  sportsContext: CertifiedScheduleDescription | null
}

/** Derives isSuperFlex from the league's own settings snapshot, same real, already-proven pattern tradeLearningCapture.ts uses (rosterSettings.starterSlots.QB >= 2). isTEP is not detected — same documented, bounded simplification as that file (affects scoring precision only, never accept/reject direction). */
function resolveLeagueScoringFlags(settingsJson: unknown, isDynasty: boolean): { isSF: boolean; isTEP: boolean; isDynasty: boolean } {
  try {
    const snap = parseSettingsSnapshot(settingsJson ?? null)
    const starterSlots = (snap?.rosterSettings?.starterSlots ?? {}) as Record<string, unknown>
    const qbSlots = Number(starterSlots.QB ?? starterSlots.qb ?? 1)
    return { isSF: Number.isFinite(qbSlots) && qbSlots >= 2, isTEP: false, isDynasty }
  } catch {
    return { isSF: false, isTEP: false, isDynasty }
  }
}

function valueForName(name: string, fcPlayers: FantasyCalcPlayer[]): { value: number; matched: boolean } {
  const fc = findPlayerByName(fcPlayers, name)
  return fc ? { value: fc.value, matched: true } : { value: UNMATCHED_PLAYER_FALLBACK_VALUE, matched: false }
}

/** Raw platform-native ID array, e.g. Sleeper's own Roster.players/starters/taxi/reserve shape. */
function toIdArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const id = typeof item === 'string' ? item.trim() : String((item as { id?: unknown; player_id?: unknown } | null)?.id ?? (item as { player_id?: unknown } | null)?.player_id ?? '')
    if (id) out.push(id)
  }
  return out
}

/**
 * Fallback for rosters that were imported but never ran the `lineup_sections` normalization
 * step (a real, pre-existing, already-documented state — see
 * lib/waiver-wire/roster-utils.ts's own comment: "Rosters with no `lineup_sections` block yet
 * are left alone (unrelated pre-draft/legacy state)"). Confirmed via Phase 13 real-data
 * validation: every real Sleeper-imported league in the validation environment carries only
 * the flat, platform-native `players`/`starters`/`taxi`/`reserve` ID-array fields, never
 * `lineup_sections` — getNormalizedLineupSections() alone silently produces an empty roster
 * for that (common, real) shape. Groups raw ids into slots only — name/position/team
 * resolution now happens via the canonical PlayerIdentityResolver (Phase 14), not a local
 * pool lookup (see `toWaiverRosterPlayers`'s flat branch below).
 */
function flatSectionsFromPlayerData(
  playerData: unknown
): Record<'starters' | 'bench' | 'ir' | 'taxi', string[]> | null {
  const data = playerData && typeof playerData === 'object' && !Array.isArray(playerData) ? (playerData as Record<string, unknown>) : {}
  const allPlayers = toIdArray(data.players)
  if (allPlayers.length === 0) return null

  const starters = toIdArray(data.starters)
  const taxi = toIdArray(data.taxi)
  const ir = toIdArray(data.reserve ?? data.ir)
  const claimed = new Set([...starters, ...taxi, ...ir])
  const bench = allPlayers.filter((id) => !claimed.has(id))
  return { starters, bench, ir, taxi }
}

/** True only for real ImportProvider values ('sleeper'|'espn'|'yahoo'|'fantrax'|'mfl'|'fleaflicker') — never 'manual'/'allfantasy'/'native'. */
function asImportProvider(platform: string): ImportProvider | null {
  return (IMPORT_PROVIDERS as readonly string[]).includes(platform) ? (platform as ImportProvider) : null
}

async function toWaiverRosterPlayers(
  playerData: unknown,
  fcPlayers: FantasyCalcPlayer[],
  matchStats: { unmatched: number },
  platform: string
): Promise<WaiverRosterPlayer[]> {
  const sections = getNormalizedLineupSections(playerData)
  const hasNormalizedData = (Object.keys(SECTION_TO_SLOT) as RosterSectionKey[]).some((key) => sections[key].length > 0)
  const players: WaiverRosterPlayer[] = []

  if (hasNormalizedData) {
    for (const key of Object.keys(SECTION_TO_SLOT) as RosterSectionKey[]) {
      for (const row of sections[key]) {
        const id = String(row.id ?? '')
        if (!id) continue
        const name = typeof row.name === 'string' && row.name ? row.name : `Player ${id}`
        const { value, matched } = valueForName(name, fcPlayers)
        if (!matched) matchStats.unmatched += 1
        players.push({
          id,
          name,
          position: String(row.position ?? 'UNKNOWN'),
          team: typeof row.team === 'string' ? row.team : null,
          slot: SECTION_TO_SLOT[key],
          age: typeof row.age === 'number' ? row.age : null,
          value,
        })
      }
    }
    return players
  }

  const flat = flatSectionsFromPlayerData(playerData)
  if (!flat) return players

  const FLAT_SECTION_TO_SLOT: Record<keyof typeof flat, WaiverRosterPlayer['slot']> = {
    starters: 'starter',
    bench: 'bench',
    ir: 'ir',
    taxi: 'taxi',
  }

  // Phase 14: resolve raw provider player IDs via the canonical, shared
  // PlayerIdentityResolver (lib/shared-services/player-identity) instead of
  // the Phase 13 local free-agent-pool lookup — that pool is keyed by
  // SportsPlayer.id, which never intersects with a raw Sleeper numeric id,
  // so most rostered players fell back to "Player <id>"/UNKNOWN. The
  // resolver tries PlayerIdentityMap then SportsPlayer directly by provider
  // id, batched in one call per roster (never N+1 per player).
  const provider = asImportProvider(platform)
  const idToSlot = new Map<string, WaiverRosterPlayer['slot']>()
  for (const key of Object.keys(flat) as (keyof typeof flat)[]) {
    for (const id of flat[key]) idToSlot.set(id, FLAT_SECTION_TO_SLOT[key])
  }
  const ids = [...idToSlot.keys()]
  if (ids.length === 0) return players

  const resolutions = provider
    ? await resolvePlayers(ids.map((sourceId) => ({ provider, sourceId })))
    : ids.map((sourceId) => ({
        input: { provider: 'sleeper' as ImportProvider, sourceId },
        player: null,
        confidence: 'unresolved' as const,
        source: 'unresolved' as const,
        resolvedAt: new Date().toISOString(),
        diagnostics: { matchedField: null, candidateCount: 0, tiedCandidates: 0, reason: `Unsupported/unknown platform "${platform}" — cannot resolve via a provider adapter.` },
      }))

  for (const resolution of resolutions) {
    const id = resolution.input.sourceId as string
    const slot = idToSlot.get(id)
    if (!slot) continue
    const name = resolution.player?.canonicalName ?? `Player ${id}`
    const { value, matched } = valueForName(name, fcPlayers)
    if (!matched) matchStats.unmatched += 1
    players.push({
      id,
      name,
      position: resolution.player?.position ?? 'UNKNOWN',
      team: resolution.player?.team ?? null,
      slot,
      age: null,
      value,
    })
  }
  return players
}

export async function buildWaiverDecisionContext(input: BuildWaiverDecisionContextInput): Promise<WaiverDecisionContext> {
  const assembledAt = new Date().toISOString()
  const maxFreeAgents = input.maxFreeAgents ?? 300

  const [league, targetRoster, allRosters, waiverSettings] = await Promise.all([
    prisma.league.findUnique({
      where: { id: input.leagueId },
      select: { id: true, sport: true, platform: true, isDynasty: true, leagueSize: true, settings: true, starters: true, season: true },
    }),
    prisma.roster.findUnique({ where: { id: input.rosterId }, select: { playerData: true, faabRemaining: true, waiverPriority: true, platformUserId: true } }),
    prisma.roster.findMany({ where: { leagueId: input.leagueId }, select: { id: true, playerData: true } }),
    getEffectiveLeagueWaiverSettings(input.leagueId),
  ])

  if (!league) throw new Error(`League not found: ${input.leagueId}`)
  if (!targetRoster) throw new Error(`Roster not found: ${input.rosterId}`)

  const { isSF, isTEP, isDynasty } = resolveLeagueScoringFlags(league.settings, league.isDynasty)
  const numTeams = league.leagueSize ?? allRosters.length ?? 12

  const rosteredIds = new Set<string>()
  for (const roster of allRosters) {
    for (const id of getRosterPlayerIds(roster.playerData)) rosteredIds.add(id)
  }

  const pool = await getPlayerPoolForLeague(input.leagueId, league.sport as LeagueSport, { limit: maxFreeAgents })
  const availablePool = pool.filter((p) => !rosteredIds.has(p.player_id))

  const fcPlayers = await fetchFantasyCalcValues({
    isDynasty: true, // matches the existing hardcoded convention in tradeLearningCapture.ts/every hypothetical-evaluation tool
    numQbs: isSF ? 2 : 1,
    numTeams,
    ppr: 1,
  })

  const matchStats = { unmatched: 0 }
  const rosterPlayers = await toWaiverRosterPlayers(targetRoster.playerData, fcPlayers, matchStats, league.platform)
  const allLeagueRosters = await Promise.all(
    allRosters.map(async (roster) => ({
      players: await toWaiverRosterPlayers(roster.playerData, fcPlayers, matchStats, league.platform),
    }))
  )

  const availablePlayers: WaiverAIEngineInput['availablePlayers'] = availablePool.map((p) => {
    const { value, matched } = valueForName(p.full_name, fcPlayers)
    if (!matched) matchStats.unmatched += 1
    return {
      playerId: p.player_id,
      playerName: p.full_name,
      position: p.position,
      team: p.team_abbreviation ?? p.team ?? null,
      age: p.age ?? null,
      value,
      injuryStatus: p.injury_status ?? null,
    }
  })

  const rawStarters = Array.isArray(league.starters) ? (league.starters as unknown[]).map(String) : []
  const rosterPositions = rawStarters.length > 0 ? expandRosterPositionTokens(rawStarters) : []

  const currentWeek = input.currentWeek ?? 1
  const teamNeeds =
    rosterPositions.length > 0 && rosterPlayers.length > 0
      ? computeTeamNeeds(rosterPlayers, rosterPositions, allLeagueRosters, currentWeek)
      : null
  const needs = teamNeeds?.weakestSlots?.map((s) => s.position) ?? []
  const surplus = teamNeeds?.positionalDepth?.filter((d) => d.depthRating > 1.2).map((d) => d.position) ?? []

  const engineInput: WaiverAIEngineInput = {
    sport: league.sport,
    roster: rosterPlayers,
    rosterPositions: rosterPositions.length > 0 ? rosterPositions : undefined,
    allLeagueRosters,
    currentWeek,
    goal: input.goal ?? 'balanced',
    leagueSettings: { isSF, isTEP, numTeams, isDynasty },
    availablePlayers,
    teamNeeds,
    maxResults: input.maxResults ?? 10,
  }

  // Phase 5E-e: additive certified schedule context for the roster's players. Gated (off by default) and
  // wrapped so it never affects assembly; NEVER feeds engineInput (the deterministic recommender is unchanged).
  let sportsContext: CertifiedScheduleDescription | null = null
  if (isSportsDataEnabled('waiver') && String(league.sport ?? 'NFL').toUpperCase() === 'NFL') {
    try {
      const refs = extractPlayerRefs(rosterPlayers.map((p) => p.id))
      sportsContext = await new CertifiedWaiverIntegrationService().describeWaiverScheduleContext({
        season: String(league.season ?? new Date().getFullYear()),
        week: String(currentWeek),
        players: refs,
      })
    } catch {
      sportsContext = null
    }
  }

  return {
    leagueId: input.leagueId,
    rosterId: input.rosterId,
    platform: league.platform,
    sport: league.sport,
    managerKey: targetRoster.platformUserId ?? null,
    assembledAt,
    engineInput,
    faabRemaining: targetRoster.faabRemaining ?? null,
    waiverPriority: targetRoster.waiverPriority ?? null,
    waiverType: waiverSettings.normalizedWaiverType,
    faabBudget: waiverSettings.faabBudget,
    needs,
    surplus,
    dataCompleteness: {
      freeAgentPoolSize: availablePool.length,
      valuedFreeAgentCount: availablePlayers.length,
      rosterPlayerCount: rosterPlayers.length,
      unmatchedValuationCount: matchStats.unmatched,
    },
    sportsContext,
  }
}
