/**
 * User Player Exposure Service — Phase 9. Genuinely new capability: no prior
 * cross-league, per-user player exposure aggregation existed in this repo
 * (confirmed during the audit). Computes, for each canonical player a user
 * owns across ALL their connected leagues: how many leagues/rosters they're
 * on, how many are starting/bench/IR-taxi, and what percentage of the user's
 * connected leagues include that player.
 *
 * PRIVATE, per-user data — never conflated with the Fantasy Knowledge Graph's
 * anonymized, privacy-gated, cross-USER PlayerExposure aggregate (Phase 3,
 * lib/shared-services/knowledge-graph/PlayerExposureEngine.ts). That aggregate
 * answers "how exposed is the WHOLE PLATFORM to this player" behind a 20-league
 * cohort privacy gate; this service answers "how exposed is THIS ONE USER to
 * this player," which is the user's own data and needs no privacy gate — see
 * README for the full distinction, per the Phase 9 brief's explicit
 * instruction not to apply the Phase 3 cohort gate here.
 *
 * Reuses the same real, provider-neutral roster-reading primitives Waiver OS
 * (Phase 7) already established: getNormalizedLineupSections() for real
 * starters/bench/ir/taxi/devy sections, never a new roster-parsing path.
 */

import { prisma } from '@/lib/prisma'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import type { ExposureSlotKind, UserPlayerExposure } from './types'

const SECTION_TO_SLOT_KIND: Record<string, ExposureSlotKind> = {
  starters: 'starter',
  bench: 'bench',
  ir: 'ir',
  taxi: 'ir',
  devy: 'ir',
}

type ExposureRow = { id: string; name: string | null; position: string | null }
type ExposureSections = Record<'starters' | 'bench' | 'ir' | 'taxi' | 'devy', ExposureRow[]>

/** Same real, provider-native ID-array reader Phase 13's flatSectionsFromPlayerData() (lib/shared-services/waiver/WaiverContextAssembler.ts) already established. */
function toIdArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const id = typeof item === 'string' ? item.trim() : String((item as { id?: unknown } | null)?.id ?? '')
    if (id) out.push(id)
  }
  return out
}

/**
 * Fallback for rosters that were imported but never ran the `lineup_sections`
 * normalization step -- rediscovered here via real .env.test execution this
 * phase (Phase 33): 2 of the 3 real Sleeper-imported leagues' rosters carry
 * only the flat, platform-native players/starters/taxi/reserve ID-array
 * fields, never `lineup_sections`. getNormalizedLineupSections() alone
 * silently produced an empty roster for that real, common shape --
 * undercounting real cross-league exposure (measured: 1 real player instead
 * of the true count). This is the exact same real gap Phase 13 found and
 * fixed in lib/shared-services/waiver/WaiverContextAssembler.ts's
 * flatSectionsFromPlayerData() -- reused here, not reinvented. Player name/
 * position are honestly left null for flat-fallback rows (no local pool
 * lookup in this service's existing scope) -- never fabricated.
 */
function flatSectionsFromPlayerData(playerData: unknown): Record<'starters' | 'bench' | 'ir' | 'taxi', string[]> | null {
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

function resolveExposureSections(playerData: unknown): ExposureSections {
  const normalized = getNormalizedLineupSections(playerData)
  const toRow = (row: Record<string, unknown>): ExposureRow => ({
    id: String(row.id ?? ''),
    name: typeof row.name === 'string' ? row.name : null,
    position: typeof row.position === 'string' ? row.position : null,
  })
  const hasNormalizedData = (['starters', 'bench', 'ir', 'taxi', 'devy'] as const).some((key) => normalized[key].length > 0)
  if (hasNormalizedData) {
    return {
      starters: normalized.starters.map(toRow).filter((r) => r.id),
      bench: normalized.bench.map(toRow).filter((r) => r.id),
      ir: normalized.ir.map(toRow).filter((r) => r.id),
      taxi: normalized.taxi.map(toRow).filter((r) => r.id),
      devy: normalized.devy.map(toRow).filter((r) => r.id),
    }
  }

  const flat = flatSectionsFromPlayerData(playerData)
  if (!flat) return { starters: [], bench: [], ir: [], taxi: [], devy: [] }
  const idToRow = (id: string): ExposureRow => ({ id, name: null, position: null })
  return {
    starters: flat.starters.map(idToRow),
    bench: flat.bench.map(idToRow),
    ir: flat.ir.map(idToRow),
    taxi: flat.taxi.map(idToRow),
    devy: [],
  }
}

/**
 * Same real, verified pattern as lib/decision-os/waiver/loader.ts's loadLinkedPlatformUserIds.
 * Exported (Cross-League Player Intelligence phase) so `crossLeaguePlayerPortfolio.ts` can reuse the
 * exact same real user-to-platform-id linkage instead of re-deriving it a second time.
 */
export async function resolveLinkedPlatformUserIds(userId: string): Promise<string[]> {
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { sleeperUserId: true } })
  return Array.from(new Set([userId, profile?.sleeperUserId].map((v) => String(v ?? '').trim()).filter(Boolean)))
}

