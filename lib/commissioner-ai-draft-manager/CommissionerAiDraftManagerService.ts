import { prisma } from '@/lib/prisma'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import {
  CommissionerAiManagersBlobSchema,
  DEFAULT_TRADE_RULES,
  type CommissionerAiAssignment,
  type CommissionerAiManagersBlob,
  type CommissionerTradeRules,
} from './types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export const MAX_AI_TEAMS = 4

export interface AssignedAiTeamRow {
  teamId: string
  teamName: string
  aiStyle: string
  tradeAggression: string
  active: boolean
  npcDraftPersonality?: string
  npcFavoriteTeamAbbr?: string
}

export interface CommissionerAiDraftApiResponse {
  assignedAiTeams: AssignedAiTeamRow[]
  tradeRules: CommissionerTradeRules
}

function slotNameByRoster(slotOrder: SlotOrderEntry[], rosterId: string): string {
  return slotOrder.find((s) => s.rosterId === rosterId)?.displayName ?? rosterId.slice(0, 8)
}

function normalizeBlob(raw: unknown): CommissionerAiManagersBlob {
  const base: CommissionerAiManagersBlob = {
    assignments: [],
    tradeRules: { ...DEFAULT_TRADE_RULES },
  }
  if (!raw || typeof raw !== 'object') return base
  const parsed = CommissionerAiManagersBlobSchema.safeParse(raw)
  return parsed.success ? parsed.data : base
}

export function parseCommissionerAiManagers(raw: unknown): CommissionerAiManagersBlob {
  return normalizeBlob(raw)
}

export function buildApiResponse(
  blob: CommissionerAiManagersBlob | null | undefined,
  slotOrder: SlotOrderEntry[]
): CommissionerAiDraftApiResponse {
  const b = normalizeBlob(blob)
  const assignedAiTeams: AssignedAiTeamRow[] = b.assignments
    .filter((a) => a.active)
    .map((a) => ({
      teamId: a.rosterId,
      teamName: slotNameByRoster(slotOrder, a.rosterId),
      aiStyle: a.aiStyle,
      tradeAggression: a.tradeAggression,
      active: true,
      npcDraftPersonality: a.npcDraftPersonality,
      npcFavoriteTeamAbbr: a.npcFavoriteTeamAbbr,
    }))
  return {
    assignedAiTeams,
    tradeRules: { ...DEFAULT_TRADE_RULES, ...b.tradeRules },
  }
}

export async function getBlobForLeague(leagueId: string): Promise<CommissionerAiManagersBlob | null> {
  const row = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { commissionerAiManagers: true, slotOrder: true },
  })
  if (!row) return null
  return normalizeBlob(row.commissionerAiManagers)
}

export interface ValidateAssignmentsInput {
  leagueId: string
  assignments: CommissionerAiAssignment[]
  tradeRules: CommissionerTradeRules
}

export async function validateAndMergeAssignments(
  input: ValidateAssignmentsInput
): Promise<{ ok: true; blob: CommissionerAiManagersBlob } | { ok: false; error: string }> {
  const orphanIds = new Set(await getOrphanRosterIdsForLeague(input.leagueId))
  const active = input.assignments.filter((a) => a.active)
  if (active.length > MAX_AI_TEAMS) {
    return { ok: false, error: `At most ${MAX_AI_TEAMS} AI-managed teams per draft.` }
  }
  const seen = new Set<string>()
  for (const a of active) {
    if (seen.has(a.rosterId)) return { ok: false, error: 'Duplicate roster in AI assignments.' }
    seen.add(a.rosterId)
    if (!orphanIds.has(a.rosterId)) {
      return { ok: false, error: `Roster ${a.rosterId} is not an empty/orphan team.` }
    }
  }
  const merged: CommissionerAiManagersBlob = {
    assignments: input.assignments,
    tradeRules: { ...DEFAULT_TRADE_RULES, ...input.tradeRules },
    _meta: undefined,
  }
  const parsed = CommissionerAiManagersBlobSchema.safeParse(merged)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((e) => e.message).join('; ') }
  }
  return { ok: true, blob: parsed.data }
}

