/**
 * Loads managers' records (./managerRecord.ts holds the rule and the contract) — for Chimmy, the
 * manager card and the commissioner's Managers screen.
 *
 * ⚠ NO NEW READ. The trade, waiver and draft histories come from the same readers the Trade Center,
 * Waivers screen and Draft HQ use (`readSleeperTradeHistory`, `readWaiverEdgeInput`,
 * `readDraftEdgeInput`), so a manager's counts here are the counts on those screens. DB-first: none of
 * them calls a provider.
 *
 * 🛑 MEMBERSHIP FIRST, IN HERE — the scoutEdgeLoader rule. A league id can come from a URL or a chat
 * message, and a plan is not a membership: without this a paying viewer could read every manager's
 * record in ANY league by its id. The PLAN gate is the caller's (it decides between this and a lock);
 * this guards the league.
 */
import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { resolveWaiverRules } from '@/lib/core-app/waivers'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { buildManagerRecord, type ManagerRecord, type ManagerRecordInput } from './managerRecord'
import { readSleeperTradeHistory } from './tradeEdgeLoader'
import { readWaiverEdgeInput } from './waiverEdgeLoader'
import { readDraftEdgeInput } from './draftEdgeLoader'

export type LeagueManagerRecords = {
  league: { id: string; name: string | null; platform: string }
  /** Your own team, when you have one in this league. Never in `records` unless asked for by id. */
  viewerTeamExternalId: string | null
  records: ManagerRecord[]
}

function displayName(t: { ownerName: string | null; teamName: string | null }): string {
  return t.ownerName?.trim() || t.teamName?.trim() || 'A manager'
}

export async function loadLeagueManagerRecords(input: {
  leagueId: string
  userId: string
  /** Only this team's record. Without it: every manager but the viewer. */
  teamExternalId?: string
  /** Every manager INCLUDING the viewer — the commissioner's directory of the whole league. */
  includeViewer?: boolean
  now?: Date
}): Promise<SectionState<LeagueManagerRecords>> {
  const now = input.now ?? new Date()

  const membership = await resolveLeagueMembership(input.leagueId, input.userId).catch(() => null)
  if (!membership) return { available: false, reason: 'Membership in this league could not be checked just now.' }
  if (!membership.ok) return { available: false, reason: 'Manager records are read only for a league you are in.' }

  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true, name: true, platform: true, platformLeagueId: true },
  })
  if (!league) return { available: false, reason: 'This league could not be read.' }
  const platform = String(league.platform ?? '').toLowerCase()

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: input.leagueId },
    select: { externalId: true, ownerName: true, teamName: true, platformUserId: true, claimedByUserId: true },
  })
  const viewer = teams.find((t) => t.claimedByUserId === input.userId) ?? null

  const targets = input.teamExternalId
    ? teams.filter((t) => t.externalId === input.teamExternalId)
    : teams.filter((t) => input.includeViewer || t.externalId !== viewer?.externalId)
  if (input.teamExternalId && targets.length === 0) {
    return { available: false, reason: 'That team is not in this league.' }
  }

  const tradesRead: ManagerRecordInput['trades'] =
    platform === 'sleeper' && league.platformLeagueId
      ? await readSleeperTradeHistory(league.platformLeagueId, now).catch(() => ({
          available: false as const,
          reason: 'Trade history could not be read right now.',
        }))
      : {
          available: false,
          reason: `Competitive Edge reads Sleeper trade history today. ${platformLabel(platform)} leagues aren't connected yet.`,
        }

  const [rules, draftsRead] = await Promise.all([
    resolveWaiverRules(input.leagueId, platform).catch(() => null),
    readDraftEdgeInput(input.leagueId).catch(() => ({ ok: false as const, reason: 'Draft history could not be read right now.' })),
  ])
  const usesFaab = Boolean(rules?.waiverType.available && rules.waiverType.data.kind === 'faab')
  const waiverRead = await readWaiverEdgeInput({ leagueId: input.leagueId, userId: input.userId, usesFaab, now }).catch(() => ({
    available: false as const,
    reason: 'Waiver history could not be read right now.',
  }))

  const drafts: ManagerRecordInput['drafts'] = draftsRead.ok
    ? { available: true, data: { picks: draftsRead.picks, unattributedSeasons: draftsRead.unattributed } }
    : { available: false, reason: draftsRead.reason }

  const records = targets.map((t) => {
    const faab = waiverRead.available
      ? (waiverRead.data.managers.find((m) => m.teamExternalId === t.externalId)?.faabRemaining ?? null)
      : null
    return buildManagerRecord({
      manager: { name: displayName(t), teamExternalId: t.externalId, ownerId: t.platformUserId?.trim() || null },
      viewerOwnerId: viewer?.platformUserId?.trim() || null,
      trades: tradesRead,
      waivers: waiverRead.available
        ? {
            available: true,
            data: {
              season: waiverRead.data.season,
              usesFaab: waiverRead.data.usesFaab,
              claims: waiverRead.data.claims,
              faabRemaining: faab,
              asOf: waiverRead.data.asOf,
              stale: waiverRead.data.stale,
            },
          }
        : waiverRead,
      drafts,
    })
  })

  return {
    available: true,
    data: {
      league: { id: league.id, name: league.name ?? null, platform },
      viewerTeamExternalId: viewer?.externalId ?? null,
      records,
    },
  }
}
