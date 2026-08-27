import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The off-topic gate in `app/api/chat/chimmy/route.ts` is a keyword allowlist,
 * and a question matching none of it never reaches a provider — it comes back as
 * a canned blurb that reads like being ignored.
 *
 * The list is module-private, so this reads it out of the source rather than
 * exporting it purely for a test. That is deliberate: the thing worth pinning is
 * the VOCABULARY, and a test that imported a helper would still pass if somebody
 * trimmed the list.
 */
const ROUTE = path.join(process.cwd(), 'app', 'api', 'chat', 'chimmy', 'route.ts')

function sportsKeywords(): string[] {
  const src = fs.readFileSync(ROUTE, 'utf8')
  const start = src.indexOf('const SPORTS_KEYWORDS = [')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('\n]', start)
  /*
   * Comments have to go first. The list carries an explanatory `// Injury's
   * plural is irregular` line, and that lone apostrophe re-pairs every quote
   * after it — the naive match then returns the separators (", ") instead of the
   * keywords, and silently "finds" 92 entries that are all punctuation.
   */
  const block = src
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')

  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

/** Mirrors `hasSportsContent` for text (the image branch short-circuits true). */
function passes(text: string): boolean {
  const lower = text.toLowerCase()
  return sportsKeywords().some((k) => lower.includes(k))
}

describe('Chimmy off-topic gate', () => {
  /*
   * The exact question that was silently deflected in production: it matched no
   * keyword at all, because the list had no `game`, `season`, `schedule` or
   * `score`.
   */
  it('lets through the question that was deflected in production', () => {
    expect(passes('is there any preseason games today?')).toBe(true)
  })

  it('lets through ordinary questions phrased without jargon', () => {
    const asked = [
      'is there any preseason games today?',
      'what games are on tonight?',
      'when does the season start?',
      'who is on my team this week?',
      'any news on my guys?',
      'what was the score?',
      'is the schedule out yet?',
      'how did my team do?',
      'who should I start sunday?',
      'any injuries I should know about?',
    ]
    for (const q of asked) {
      expect(passes(q), `should reach Chimmy: "${q}"`).toBe(true)
    }
  })

  /* The gap already documented in the list itself — irregular plural. */
  it('still covers the injuries case that was fixed before this one', () => {
    expect(passes('any injuries I should know about?')).toBe(true)
    expect(passes('is he injured?')).toBe(true)
  })

  it('keeps the vocabulary that was already there', () => {
    for (const q of ['who should I trade for?', 'waiver priority?', 'my lineup for week 3']) {
      expect(passes(q)).toBe(true)
    }
  })

  /*
   * The gate still has to do its job — it exists to stop model spend on things
   * that are not this product. Bias is deliberately toward letting questions
   * through, so this only pins the clearly-unrelated case.
   */
  it('still deflects something plainly unrelated', () => {
    expect(passes('what is the capital of France?')).toBe(false)
  })

  /*
   * ⚠ RECORDING A REAL WEAKNESS RATHER THAN ASSERTING A FICTION. Matching is
   * SUBSTRING, and 'te' is on the list for tight end — so "wri(te) me a poem"
   * sails through. The gate is therefore close to useless as a spend guard while
   * still being capable of blocking a genuine sports question, which is the
   * worst of both worlds.
   *
   * Left permissive on purpose: tightening to word boundaries would block more
   * real questions, and a false negative costs a user who thinks the assistant
   * is broken while a false positive costs one model call. The actual spend
   * control is the per-answer token price, not this list.
   */
  it('is porous, which is the safer direction of the two', () => {
    expect(passes('write me a poem about rain')).toBe(true)
  })

  it('names the additions that fixed this, so a trim is a visible change', () => {
    const list = sportsKeywords()
    for (const k of ['game', 'season', 'schedule', 'score', 'week', 'team', 'news']) {
      expect(list, `"${k}" must stay in SPORTS_KEYWORDS`).toContain(k)
    }
  })
})
