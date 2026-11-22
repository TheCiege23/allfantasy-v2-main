/**
 * Prisma helpers for AI opponent persistence — server-only.
 */

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { getBotProfileById, mergeTendencies } from "./botProfiles"

export async function getAssignmentForTeam(leagueTeamId: string) {
  return prisma.aiOpponentTeamAssignment.findUnique({
    where: { leagueTeamId },
    include: { profile: true, memory: true },
  })
}

export async function logBotAction(input: {
  leagueId: string
  leagueTeamId?: string | null
  botProfileId?: string | null
  actionType: string
  payload?: Prisma.InputJsonValue
  result?: Prisma.InputJsonValue
  durationMs?: number
  errorMessage?: string | null
}) {
  return prisma.aiOpponentActionLog.create({
    data: {
      leagueId: input.leagueId,
      leagueTeamId: input.leagueTeamId ?? null,
      botProfileId: input.botProfileId ?? null,
      actionType: input.actionType,
      payload: input.payload,
      result: input.result,
      durationMs: input.durationMs,
      errorMessage: input.errorMessage ?? null,
    },
  })
}

export async function canProposeTrade(leagueId: string, leagueTeamId: string, minHoursBetween: number): Promise<boolean> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - minHoursBetween * 3600 * 1000)
  const row = await prisma.aiOpponentTradeCooldown.upsert({
    where: { leagueId_leagueTeamId: { leagueId, leagueTeamId } },
    create: { leagueId, leagueTeamId, lastProposalAt: null, proposalCount: 0, windowStart: now },
    update: {},
  })
  if (!row.windowStart || row.windowStart < windowStart) {
    await prisma.aiOpponentTradeCooldown.update({
      where: { id: row.id },
      data: { proposalCount: 0, windowStart: now },
    })
    return true
  }
  return row.proposalCount < 3
}

export async function recordTradeProposal(leagueId: string, leagueTeamId: string) {
  const row = await prisma.aiOpponentTradeCooldown.findUnique({
    where: { leagueId_leagueTeamId: { leagueId, leagueTeamId } },
  })
  if (!row) {
    await prisma.aiOpponentTradeCooldown.create({
      data: { leagueId, leagueTeamId, lastProposalAt: new Date(), proposalCount: 1, windowStart: new Date() },
    })
    return
  }
  await prisma.aiOpponentTradeCooldown.update({
    where: { id: row.id },
    data: { lastProposalAt: new Date(), proposalCount: { increment: 1 } },
  })
}

export function profileFromDbRow(profile: { botId: string; displayName: string; avatarUrl: string | null; archetypeId: string; tendencies: unknown }) {
  const base = getBotProfileById(profile.botId)
  if (!base) return null
  const overlay = typeof profile.tendencies === "object" && profile.tendencies ? (profile.tendencies as Record<string, unknown>) : {}
  return mergeTendencies(
    { ...base, displayName: profile.displayName, avatarUrl: profile.avatarUrl },
    overlay as Partial<import("./types").StrategicTendencies>,
  )
}
