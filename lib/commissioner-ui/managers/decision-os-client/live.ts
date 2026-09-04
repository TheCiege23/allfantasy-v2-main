import { prisma } from '@/lib/prisma'
import { callDecisionOS } from '../../adapter/transport'
import { isLiveReady } from '../../liveReadiness'
import { resolveActiveLeagueId } from '../../resolveActiveLeagueId'
import type { CommissionerErrorContract } from '../../contracts'
import type { ManagerDnaProfile, ManagerIntelligenceClient } from './types'

/**
 * Manager Intelligence — live, backed by Decision OS's Phase 6.2 Manager DNA classifier.
 *
 * ── What changed, and why the previous refusal was right ──────────────────────────────────────
 *
 * This method used to make its real calls and then discard the result, returning an honest
 * "backend does not expose this" error. That was correct at the time: `archetype`,
 * `engagementTrend` and `reliabilityScore` had no analog in the exposed Decision OS output, and the
 * one field that looked close (`participationTier`) is a FREQUENCY tier, not a behavioral
 * archetype — presenting it as one would have misrepresented what it measures.
 *
 * The DNA classifier that does answer `archetype` genuinely existed the whole time, but every
 * exposed route narrowed it to the CALLER'S OWN profile, which a directory cannot use. The gap was
 * therefore never the classifier; it was that nothing exposed it league-wide.
 * `/api/v1/intelligence/league/manager-dna` now does, gated on `intelligence:league:read` — a scope
 * `TIER_SCOPE_MAP` grants to the commissioner and platform tiers only.
 *
 * ── What is still not sourced, and is omitted rather than invented ────────────────────────────
 *
 * - `tenureSeasons` — still has no source. It is a roster-history fact, not a Decision OS concept.
 *   The field is now optional and is left absent.
 * - `engagementTrend` — now REAL, from per-manager behavioral snapshots, but only where a manager
 *   has at least two. Absent means unknown. ⚠ It is never back-filled from `engagementReliability`:
 *   that is a LEVEL and this is a DIRECTION, and a manager can be reliably absent.
 * - `reliabilityScore` — the backend classifies reliability as an ordinal level, so the real
 *   `engagementReliability` is passed through instead of a manufactured number.
 */
function notYetIntegrated(): CommissionerErrorContract {
  return {
    category: 'upstream_unavailable',
    message: 'The live Decision OS backend is not yet integrated in this environment.',
    moduleId: 'managers',
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

/** The pipeline ran but could not compute — distinct from "not integrated", and retryable. */
function directoryUnavailable(): CommissionerErrorContract {
  return {
    category: 'upstream_unavailable',
    message: 'Decision OS could not compute manager profiles for this league right now.',
    moduleId: 'managers',
    retryable: true,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Human-readable archetype for each `ManagerIdentityLabel`.
 *
 * Descriptive of behavior in a window, never a characterological judgment — the naming discipline
 * this module's contract carries. `ghost_manager` deliberately renders as "Quiet Participant"
 * (the demo client's own phrasing for a low-engagement manager) rather than anything resembling a
 * verdict on the person, and `unknown` says the profile is still building rather than asserting
 * an absence of character.
 */
const ARCHETYPE_LABEL: Record<string, string> = {
  ghost_manager: 'Quiet Participant',
  set_and_forget: 'Set and Forget',
  reactive_manager: 'Reactive Manager',
  indecisive_tinkerer: 'Frequent Tinkerer',
  serial_trader: 'Active Trader',
  waiver_hawk: 'Waiver Hawk',
  trade_seeker: 'Trade Seeker',
  committed_grinder: 'Steady Operator',
  unknown: 'Building Profile',
}

interface DirectoryRowShape {
  managerId: string
  primaryIdentity: string
  engagementReliability: 'reliable' | 'inconsistent' | 'unreliable'
  engagementTrend:
    | { available: false; reason: string }
    | { available: true; direction: 'rising' | 'steady' | 'declining' }
}
interface ManagerDnaDirectoryShape {
  data:
    | { available: false }
    | { available: true; rows: DirectoryRowShape[] }
}

/** Batch-resolves manager display names — one query for all managers, not N+1. Same pattern as Mission Control's live.ts. */
async function resolveManagerDisplayNames(managerIds: string[]): Promise<Map<string, string>> {
  if (managerIds.length === 0) return new Map()
  const users = await prisma.appUser.findMany({
    where: { id: { in: managerIds } },
    select: { id: true, displayName: true, username: true },
  })
  const map = new Map<string, string>()
  for (const u of users) map.set(u.id, u.displayName ?? u.username)
  return map
}

/**
 * League-continuity risk framing only, never a characterological judgment — the contract's own
 * wording. Fires on a real continuity signal (unreliable engagement, or a declining trend), and
 * says what a commissioner might DO about it rather than what the manager is.
 */
function riskFlagFor(row: DirectoryRowShape): string | undefined {
  if (row.engagementReliability === 'unreliable') {
    return 'Major inactivity detected — may benefit from a personal check-in'
  }
  if (row.engagementTrend.available && row.engagementTrend.direction === 'declining') {
    return 'Engagement declining over recent periods — may benefit from a personal check-in'
  }
  return undefined
}

export const liveManagerIntelligenceClient: ManagerIntelligenceClient = {
  async getManagerDirectory() {
    if (!(await isLiveReady('managers'))) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    const timestamp = new Date().toISOString()
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp }
    }

    const { data, error } = await callDecisionOS<ManagerDnaDirectoryShape>(
      'managers',
      `/api/v1/intelligence/league/manager-dna?leagueId=${encodeURIComponent(leagueId)}`,
    )
    if (error || !data) {
      return { data: null, error: error ?? notYetIntegrated(), source: 'live', timestamp }
    }
    if (!data.data.available) {
      return { data: null, error: directoryUnavailable(), source: 'live', timestamp }
    }

    const rows = data.data.rows
    const names = await resolveManagerDisplayNames(rows.map((r) => r.managerId))

    const profiles: ManagerDnaProfile[] = rows.map((row) => {
      const profile: ManagerDnaProfile = {
        id: row.managerId,
        // A manager with no AppUser row still belongs in their league's directory; omitting the row
        // would under-report the league rather than under-report one name.
        managerName: names.get(row.managerId) ?? 'Unknown manager',
        archetype: ARCHETYPE_LABEL[row.primaryIdentity] ?? 'Building Profile',
        engagementReliability: row.engagementReliability,
      }
      // Set only when real. An absent trend is unknown, and the view renders nothing for it.
      if (row.engagementTrend.available) {
        profile.engagementTrend = row.engagementTrend.direction
      }
      const riskFlag = riskFlagFor(row)
      if (riskFlag) profile.riskFlag = riskFlag
      return profile
    })

    return { data: profiles, error: null, source: 'live', timestamp }
  },
}