export interface ComputeUserPlayerExposureInput {
  userId: string
}

export interface ComputeUserPlayerExposureResult {
  exposures: UserPlayerExposure[]
  connectedLeagueCount: number
}

export async function computeUserPlayerExposure(input: ComputeUserPlayerExposureInput): Promise<ComputeUserPlayerExposureResult> {
  const platformUserIds = await resolveLinkedPlatformUserIds(input.userId)
  if (platformUserIds.length === 0) return { exposures: [], connectedLeagueCount: 0 }

  const rosters = await prisma.roster.findMany({
    where: { platformUserId: { in: platformUserIds } },
    select: { id: true, leagueId: true, playerData: true },
  })

  const connectedLeagueIds = new Set(rosters.map((r) => r.leagueId))
  const connectedLeagueCount = connectedLeagueIds.size
  if (connectedLeagueCount === 0) return { exposures: [], connectedLeagueCount: 0 }

  interface Accum {
    playerId: string
    playerName: string | null
    position: string | null
    leagueIds: Set<string>
    rosterCount: number
    startingCount: number
    benchCount: number
    irTaxiCount: number
    leaguesRequiringAttention: Set<string>
  }
  const byPlayer = new Map<string, Accum>()

  for (const roster of rosters) {
    const sections = resolveExposureSections(roster.playerData)
    for (const [sectionKey, slotKind] of Object.entries(SECTION_TO_SLOT_KIND) as Array<[string, ExposureSlotKind]>) {
      const rows = sections[sectionKey as keyof typeof sections] ?? []
      for (const row of rows) {
        const playerId = row.id
        if (!playerId) continue
        const existing = byPlayer.get(playerId) ?? {
          playerId,
          playerName: row.name,
          position: row.position,
          leagueIds: new Set<string>(),
          rosterCount: 0,
          startingCount: 0,
          benchCount: 0,
          irTaxiCount: 0,
          leaguesRequiringAttention: new Set<string>(),
        }
        // A flat-fallback roster (encountered first) leaves name/position null;
        // if a later roster resolves the same player via real lineup_sections
        // data, upgrade the identity rather than keep the earlier null.
        if (existing.playerName == null && row.name != null) existing.playerName = row.name
        if (existing.position == null && row.position != null) existing.position = row.position
        existing.leagueIds.add(roster.leagueId)
        existing.rosterCount += 1
        if (slotKind === 'starter') existing.startingCount += 1
        else if (slotKind === 'bench') existing.benchCount += 1
        else existing.irTaxiCount += 1
        byPlayer.set(playerId, existing)
      }
    }
  }

  const exposures: UserPlayerExposure[] = Array.from(byPlayer.values()).map((acc) => ({
    playerId: acc.playerId,
    playerName: acc.playerName,
    position: acc.position,
    leagueCount: acc.leagueIds.size,
    rosterCount: acc.rosterCount,
    startingCount: acc.startingCount,
    benchCount: acc.benchCount,
    irTaxiCount: acc.irTaxiCount,
    exposurePercent: connectedLeagueCount > 0 ? acc.leagueIds.size / connectedLeagueCount : 0,
    leaguesRequiringAttention: Array.from(acc.leaguesRequiringAttention),
    injuryStatus: null,
    gameWindow: null,
  }))

  return { exposures, connectedLeagueCount }
}
