/**
 * Decision OS Core — DecisionOSContext (Phase 1).
 *
 * Generalizes what each existing `lib/decision-os/{lineup,waiver,trade,commissioner-health}/world.ts`
 * builds ad hoc into one documented context shape. Type-only — no assembly logic
 * or I/O lives here yet; building a real `DecisionOSContext` from Prisma/Canonical
 * World is out of scope for Phase 1 (docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §18).
 */

import type { ManagerBehavioralFacts } from '@/lib/decision-os/behavioral/facts'
import type { PlatformBehavioralIntelligence } from '@/lib/decision-os/behavioral/platform-intelligence'
import type { DecisionOSPluginContext } from '@/lib/decision-os/core/integrationContract'

export interface SportRef {
  /** e.g. "NFL" — data, never branched on directly by callers. */
  sport: string
  /** Which SportAdapter implementation resolved this context, for traceability. */
  adapterVersion: string
}

export interface TeamNode {
  id: string
  displayName: string
  rosterId: string | null
}

export interface RosterNode {
  rosterId: string
  participantId: string
  templateKey: string | null
}

export interface StandingsNode {
  ranking: string[]
  tiebreaker: string
}

export interface ScheduleNode {
  unit: 'week' | 'round' | 'slate' | 'series' | 'continuous'
  currentPeriod: number | null
}

/** Generalizes the existing Canonical World (`lib/decision-os/world/facts.ts` + `assemble.ts`). */
export interface LeagueStateGraph {
  league: { id: string; sport: string; format: string; isDynasty: boolean }
  teams: TeamNode[]
  rosters: RosterNode[]
  standings: StandingsNode | null
  schedule: ScheduleNode | null
}

/**
 * Generalizes the behavioral layer's per-manager facts + Phase 6 DNA — the target
 * single source of truth once the duplicated manager-DNA engines converge
 * (docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §1.3 / §8.3).
 */
export interface UserContextGraph {
  userId: string
  behavioralFacts: ManagerBehavioralFacts
  preferences: { riskTolerance: string; favoriteAssets: string[] } | null
}

/** Generalizes `behavioral/platform-intelligence.ts`'s PlatformBehavioralIntelligence — always anonymized/aggregate. */
export interface PlatformContextGraph {
  platformFacts: PlatformBehavioralIntelligence
}

export interface DecisionOSContext {
  sport: SportRef
  league: LeagueStateGraph
  user: UserContextGraph | null
  platform: PlatformContextGraph
  pluginContext: DecisionOSPluginContext
}
