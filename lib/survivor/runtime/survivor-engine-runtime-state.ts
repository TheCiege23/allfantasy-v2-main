/**
 * Persisted on `SurvivorGameState.engineRuntimeV2` — lightweight runtime for v2 modules
 * (confessionals, clue chains, story beats) without new tables in the first iteration.
 */

import { prisma } from '@/lib/prisma'
import { parseSurvivorEngineSpecV2, type SurvivorEngineSpecV2 } from '@/lib/survivor/survivor-engine-spec-v2'

type SurvivorConfessionalEntry = {
  id: string
  rosterId: string
  userId: string
  week: number
  media: 'text' | 'audio' | 'video'
  content: string
  createdAt: string
  visibility: 'host_only' | 'league_after_episode'
}

type SurvivorClueChainProgress = {
  chainId: string
  idolTemplateKey: string
  stepIndex: number
  lastRevealedAt: string | null
}

type SurvivorEngineRuntimeV2 = {
  version: 2
  confessionals: SurvivorConfessionalEntry[]
  clueChains: SurvivorClueChainProgress[]
  storyBeats: { week: number; key: string; summary: string; createdAt: string }[]
}

const EMPTY_SURVIVOR_ENGINE_RUNTIME_V2: SurvivorEngineRuntimeV2 = {
  version: 2,
  confessionals: [],
  clueChains: [],
  storyBeats: [],
}

function parseSurvivorEngineRuntimeV2(raw: unknown): SurvivorEngineRuntimeV2 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_SURVIVOR_ENGINE_RUNTIME_V2
  const o = raw as Partial<SurvivorEngineRuntimeV2>
  if (o.version !== 2) return EMPTY_SURVIVOR_ENGINE_RUNTIME_V2
  return {
    version: 2,
    confessionals: Array.isArray(o.confessionals) ? o.confessionals : [],
    clueChains: Array.isArray(o.clueChains) ? o.clueChains : [],
    storyBeats: Array.isArray(o.storyBeats) ? o.storyBeats : [],
  }
}

export async function getSurvivorEngineRuntimeState(leagueId: string): Promise<SurvivorEngineRuntimeV2> {
  const gs = await prisma.survivorGameState.findUnique({
    where: { leagueId },
    select: { engineRuntimeV2: true },
  })
  return parseSurvivorEngineRuntimeV2(gs?.engineRuntimeV2 ?? null)
}

async function upsertSurvivorEngineRuntimeState(
  leagueId: string,
  next: SurvivorEngineRuntimeV2
): Promise<void> {
  await prisma.survivorGameState.upsert({
    where: { leagueId },
    create: {
      leagueId,
      phase: 'pre_draft',
      currentWeek: 0,
      engineRuntimeV2: next as object,
    },
    update: { engineRuntimeV2: next as object },
  })
}

export async function appendConfessional(
  leagueId: string,
  spec: SurvivorEngineSpecV2,
  entry: Omit<SurvivorConfessionalEntry, 'id' | 'createdAt'> & { id?: string }
): Promise<{ ok: true; entry: SurvivorConfessionalEntry } | { ok: false; error: string }> {
  if (!spec.modules.confessionals.enabled) {
    return { ok: false, error: 'Confessionals are disabled for this league engine spec.' }
  }
  const media = entry.media
  if (!spec.modules.confessionals.mediaTypes.includes(media)) {
    return { ok: false, error: `Media type ${media} is not enabled for this league.` }
  }
  const runtime = await getSurvivorEngineRuntimeState(leagueId)
  const full: SurvivorConfessionalEntry = {
    id: entry.id ?? `cf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    rosterId: entry.rosterId,
    userId: entry.userId,
    week: entry.week,
    media: entry.media,
    content: entry.content.slice(0, 12000),
    createdAt: new Date().toISOString(),
    visibility: entry.visibility,
  }
  runtime.confessionals = [full, ...runtime.confessionals].slice(0, 500)
  await upsertSurvivorEngineRuntimeState(leagueId, runtime)
  return { ok: true, entry: full }
}

export async function advanceClueChain(
  leagueId: string,
  spec: SurvivorEngineSpecV2,
  chainId: string,
  idolTemplateKey: string
): Promise<{ ok: true; progress: SurvivorClueChainProgress } | { ok: false; error: string }> {
  if (!spec.modules.idolClueChain.enabled) {
    return { ok: false, error: 'Idol clue chains are disabled for this league.' }
  }
  const runtime = await getSurvivorEngineRuntimeState(leagueId)
  const maxSteps = Math.max(1, spec.modules.idolClueChain.maxCluesPerIdol)
  let row = runtime.clueChains.find((c) => c.chainId === chainId)
  if (!row) {
    row = { chainId, idolTemplateKey, stepIndex: 0, lastRevealedAt: null }
    runtime.clueChains.push(row)
  }
  if (row.stepIndex >= maxSteps) {
    return { ok: false, error: 'Clue chain is already complete.' }
  }
  row.stepIndex += 1
  row.lastRevealedAt = new Date().toISOString()
  await upsertSurvivorEngineRuntimeState(leagueId, runtime)
  return { ok: true, progress: row }
}

export async function loadSurvivorEngineSpecForLeague(leagueId: string): Promise<SurvivorEngineSpecV2 | null> {
  const row = await prisma.survivorLeagueConfig.findUnique({
    where: { leagueId },
    select: { engineSpecV2: true },
  })
  if (!row) return null
  return parseSurvivorEngineSpecV2(row.engineSpecV2 ?? null)
}
