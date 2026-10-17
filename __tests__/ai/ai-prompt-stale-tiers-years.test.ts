// @vitest-environment node
/**
 * AI prompts state "now" from the clock, and the stale 2024 tier list is neither injected as truth nor
 * bound to the wrong athlete.
 *
 * 🛑 Measured 2026-10-12 (NFL week 6 of the 2026 season): the waiver prompt said "This is the OFFSEASON"
 * and "Championship window OPEN for 2025"; every dynasty prompt carried a "NON-NEGOTIABLE" tier list naming
 * Anthony Richardson a Tier 1 cornerstone; and `findPlayerTier` gave LB Justin Jefferson the WR's Tier 0.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildWaiverAiSystemPrompt, waiverPromptPhase } from '@/lib/waiver-ai-prompt'
import { getUniversalAIContext, UNIVERSAL_PLAYER_VALUE_RULES } from '@/lib/ai-player-context'
import { ALL_TIERED_PLAYERS, evaluateAsset, findPlayerTier } from '@/lib/dynasty-tiers'

const TODAY = new Date('2026-10-12T15:00:00Z')
const APRIL_2027 = new Date('2027-04-10T15:00:00Z')
const STALE_YEAR = /\b202[3-5]\b/

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('waiver system prompt is built from the date', () => {
  it('in October 2026 it is in-season, names the 2026 window, and carries no stale year or offseason claim', () => {
    expect(waiverPromptPhase('NFL', TODAY)).toBe('in_season')
    const p = buildWaiverAiSystemPrompt({ sport: 'NFL', now: TODAY })
    expect(p).not.toMatch(/This is the OFFSEASON/)
    expect(p).not.toMatch(/It is the offseason/)
    expect(p).toMatch(/IN-SEASON WAIVER MENTALITY/)
    expect(p).toMatch(/The 2026 regular season is under way/)
    expect(p).toMatch(/Championship window OPEN for 2026/)
    expect(p).toMatch(/Building for 2027\+ contention/)
    expect(p).toMatch(/Current fantasy season: 2026/)
    expect(p).not.toMatch(STALE_YEAR)
  })

  it('in April 2027 it is the offseason, and the window is 2027', () => {
    const p = buildWaiverAiSystemPrompt({ sport: 'nfl', now: APRIL_2027 })
    expect(p).toMatch(/This is the OFFSEASON/)
    expect(p).toMatch(/Championship window OPEN for 2027/)
    expect(p).toMatch(/Building for 2028\+ contention/)
    // 2026 is legitimately "the most recent NFL Draft" in April 2027 (before the late-April draft).
    expect(p).toMatch(/most recent NFL Draft was in 2026/)
    expect(p).not.toMatch(/window OPEN for 2026|Building for 2026|\b202[3-5]\b/)
  })

  it('a sport with no season calendar gets neither claim', () => {
    const p = buildWaiverAiSystemPrompt({ sport: 'CRICKET', now: TODAY })
    expect(p).not.toMatch(/OFFSEASON/)
    expect(p).not.toMatch(/IN-SEASON/)
  })
})

describe('findPlayerTier: exact normalized name, and the position group when the caller knows it', () => {
  it('does not give defenders the namesake WR/QB tier', () => {
    expect(findPlayerTier('Justin Jefferson', 'LB')).toBeNull()
    expect(findPlayerTier('DeVonta Smith', 'CB')).toBeNull()
    expect(findPlayerTier('Lamar Jackson', 'CB')).toBeNull()
    expect(evaluateAsset({ name: 'Justin Jefferson', position: 'LB' }).tier).not.toBe(0)
  })

  it('still finds the listed player, through suffix and punctuation spelling', () => {
    expect(findPlayerTier('Justin Jefferson', 'WR')?.tier).toBe(0)
    expect(findPlayerTier('Lamar Jackson', 'QB')?.tier).toBe(0)
    expect(findPlayerTier('Marvin Harrison Jr.', 'WR')?.tier).toBe(0)
    expect(findPlayerTier('Kenneth Walker', 'RB')?.tier).toBe(3)
    expect(findPlayerTier('AJ Brown')?.tier).toBe(1)
  })

  it('never substring-matches, with or without a position', () => {
    expect(findPlayerTier('Tee Higginson')).toBeNull() // contains "tee higgins"
    expect(findPlayerTier('Smith')).toBeNull() // contained in "DeVonta Smith"
    expect(findPlayerTier('Allen', 'WR')).toBeNull() // contained in "Keenan Allen"
    expect(findPlayerTier('')).toBeNull()
  })
})

describe('the injected tier block names no stale players', () => {
  it('UNIVERSAL_PLAYER_VALUE_RULES lists none of the 2024 tier names, but keeps the rules', () => {
    for (const p of ALL_TIERED_PLAYERS) {
      expect(UNIVERSAL_PLAYER_VALUE_RULES, p.name).not.toContain(p.name)
    }
    expect(UNIVERSAL_PLAYER_VALUE_RULES).toMatch(/Tier 0 — UNTOUCHABLES \(Value: 950\)/)
    expect(UNIVERSAL_PLAYER_VALUE_RULES).toMatch(/CURRENT market values/)
    expect(UNIVERSAL_PLAYER_VALUE_RULES).toMatch(/POSITIONAL VALUE MULTIPLIERS/)
    expect(getUniversalAIContext(TODAY)).not.toMatch(/Anthony Richardson|Puka Nacua/)
  })
})

describe('the other literal "now" years are derived', () => {
  it('season strategy names the next two drafts, not 2025-2026', () => {
    const s = src('lib/season-strategy.ts')
    expect(s).not.toMatch(/2025-2026 draft capital|2025\/2026 draft picks/)
    expect(s).toMatch(/latestNflDraftYear\(\) \+ 1\}-\$\{latestNflDraftYear\(\) \+ 2\} draft capital/)
  })
  it('/af-legacy, the grok waiver prompt and the team-context prompt carry no literal season', () => {
    const page = src('app/af-legacy/page.tsx')
    expect(page).not.toMatch(/Building for 2026\+/)
    expect(page).not.toMatch(/league\.season >= 2025/)
    expect(page).toMatch(/Building for \$\{legacyPromptSeason\(\) \+ 1\}\+/)
    expect(src('app/api/waiver-ai/grok/route.ts')).not.toMatch(/Waiver Wire AI for 20\d\d/)
    expect(src('lib/ai-gm-intelligence.ts')).not.toMatch(/3\. 20\d\d outlook/)
  })
})
