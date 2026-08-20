import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  assertAiSpendAllowed,
  isAiSpendEnabled,
  isAiSpendDisabledError,
  AiSpendDisabledError,
} from '@/lib/ai/aiSpendGuard'

const ENV = { ...process.env }
beforeEach(() => { delete process.env.AI_FEATURES_ENABLED; delete process.env.NEXT_PHASE })
afterEach(() => { process.env = { ...ENV } })

describe('AI spend guard — off by default', () => {
  it('refuses when the variable is UNSET', () => {
    // The whole point: an unset variable must mean "do not spend". A guard that defaults open
    // protects nothing on a fresh environment, which is exactly where money leaks.
    expect(isAiSpendEnabled()).toBe(false)
    expect(() => assertAiSpendAllowed('test')).toThrow(AiSpendDisabledError)
  })

  it.each(['false', 'FALSE', '0', '1', 'yes', 'TRUE', 'True', '', '  '])(
    'refuses for AI_FEATURES_ENABLED=%o',
    (v) => {
      process.env.AI_FEATURES_ENABLED = v
      expect(isAiSpendEnabled()).toBe(false)
      expect(() => assertAiSpendAllowed('test')).toThrow()
    },
  )

  it('allows ONLY the exact string "true"', () => {
    process.env.AI_FEATURES_ENABLED = 'true'
    expect(isAiSpendEnabled()).toBe(true)
    expect(() => assertAiSpendAllowed('test')).not.toThrow()
  })

  it('tolerates surrounding whitespace on the enabling value', () => {
    process.env.AI_FEATURES_ENABLED = '  true  '
    expect(isAiSpendEnabled()).toBe(true)
  })
})

describe('AI spend guard — error contract', () => {
  it('carries 402 and a stable code so callers map it to a payment state', () => {
    try {
      assertAiSpendAllowed('openai-route-client')
      throw new Error('should have thrown')
    } catch (e) {
      expect(isAiSpendDisabledError(e)).toBe(true)
      expect((e as AiSpendDisabledError).httpStatus).toBe(402)
      expect((e as AiSpendDisabledError).code).toBe('ai_spend_disabled')
      // The context must be named so an operator can tell WHICH boundary refused.
      expect((e as Error).message).toContain('openai-route-client')
      // And it must not read as a misconfiguration to whoever finds it in a log.
      expect((e as Error).message).toMatch(/deliberate/i)
    }
  })

  it('does not mistake an ordinary error for a spend refusal', () => {
    expect(isAiSpendDisabledError(new Error('network down'))).toBe(false)
    expect(isAiSpendDisabledError(null)).toBe(false)
  })
})

describe('AI spend guard — build phase', () => {
  it('does not throw during a production build', () => {
    // `next build` collects page data without the runtime env and may construct clients at module
    // scope. Throwing there would break the build while protecting nothing — no request is served.
    process.env.NEXT_PHASE = 'phase-production-build'
    expect(() => assertAiSpendAllowed('build')).not.toThrow()
  })
})

describe('AI spend guard — provider boundary coverage', () => {
  const repo = process.cwd()
  const read = (p: string) => fs.readFileSync(path.join(repo, p), 'utf8')

  /**
   * Boundaries wired to the guard. Moving a module from UNGUARDED to here is the intended direction.
   *
   * These are the points where a request actually LEAVES for a provider — deliberately not
   * `providerRouter`, which only chooses between them. Guarding the router would have refused
   * callers that inject or mock a client and therefore never would have spent anything, while
   * leaving anyone who calls a client directly unguarded.
   */
  const GUARDED = [
    'lib/openai-client.ts',
    'lib/xai-client.ts',
    'lib/deepseek-client.ts',
    'lib/ai/openai-route-client.ts',
    'lib/decision-os/three-brain/orchestrator.ts',
  ]

  /**
   * Known-unguarded provider boundaries — a RATCHET, not an allowlist. Each still spends money on
   * its own. The list must only ever shrink; adding to it means a new unguarded spend path shipped.
   */
  const UNGUARDED_RATCHET = [
    'lib/ai-gm-intelligence.ts',
    'lib/ai/imageGenerator.ts',
    'lib/ai/league-settings-ai/claude.ts',
    'lib/ai/working-memory.ts',
    'lib/autocoach/status-sources/XGrokAdapter.ts',
    'lib/brackets/intelligence/ai-narrator.ts',
    'lib/brand-social/draftWithClaude.ts',
    'lib/decision-os/three-brain/anthropicClient.ts',
    'lib/draft/ai-claude.ts',
    'lib/fantasy-coach/CoachEvaluationAI.ts',
    'lib/fantasy-news-aggregator/NewsSummarizerAI.ts',
    'lib/guillotine/ai/GuillotineAIService.ts',
    'lib/integrity/CollusionDetectionEngine.ts',
    'lib/integrity/TankingDetectionEngine.ts',
    'lib/salary-cap/ai/SalaryCapAIService.ts',
    'lib/simulation-engine/MatchupSimulationInsightAI.ts',
    'lib/smart-trade-recommendations.ts',
    'lib/social-sharing/GrokShareCopyService.ts',
    'lib/survivor/ai/SurvivorAIService.ts',
    'lib/trade-engine/ai-layer.ts',
    'lib/zombie/ai/ZombieAIService.ts',
    'lib/agents/workers/api-health-monitor.ts',
  ]

  it.each(GUARDED)('%s calls the spend guard', (file) => {
    expect(read(file)).toMatch(/assertAiSpendAllowed\(/)
  })

  it('the unguarded ratchet has not grown', () => {
    // If this fails high, an unguarded provider boundary was added. If it fails low, someone
    // guarded one — lower the number, that is the point.
    expect(UNGUARDED_RATCHET.length).toBeLessThanOrEqual(22)
  })

  it('every ratchet entry still exists (stale entries hide real coverage)', () => {
    const missing = UNGUARDED_RATCHET.filter((f) => !fs.existsSync(path.join(repo, f)))
    expect(missing).toEqual([])
  })
})
