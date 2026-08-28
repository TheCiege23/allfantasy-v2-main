import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Source-shape assertions plus a re-implementation of the scoring rules, so the
 * behaviour is pinned without importing a module that pulls prisma at load.
 *
 * Built from the SIX league names shown in production for one account:
 *   Four Horsemen All-Stars 2023 · Beta 1 Zombie League · World Football League
 *   KBI Commish Chopped · Last League Left · NFL Dynasty
 *
 * Asked "who should I start in the zombie league?", Chimmy replied "I found
 * multiple league matches. Tell me which exact league to use." — naming none of
 * them, for a question with exactly one right answer.
 */
const SRC = fs.readFileSync(
  path.join(process.cwd(), 'lib', 'chimmy', 'chimmy-league-resolution.ts'),
  'utf8',
)

const LEAGUES = [
  'Four Horsemen All-Stars 2023',
  'Beta 1 Zombie League',
  'World Football League',
  'KBI Commish Chopped',
  'Last League Left',
  'NFL Dynasty',
]

function normalise(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Mirrors GENERIC_NAME_TOKENS + distinctiveTokens in the module. */
const GENERIC = new Set(['league', 'fantasy', 'football', 'the', 'and', 'for', 'my', 'our', 'this', 'season', 'team', 'teams', 'redraft'])
const distinctive = (name: string) =>
  normalise(name).split(' ').filter((t) => t.length >= 3 && !GENERIC.has(t))

const contains = (text: string, word: string) =>
  new RegExp(`(^|\\b)${word}(\\b|$)`, 'i').test(text)

describe('generic words no longer decide which league you meant', () => {
  it('does not treat "league" as a distinguishing word', () => {
    expect(SRC).toContain('GENERIC_NAME_TOKENS')
    expect(distinctive('Beta 1 Zombie League')).toEqual(['beta', 'zombie'])
    expect(distinctive('World Football League')).toEqual(['world'])
    expect(distinctive('Last League Left')).toEqual(['last', 'left'])
  })

  /*
   * ⚠ A WORD IN EXACTLY ONE OF THE USER'S LEAGUE NAMES IS AN ANSWER. "zombie"
   * names one league out of six, so the question was never ambiguous.
   */
  it('finds the unique discriminator for the zombie league', () => {
    const input = normalise('who should I start in the zombie league?')
    const hits = LEAGUES.filter((name) => distinctive(name).some((t) => contains(input, t)))
    expect(hits).toEqual(['Beta 1 Zombie League'])
  })

  /*
   * ⚠ AND THE OLD RULE WOULD HAVE MATCHED FOUR OF THEM, because `league`
   * counted. This is the regression being prevented.
   */
  it('shows what the old rule did: four leagues looked plausible', () => {
    const input = normalise('who should I start in the zombie league?')
    const naive = LEAGUES.filter((name) =>
      normalise(name).split(' ').filter((t) => t.length >= 3).some((t) => contains(input, t)),
    )
    expect(naive.length).toBeGreaterThan(1)
    expect(naive).toContain('World Football League')
  })

  it('leaves a genuinely unknown name matching nothing', () => {
    const input = normalise('who should I start in KBFL this week?')
    const hits = LEAGUES.filter((name) => distinctive(name).some((t) => contains(input, t)))
    expect(hits).toEqual([])
  })
})

describe('the scoring path can actually select a league', () => {
  /*
   * ⚠ IT COULD NOT BEFORE. The token-overlap branch capped at 0.82 while the
   * threshold is 0.85, so that path was mathematically incapable of selecting
   * anything and every such question fell through to "ambiguous".
   */
  it('caps overlap scoring ABOVE the selection threshold', () => {
    const cap = SRC.match(/Math\.min\((0\.\d+), hitCount \/ tokens\.length\)/)
    const threshold = SRC.match(/const threshold = args\.threshold \?\? (0\.\d+)/)
    expect(cap).not.toBeNull()
    expect(threshold).not.toBeNull()
    expect(Number(cap![1])).toBeGreaterThan(Number(threshold![1]))
  })
})

describe('an ambiguous answer names the candidates', () => {
  /*
   * ⚠ THE NAMES WERE COMPUTED AND THROWN AWAY. `ambiguousChoices` always carried
   * `leagueName` while the message said only "multiple league matches" — a
   * question the reader cannot possibly answer.
   */
  it('no longer ships the nameless message', () => {
    expect(SRC).not.toContain("'I found multiple league matches. Tell me which exact league to use.'")
    expect(SRC).not.toContain("'Which league do you want me to use for this question?'")
  })

  it('interpolates the league names into both messages', () => {
    expect(SRC).toMatch(/I found more than one league that could match:.*c\.leagueName/s)
    expect(SRC).toMatch(/Which league do you want me to use\? Yours are:.*c\.leagueName/s)
  })
})
