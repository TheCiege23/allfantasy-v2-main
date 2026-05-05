/**
 * NPC draft personality assignment + deterministic scoring helpers.
 * No network calls — suitable for tests and live autopick.
 */

import type { DraftDecisionContext, DraftPlayerOption, BotArchetypeId } from '@/lib/ai/opponents/types'
import {
  NPC_DRAFT_PERSONALITIES,
  type NpcDraftPersonalityId,
  isNpcDraftPersonalityId,
} from '@/lib/live-draft-engine/npcDraftPersonalityTypes'
import type { CommissionerAiManagersBlob } from '@/lib/commissioner-ai-draft-manager/types'

export type HistoricalPickLite = {
  position: string
  team: string | null
  /** ADP rank expected when picked (lower = better). */
  expectedAdpRank?: number | null
  /** Overall pick number (1-based). */
  overallPick?: number | null
  isRookie?: boolean
  age?: number | null
}

export type AssignNpcDraftPersonalityInput = {
  existingPersonality?: NpcDraftPersonalityId | null
  historicalPicks: HistoricalPickLite[]
  /** When true, no cross-season history — use seeded random. */
  treatAsFreshLeague: boolean
  randomSeed: number
}

export type AssignNpcDraftPersonalityResult = {
  personality: NpcDraftPersonalityId
  favoriteTeamAbbr: string | null
  source: 'existing' | 'historical' | 'random'
}

function normalizeTeam(abbr: string | null | undefined): string | null {
  if (!abbr) return null
  const u = String(abbr).trim().toUpperCase()
  return u.length ? u : null
}

function seededIndex(seed: number, modulo: number): number {
  const x = Math.abs(seed) % 2147483647
  return modulo <= 0 ? 0 : x % modulo
}

/** Deterministic pick from the supported personality list. */
export function pickRandomNpcPersonality(seed: number): NpcDraftPersonalityId {
  const idx = seededIndex(seed, NPC_DRAFT_PERSONALITIES.length)
  return NPC_DRAFT_PERSONALITIES[idx]!
}