export async function saveCommissionerAiManagers(leagueId: string, blob: CommissionerAiManagersBlob): Promise<void> {
  // `leagueId` is no longer unique on DraftSession, so resolve the league's current draft
  // first and write to that row by id. Absent session still throws, as the previous
  // `update({ where: { leagueId } })` did.
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true },
  })
  if (!session) throw new Error(`No draft session for league ${leagueId}`)
  await prisma.draftSession.update({
    where: { id: session.id },
    data: {
      commissionerAiManagers: blob as object,
      version: { increment: 1 },
    },
  })
}

export function isRosterAiControlled(blob: CommissionerAiManagersBlob | null | undefined, rosterId: string): boolean {
  const b = normalizeBlob(blob)
  return b.assignments.some((a) => a.active && a.rosterId === rosterId)
}

export function getAssignmentForRoster(
  blob: CommissionerAiManagersBlob | null | undefined,
  rosterId: string
): CommissionerAiAssignment | null {
  const b = normalizeBlob(blob)
  return b.assignments.find((a) => a.active && a.rosterId === rosterId) ?? null
}

export function canAiProposeTrade(params: {
  blob: CommissionerAiManagersBlob | null | undefined
  proposerRosterId: string
  receiverRosterId: string
  now: Date
}): { allowed: boolean; reason?: string } {
  const b = normalizeBlob(params.blob)
  const rules = { ...DEFAULT_TRADE_RULES, ...b.tradeRules }
  if (!isRosterAiControlled(b, params.proposerRosterId)) return { allowed: true }
  if (rules.blockAiToAi && isRosterAiControlled(b, params.receiverRosterId)) {
    return { allowed: false, reason: 'AI teams cannot trade pick proposals with each other.' }
  }
  if (!rules.allowOutbound) {
    return { allowed: false, reason: 'AI outbound trades are disabled for this draft.' }
  }
  const assign = getAssignmentForRoster(b, params.proposerRosterId)
  if (assign?.allowOutbound === false) {
    return { allowed: false, reason: 'This AI team has outbound trades disabled.' }
  }
  if (assign?.tradeAggression === 'none') {
    return { allowed: false, reason: 'This AI team has trade aggression set to none.' }
  }
  const last = b._meta?.lastOutboundProposalAtByRosterId?.[params.proposerRosterId]
  if (last && rules.proposalCooldownSeconds > 0) {
    const elapsed = (params.now.getTime() - new Date(last).getTime()) / 1000
    if (elapsed < rules.proposalCooldownSeconds) {
      return { allowed: false, reason: `Proposal cooldown: wait ${Math.ceil(rules.proposalCooldownSeconds - elapsed)}s.` }
    }
  }
  return { allowed: true }
}

export function checkAiProposalRoundCap(
  blob: CommissionerAiManagersBlob | null | undefined,
  proposerRosterId: string,
  currentRound: number
): { ok: boolean; reason?: string } {
  const b = normalizeBlob(blob)
  if (!isRosterAiControlled(b, proposerRosterId)) return { ok: true }
  const rules = { ...DEFAULT_TRADE_RULES, ...b.tradeRules }
  if (rules.maxProposalsPerRound <= 0) return { ok: true }
  const pr = b._meta?.proposalsThisRound
  const n = pr?.round === currentRound ? pr.byRosterId[proposerRosterId] ?? 0 : 0
  if (n >= rules.maxProposalsPerRound) {
    return { ok: false, reason: `Maximum ${rules.maxProposalsPerRound} AI trade proposals per round for this team.` }
  }
  return { ok: true }
}

export function withUpdatedProposalThrottle(
  blob: CommissionerAiManagersBlob,
  proposerRosterId: string,
  round: number,
  now: Date
): CommissionerAiManagersBlob {
  const counts = blob._meta?.proposalsThisRound
  const byRosterId =
    counts?.round === round ? { ...counts.byRosterId } : {}
  byRosterId[proposerRosterId] = (byRosterId[proposerRosterId] ?? 0) + 1
  return {
    ...blob,
    _meta: {
      ...blob._meta,
      lastOutboundProposalAtByRosterId: {
        ...blob._meta?.lastOutboundProposalAtByRosterId,
        [proposerRosterId]: now.toISOString(),
      },
      proposalsThisRound: { round, byRosterId },
    },
  }
}
