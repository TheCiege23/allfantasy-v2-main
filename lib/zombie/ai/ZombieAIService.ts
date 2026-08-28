/**
 * Zombie AI service: call LLM with deterministic context only. PROMPT 355.
 * No infection, serum/weapon/ambush legality, promotion/relegation, trade, or drop enforcement.
 */

import OpenAI from 'openai'
import { withOfficialTimeUserMessage } from '@/lib/time-engine/chimmyPromptPrefix'
import type { ZombieAIDeterministicContext } from './ZombieAIContext'
import type { ZombieAIType } from './ZombieAIContext'
import type { ZombieUniverseAIDeterministicContext } from './ZombieAIContext'
import type { ZombieUniverseAIType } from './ZombieAIContext'
import { buildZombieAIPrompt, buildZombieUniverseAIPrompt } from './ZombieAIPrompts'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'

let openai: OpenAI | null = null

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY
  // PROVIDER BOUNDARY. Guard form matches this function's own contract: it
  // already returns null when the key is absent, so a spend refusal behaves
  // identically to an unconfigured provider. Above the key check because when
  // both are missing the switch is the actionable one.
  if (!isAiSpendEnabled()) return null

  if (!apiKey) return null
  if (!openai) {
    openai = new OpenAI({
      apiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    })
  }
  return openai
}

export interface ZombieAIResult {
  narrative: string
  model?: string
}

export function buildZombieAiCacheContextSummary(
  ctx: ZombieAIDeterministicContext,
): Record<string, unknown> {
  return {
    sport: ctx.sport,
    week: ctx.week,
    whispererRosterId: ctx.whispererRosterId,
    survivorRosterIds: [...ctx.survivors].sort(),
    zombieRosterIds: [...ctx.zombies].sort(),
    statusSummary: [...ctx.statuses]
      .map((entry) => `${entry.rosterId}:${entry.status}`)
      .sort(),
    movementWatchSummary: [...ctx.movementWatch]
      .map((entry) => `${entry.rosterId}:${entry.leagueId}:${entry.reason}:${entry.projectedLevelId ?? 'none'}`)
      .sort(),
    myRosterId: ctx.myRosterId,
    myResources: ctx.myResources,
    winningsByRoster: Object.fromEntries(
      Object.entries(ctx.winningsByRoster).sort(([a], [b]) => a.localeCompare(b)),
    ),
    serumBalanceByRoster: Object.fromEntries(
      Object.entries(ctx.serumBalanceByRoster).sort(([a], [b]) => a.localeCompare(b)),
    ),
    weaponBalanceByRoster: Object.fromEntries(
      Object.entries(ctx.weaponBalanceByRoster).sort(([a], [b]) => a.localeCompare(b)),
    ),
    chompinBlockCandidates: [...ctx.chompinBlockCandidates].sort(),
    collusionFlags: [...ctx.collusionFlags]
      .map((entry) => `${entry.rosterIdA}:${entry.rosterIdB}:${entry.flagType}`)
      .sort(),
    dangerousDropFlags: [...ctx.dangerousDropFlags]
      .map((entry) => `${entry.rosterId}:${entry.playerId}:${entry.estimatedValue}:${entry.threshold}`)
      .sort(),
    historicalContext: ctx.historicalContext ?? null,
    config: ctx.config,
  }
}

export function buildZombieUniverseAiCacheContextSummary(
  ctx: ZombieUniverseAIDeterministicContext,
): Record<string, unknown> {
  return {
    sport: ctx.sport,
    standings: [...ctx.standings]
      .map((entry) => ({
        leagueId: entry.leagueId,
        rosterId: entry.rosterId,
        levelName: entry.levelName,
        status: entry.status,
        totalPoints: entry.totalPoints,
        winnings: entry.winnings,
        serums: entry.serums,
        weapons: entry.weapons,
        weekKilled: entry.weekKilled,
      }))
      .sort((a, b) => `${a.leagueId}:${a.rosterId}`.localeCompare(`${b.leagueId}:${b.rosterId}`)),
    movementProjections: [...ctx.movementProjections]
      .map((entry) => `${entry.rosterId}:${entry.leagueId}:${entry.reason}:${entry.projectedLevelId ?? 'none'}`)
      .sort(),
  }
}

/**
 * Generate league-scoped Zombie AI narrative/advice from deterministic context.
 */
export async function generateZombieAI(
  ctx: ZombieAIDeterministicContext,
  type: ZombieAIType,
  userId?: string | null
): Promise<ZombieAIResult> {
  const client = getOpenAIClient()
  if (!client) {
    return {
      narrative:
        'AI zombie strategy is unavailable because OpenAI is not configured. Use the deterministic survivor, zombie, movement, resource, and safety data shown above.',
      model: 'deterministic-fallback',
    }
  }

  const { system, user } = buildZombieAIPrompt(ctx, type)
  const userContent = userId ? await withOfficialTimeUserMessage(userId, user) : user
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    max_tokens: 500,
    temperature: 0.5,
  })
  const narrative = completion.choices[0]?.message?.content?.trim() ?? 'No narrative generated.'
  return {
    narrative,
    model: completion.model ?? undefined,
  }
}

/**
 * Generate universe-scoped Zombie AI narrative from deterministic context.
 */
export async function generateZombieUniverseAI(
  ctx: ZombieUniverseAIDeterministicContext,
  type: ZombieUniverseAIType,
  userId?: string | null
): Promise<ZombieAIResult> {
  const client = getOpenAIClient()
  if (!client) {
    return {
      narrative:
        'AI zombie universe analysis is unavailable because OpenAI is not configured. Use the deterministic standings and movement projection data shown above.',
      model: 'deterministic-fallback',
    }
  }

  const { system, user } = buildZombieUniverseAIPrompt(ctx, type)
  const userContent = userId ? await withOfficialTimeUserMessage(userId, user) : user
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    max_tokens: 500,
    temperature: 0.5,
  })
  const narrative = completion.choices[0]?.message?.content?.trim() ?? 'No narrative generated.'
  return {
    narrative,
    model: completion.model ?? undefined,
  }
}