export function inferHistoricalDraftPersonality(picks: HistoricalPickLite[]): NpcDraftPersonalityId {
  const usable = picks.filter((p) => (p.position ?? '').trim().length > 0)
  if (usable.length === 0) return 'BALANCED'

  let rookieCount = 0
  let ageSum = 0
  let ageN = 0
  const teamVotes = new Map<string, number>()
  let adpReachSum = 0
  let adpReachN = 0
  let tightPicks = 0

  for (const p of usable) {
    if (p.isRookie) rookieCount += 1
    if (p.age != null && p.age > 0) {
      ageSum += p.age
      ageN += 1
    }
    const tm = normalizeTeam(p.team)
    if (tm) teamVotes.set(tm, (teamVotes.get(tm) ?? 0) + 1)

    const overall = p.overallPick ?? 999
    const exp = p.expectedAdpRank
    if (exp != null && exp > 0) {
      const delta = overall - exp
      adpReachSum += Math.abs(delta)
      adpReachN += 1
      if (Math.abs(delta) <= 14) tightPicks += 1
    }
  }

  const rookieRate = rookieCount / usable.length
  const avgAge = ageN ? ageSum / ageN : 0
  const avgReach = adpReachN ? adpReachSum / adpReachN : 0
  const tightRate = usable.length ? tightPicks / usable.length : 0

  const sortedTeams = [...teamVotes.entries()].sort((a, b) => b[1] - a[1])
  const topTeamShare = sortedTeams.length ? sortedTeams[0]![1] / usable.length : 0

  if (rookieRate >= 0.42) return 'YOUTH_DYNASTY_UPSIDE'
  if (avgAge >= 29 && ageN >= 2) return 'WIN_NOW_VETERAN'
  /** Reach-heavy histories before single-team clustering (avoid misclassifying reach builds as “homer”). */
  if (avgReach >= 34 && adpReachN >= 2) return 'CONTRARIAN_CHAOS'
  if (topTeamShare >= 0.48 && sortedTeams[0]) return 'HOMER_TEAM_FAVORITE'
  if (topTeamShare >= 0.3 && sortedTeams[0]) return 'STACK_TEAM_CORRELATION'
  if (tightRate >= 0.45 && usable.length >= 4) return 'BEST_PLAYER_AVAILABLE'

  const posCounts: Record<string, number> = {}
  for (const p of usable) {
    const pos = String(p.position ?? '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
    const key =
      pos.includes('RB') ? 'RB' : pos.includes('WR') ? 'WR' : pos.includes('QB') ? 'QB' : pos.includes('TE') ? 'TE' : 'FL'
    posCounts[key] = (posCounts[key] ?? 0) + 1
  }
  const distinct = Object.keys(posCounts).length
  if (distinct >= 4 && usable.length >= 6) return 'NEED_BASED'

  return 'BALANCED'
}

export function inferFavoriteTeamFromHistory(picks: HistoricalPickLite[]): string | null {
  const votes = new Map<string, number>()
  for (const p of picks) {
    const tm = normalizeTeam(p.team)
    if (tm) votes.set(tm, (votes.get(tm) ?? 0) + 1)
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
  return best ? best[0] : null
}

export function assignNpcDraftPersonality(input: AssignNpcDraftPersonalityInput): AssignNpcDraftPersonalityResult {
  const existing = input.existingPersonality
  if (existing && isNpcDraftPersonalityId(existing)) {
    return { personality: existing, favoriteTeamAbbr: null, source: 'existing' }
  }

  if (input.historicalPicks.length > 0 && !input.treatAsFreshLeague) {
    const personality = inferHistoricalDraftPersonality(input.historicalPicks)
    const fav =
      personality === 'HOMER_TEAM_FAVORITE'
        ? inferFavoriteTeamFromHistory(input.historicalPicks)
        : null
    return {
      personality,
      favoriteTeamAbbr: fav,
      source: 'historical',
    }
  }

  const personality = pickRandomNpcPersonality(input.randomSeed)
  return {
    personality,
    favoriteTeamAbbr: null,
    source: 'random',
  }
}

export function mergeNpcPersonalityIntoBlob(
  blob: CommissionerAiManagersBlob,
  rosterId: string,
  patch: { npcDraftPersonality: NpcDraftPersonalityId; npcFavoriteTeamAbbr?: string | null }
): CommissionerAiManagersBlob {
  const nextAssignments = blob.assignments.map((a) =>
    a.rosterId === rosterId
      ? {
          ...a,
          npcDraftPersonality: patch.npcDraftPersonality,
          ...(patch.npcFavoriteTeamAbbr !== undefined
            ? { npcFavoriteTeamAbbr: patch.npcFavoriteTeamAbbr ?? undefined }
            : {}),
        }
      : a
  )
  return { ...blob, assignments: nextAssignments }
}

/** Map legacy bot archetypes to NPC personalities for scoring when no commissioner stamp exists. */
export function mapArchetypeToNpcPersonality(archetypeId: BotArchetypeId): NpcDraftPersonalityId {
  const table: Partial<Record<BotArchetypeId, NpcDraftPersonalityId>> = {
    balanced_builder: 'BALANCED',
    win_now_grinder: 'WIN_NOW_VETERAN',
    rookie_hunter: 'YOUTH_DYNASTY_UPSIDE',
    zero_rb_sharp: 'NEED_BASED',
    hero_rb_drafter: 'NEED_BASED',
    qb_early_drafter: 'NEED_BASED',
    te_premium_exploiter: 'NEED_BASED',
    chaos_gambler: 'CONTRARIAN_CHAOS',
    devy_hoarder: 'YOUTH_DYNASTY_UPSIDE',
    pick_collector: 'BEST_PLAYER_AVAILABLE',
    aging_vet_buyer: 'WIN_NOW_VETERAN',
    risk_averse_floor: 'BEST_PLAYER_AVAILABLE',
  }
  return table[archetypeId] ?? 'BALANCED'
}

type ScoreParts = { base: number; need: number; reach: number }

function normalizePos(raw: string): string {
  const u = raw.toUpperCase()
  if (u.includes('QB')) return 'QB'
  if (u.includes('RB')) return 'RB'
  if (u.includes('WR')) return 'WR'
  if (u.includes('TE')) return 'TE'
  return 'FL'
}

/**
 * Extra score delta from NPC personality (added to existing decideDraftPick score).
 */
export function applyNpcPersonalityScoreAdjustment(
  ctx: DraftDecisionContext,
  p: DraftPlayerOption,
  parts: ScoreParts
): number {
  const id = ctx.npcDraftPersonality
  if (!id) return 0

  const pos = normalizePos(p.position)
  const leagueSport = (ctx.leagueSport ?? '').toUpperCase()
  if (p.sport && leagueSport && String(p.sport).toUpperCase() !== leagueSport) return -1e6

  let delta = 0

  switch (id) {
    case 'BALANCED':
      delta += 0
      break
    case 'NEED_BASED':
      delta += parts.need * 0.85
      break
    case 'BEST_PLAYER_AVAILABLE':
      delta += parts.base * 0.45
      delta -= parts.need * 0.15
      break
    case 'YOUTH_DYNASTY_UPSIDE':
      if (p.isRookie) delta += 42
      if (p.age != null && p.age <= 24) delta += 28
      if (p.age != null && p.age >= 30) delta -= 22
      break
    case 'WIN_NOW_VETERAN':
      if (p.age != null && p.age >= 29) delta += 38
      if (p.isRookie) delta -= 18
      break
    case 'STACK_TEAM_CORRELATION': {
      const teams = ctx.rosteredSkillTeams ?? []
      const pt = normalizeTeam(p.team)
      if (pt && teams.includes(pt)) delta += 55
      break
    }
    case 'CONTRARIAN_CHAOS':
      delta += Math.abs(parts.reach) * 0.35 + 18
      break
    case 'HOMER_TEAM_FAVORITE': {
      const fav = normalizeTeam(ctx.npcFavoriteTeamAbbr ?? undefined)
      const pt = normalizeTeam(p.team)
      if (fav && pt && fav === pt) delta += 70
      break
    }
    default:
      break
  }

  return delta
}

/** Build audit payload for AiManagerAuditLog rows (draft AI picks). */
export function buildNpcAiManagerDraftAuditPayload(input: {
  personality: NpcDraftPersonalityId | null
  chosenPlayerId: string
  chosenPlayerName: string
  position: string
  reason: string
  candidateScores: Array<{ playerId: string; score: number }>
  leagueSport: string
}): Record<string, unknown> {
  return {
    kind: 'npc_draft_autopick',
    npcDraftPersonality: input.personality,
    chosenPlayerId: input.chosenPlayerId,
    chosenPlayerName: input.chosenPlayerName,
    position: input.position,
    reason: input.reason,
    candidateScores: input.candidateScores.slice(0, 24),
    leagueSport: input.leagueSport,
  }
}
