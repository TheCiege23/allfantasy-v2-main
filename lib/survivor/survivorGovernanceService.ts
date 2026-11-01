import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { readSurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import {
  lockedGovernanceKeys,
  mergeSurvivorGovernanceIntoSettings,
  readSurvivorGovernanceSettings,
  validateSurvivorGovernancePatch,
  type SurvivorExperience,
  type SurvivorGovernanceContext,
  type SurvivorGovernanceSettings,
} from './survivorGovernanceSettings'
import { listSurvivorConductStrikes } from './survivorConductService'
import { loadCastawayExperience } from './survivorExperienceService'
import { survivorTradeWindowStatus } from './survivorTradeRules'

type Rec = Record<string, unknown>
const rec = (value: unknown): Rec => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {})

async function governanceContext(leagueId: string, settings: unknown, survivorSwapWeek: number | null): Promise<SurvivorGovernanceContext> {
  const [game, tribeCount] = await Promise.all([
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true, mergeTriggeredAt: true, phase: true } }),
    prisma.survivorTribe.count({ where: { leagueId, isMerged: false } }),
  ])
  const plan = readSurvivorFullSeasonPlan(settings)
  const foundation = normalizeSurvivorFoundationSettings(rec(settings))
  return {
    currentWeek: Math.max(0, game?.currentWeek ?? 0),
    firstWeek: plan?.startWeek ?? 1,
    tribesLocked: tribeCount > 0,
    mergeWeek: foundation.mergeTriggerType === 'week' ? foundation.mergeWeek : null,
    primarySwapWeek: survivorSwapWeek,
    merged: Boolean(game?.mergeTriggeredAt),
  }
}

export type GovernanceSaveResult =
  | { ok: true; settings: SurvivorGovernanceSettings; patch: Partial<SurvivorGovernanceSettings> }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string }

export async function saveSurvivorGovernanceSettings(leagueId: string, input: unknown): Promise<GovernanceSaveResult> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, survivorSwapWeek: true, survivorMode: true } })
  if (!league?.survivorMode) return { ok: false, status: 404, code: 'not_survivor', error: 'This is not a Survivor league.' }
  const current = readSurvivorGovernanceSettings(league.settings)
  const ctx = await governanceContext(leagueId, league.settings, league.survivorSwapWeek ?? null)
  const result = validateSurvivorGovernancePatch(input, current, ctx)
  if (!result.ok) return { ok: false, status: result.code === 'locked' ? 409 : 400, code: result.code, error: result.error }
  await prisma.league.update({ where: { id: leagueId }, data: { settings: mergeSurvivorGovernanceIntoSettings(league.settings, result.next) as object } })
  return { ok: true, settings: result.next, patch: result.patch }
}

export async function setSurvivorCastawayExperience(
  leagueId: string,
  userId: string,
  experience: SurvivorExperience | null,
): Promise<GovernanceSaveResult> {
  const player = await prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { id: true } })
  if (!player) return { ok: false, status: 404, code: 'not_found', error: 'That castaway is not in this Survivor league.' }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const overrides = { ...readSurvivorGovernanceSettings(league?.settings).experienceOverrides }
  if (experience) overrides[userId] = experience
  else delete overrides[userId]
  return saveSurvivorGovernanceSettings(leagueId, { experienceOverrides: overrides })
}

/** The Hub's governance tab: settings and locks, each castaway's strikes and experience, swap history (no assignments). */
export async function loadSurvivorGovernanceView(leagueId: string, now = new Date()) {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, survivorSwapWeek: true, sport: true } })
  const settings = readSurvivorGovernanceSettings(league?.settings)
  const ctx = await governanceContext(leagueId, league?.settings, league?.survivorSwapWeek ?? null)
  const [players, strikes, swaps] = await Promise.all([
    prisma.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true, displayName: true, tribeId: true, playerState: true }, orderBy: { displayName: 'asc' } }),
    listSurvivorConductStrikes(leagueId),
    prisma.survivorTribeSwap.findMany({ where: { leagueId }, orderBy: { executedAt: 'desc' }, take: 10, select: { id: true, week: true, swapType: true, revealAt: true, revealedAt: true } }),
  ])
  const experience = await loadCastawayExperience(leagueId, players.map((p) => p.userId), settings.experienceOverrides, undefined, { crossLeague: settings.experienceCrossLeague })
  const foundation = normalizeSurvivorFoundationSettings(rec(league?.settings))
  return {
    settings,
    /** For the cross-tribe window presets (NFL has the original league's two windows). */
    sport: league?.sport ?? null,
    locked: lockedGovernanceKeys(ctx),
    context: ctx,
    tradeWindow: survivorTradeWindowStatus(settings, { tribalDay: foundation.tribalCouncilDay, tribalTime: foundation.tribalCouncilTime, now }, ctx.merged),
    castaways: players.map((p) => ({
      ...p,
      strikes: strikes.filter((s) => s.userId === p.userId),
      experience: experience[p.userId] ?? { experience: 'rookie' as const, source: 'default' as const },
    })),
    swaps: swaps.map((s) => ({ id: s.id, week: s.week, swapType: s.swapType, sealed: Boolean(s.revealAt && !s.revealedAt), revealAt: s.revealAt?.toISOString() ?? null })),
  }
}

export type SurvivorGovernanceView = Awaited<ReturnType<typeof loadSurvivorGovernanceView>>
