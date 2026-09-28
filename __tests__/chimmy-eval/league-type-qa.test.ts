import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 200 general questions about how each league format works, with the answer a good assistant
 * gives. Two uses: scoring Chimmy on format questions it answers without league data, and seeding
 * a user-facing FAQ.
 *
 * ⚠ `mustSay` AND `mustNotSay` ARE FACTS FOR A GRADER, NOT STRINGS TO MATCH. They are paraphrased
 * ("a trade is worth less as the season goes on"), so a scorer needs a judge, and a substring match
 * would fail correct answers. What this file checks is the corpus itself: its shape, and that every
 * source it cites exists.
 *
 * ⚠ ALLFANTASY-SPECIFIC RULES ARE CITED, NEVER ASSUMED. A `grounding` path is where the answer comes
 * from. `general` means standard fantasy knowledge. Where the repo does not settle a rule, the answer
 * says it depends on the league's settings (`needsLeagueData: true`), or the confidence is `low`.
 *
 * History worth keeping: the first draft answered "can I trade in guillotine / survivor?" with no,
 * from the Player Finder's `tradesAllowed: false`. The concept catalog
 * (`lib/league-rules/conceptCatalog.ts`), the per-format rules authority, says trading is legal in
 * both. Only Survivor All-Stars Guillotine and Tournament forbid it. The catalog wins, and gil-004
 * and sv-005 were rewritten to match.
 */

type QaItem = {
  id: string
  leagueType: string
  category: string
  question: string
  idealAnswer: string
  mustSay: string[]
  mustNotSay: string[]
  needsLeagueData: boolean
  grounding: string
  confidence: 'high' | 'medium' | 'low'
}

const FILE = path.join(process.cwd(), '__tests__', 'chimmy-eval', 'league-type-qa.json')
const QA: QaItem[] = JSON.parse(readFileSync(FILE, 'utf8'))

const CATEGORIES = ['rules', 'strategy', 'trades', 'draft', 'waivers', 'misconception', 'lineup', 'scoring', 'playoffs']

describe('league-type Q&A corpus', () => {
  it('holds exactly 200 items with unique ids and unique questions', () => {
    expect(QA).toHaveLength(200)
    expect(new Set(QA.map((q) => q.id)).size).toBe(200)
    expect(new Set(QA.map((q) => q.question.trim().toLowerCase())).size).toBe(200)
  })

  it('gives every item the full shape', () => {
    const bad = QA.filter((q) =>
      !q.id || !q.leagueType || !CATEGORIES.includes(q.category) || !q.question.trim() || !q.idealAnswer.trim()
      || !Array.isArray(q.mustSay) || q.mustSay.length < 1 || q.mustSay.length > 3
      || !Array.isArray(q.mustNotSay) || q.mustNotSay.length > 3
      || typeof q.needsLeagueData !== 'boolean' || !q.grounding.trim() || !['high', 'medium', 'low'].includes(q.confidence))
    expect(bad.map((q) => q.id)).toEqual([])
  })

  it('never has an ideal answer that says what it must not say', () => {
    const contradictions = QA.filter((q) => q.mustNotSay.some((s) => q.idealAnswer.toLowerCase().includes(s.toLowerCase())))
    expect(contradictions.map((q) => q.id)).toEqual([])
  })

  /* A cited source that does not exist is an invented one. */
  it('cites only files that exist', () => {
    const missing: string[] = []
    for (const q of QA) {
      for (const m of q.grounding.matchAll(/((?:lib|docs|app|components|prisma)\/[A-Za-z0-9_\-./*[\]]+)/g)) {
        const cited = m[1].replace(/[.;,)]+$/, '')
        const probe = cited.includes('*') ? cited.split('*')[0].replace(/\/$/, '') : cited
        if (!existsSync(path.join(process.cwd(), probe))) missing.push(`${q.id}: ${cited}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('keeps the no-trade formats and the trading formats apart, as the concept catalog does', () => {
    const answer = (id: string) => QA.find((q) => q.id === id)!.idealAnswer
    expect(answer('sag-004')).toMatch(/no trades/i)
    expect(answer('gil-004')).toMatch(/trades are allowed/i)
    expect(answer('sv-005')).toMatch(/trading is allowed/i)
  })

  it('covers the formats AllFantasy supports', () => {
    const types = new Set(QA.map((q) => q.leagueType))
    for (const t of ['general', 'redraft', 'dynasty', 'keeper', 'best_ball', 'idp', 'superflex', 'guillotine', 'survivor', 'survivor_guillotine', 'devy', 'c2c', 'salary_cap', 'tournament', 'zombie', 'pirate', 'king_of_the_hill', 'big_brother']) {
      expect(types, t).toContain(t)
    }
  })
})
