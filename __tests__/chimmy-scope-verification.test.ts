/**
 * Verified league context in `/api/chat/chimmy`.
 *
 * Asserted against the route SOURCE for the reason `chimmy-tool-loop-route-wiring`
 * already gives: driving this route end to end needs a dozen mocks and times out
 * on a loaded machine, and the properties that matter here are structural — WHICH
 * side of a `??` the league sits on, and whether the verified value reaches the
 * prompt at all. Those are exactly what a refactor would silently invert.
 *
 * The behavioural half lives in `chimmy-effective-season.test.ts`, which tests the
 * resolver directly. This file only checks that the route USES it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTE = fs.readFileSync(
  path.join(process.cwd(), 'app', 'api', 'chat', 'chimmy', 'route.ts'),
  'utf8',
)

describe('the league outranks the client on league-scoped reads', () => {
  /*
   * 🛑 THE ORDER OF THIS `??` IS THE WHOLE FIX. `sport` is not a label — it keys
   * `loadPlayerPoolSummary`, `loadFantasyData`, `loadScheduleSummary` and
   * provider health inside the grounding packet. With the client first, an NBA
   * player pool could sit behind an answer about an NFL league.
   */
  it('resolves sport from the league before the client field', () => {
    expect(ROUTE).toContain(
      'const sport: SupportedSport = leagueSnapshot?.sport ?? sportExplicit ?? DEFAULT_SPORT',
    )
  })

  /*
   * ⚠ AND THE DIGEST MUST **NOT** BE FLIPPED WITH IT. That is the point of them
   * being two constants. The digest is world data — news, injuries, tonight's
   * games — and somebody scoped to an NFL league asking what NBA games are on is
   * asking a real question. Making the league outrank them there answers a
   * different one.
   *
   * Without this assertion, "make the league win" reads as a blanket rule and the
   * next edit applies it here too, breaking cross-sport questions with nothing
   * going red.
   */
  it('leaves the world-data digest following the question', () => {
    /*
     * ⚠ SLICED, NOT LINE-MATCHED. This declaration wraps onto a second line, and
     * the first version of this test read only the line containing
     * `const digestSport` — so it failed against correct code. A per-line guard
     * is blind to a wrapped statement, which this repo has already paid for in
     * the other direction: there, a wrapped call slipped PAST a guard that
     * looked thorough.
     */
    const at = ROUTE.indexOf('const digestSport')
    expect(at).toBeGreaterThan(-1)
    const declaration = ROUTE.slice(at, at + 300)
    expect(declaration).toContain('sportExplicit ?? leagueSnapshot?.sport')
  })

  it('resolves the season once, through the shared resolver', () => {
    expect(ROUTE).toContain("import { resolveEffectiveSeason } from '@/lib/chimmy/effectiveSeason'")
    expect(ROUTE).toContain('const effectiveSeasonResult = resolveEffectiveSeason({')
    expect(ROUTE).toContain('leagueSeason: leagueSnapshot?.season ?? null')
  })

  /*
   * A resolver nothing consults is decoration. The raw form field must not reach
   * a league-scoped call any more — the only `season,` left in a call position
   * would be the destructure of the parsed form itself.
   */
  it('passes the resolved season, not the raw form field', () => {
    expect(ROUTE).not.toMatch(/season: season \?\? undefined/)
    expect(ROUTE).not.toMatch(/season: season \?\? null/)
    expect(ROUTE).not.toMatch(/season: season \?\? new Date/)
    expect(ROUTE).toContain('season: effectiveSeason ?? undefined')
  })
})

describe('the grounding line carries the verified league facts', () => {
  const START = ROUTE.indexOf('function buildLeagueGroundingLine')
  const BLOCK = ROUTE.slice(START, ROUTE.indexOf('export async function POST'))

  it('is where the function still lives', () => {
    expect(START).toBeGreaterThan(-1)
    expect(BLOCK.length).toBeGreaterThan(200)
  })

  /*
   * 🛑 SCORING WAS ABSENT AND THAT IS THE DEFECT THIS CLOSES. The snapshot has
   * carried a verified `scoring` all along; the only scoring statement reaching
   * the model came from a CLIENT form field, rendered under a separate
   * `LEAGUE CONTEXT:` block with equal apparent authority. Nothing compared them.
   */
  it('states the verified scoring', () => {
    expect(BLOCK).toContain('s.scoring')
    expect(BLOCK).toContain('scoring=')
  })

  /*
   * ⚠ AND AN ABSENT SCORING IS STATED, NOT DROPPED. `.filter(Boolean)` would
   * remove a null, and silence reads to a model as "nothing worth mentioning" —
   * the same reasoning as the NOT AVAILABLE branch in this function. A league
   * whose scoring was never stored must produce a refusal to name one.
   */
  it('says so out loud when scoring is not stored', () => {
    expect(BLOCK).toContain('scoring=UNKNOWN')
    expect(BLOCK).toMatch(/do not state a scoring rule/i)
  })

  /*
   * A past-season answer that does not announce itself is indistinguishable from
   * a current-season answer that is simply wrong.
   */
  it('announces a season that came from the question', () => {
    expect(BLOCK).toContain("askedSeason?.source === 'question'")
    expect(BLOCK).toMatch(/current season is/i)
  })

  it('is given the resolved season by its caller', () => {
    expect(ROUTE).toContain('season: effectiveSeasonResult,')
  })
})
