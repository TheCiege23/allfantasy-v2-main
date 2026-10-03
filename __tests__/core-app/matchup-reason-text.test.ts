/**
 * Every explanation the Matchup screen prints from the server has Spanish (2026-10-03).
 *
 * The loaders write their `reason` strings in English on the server, which does not know the
 * reader's language, so the screen translates them at render (`matchupReasonText`). This suite
 * SCANS the producing modules for every English prose literal — quoted or template — so a new
 * English reason added without a Spanish line fails here instead of shipping English to a Spanish
 * reader.
 *
 * ⚠ THE FIRST VERSION OF THIS GUARD SCANNED ONLY `reason: '…'` QUOTED LITERALS, AND WAS BLIND TO
 * TEMPLATES. Two reasons are template strings in ternary branches — the lead note over the slot board
 * on every pre-kickoff week, and the unpriced projected final — and both shipped English under a green
 * suite until the My Team session probed the merged build. The scan below reads all literals.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { matchupConfidenceText, matchupReasonText } from '@/lib/core-app/matchupReasonText'

const PRODUCERS = [
  'lib/core-app/matchup.ts',
  'lib/core-app/matchupForecast.ts',
  'lib/core-app/bestBallForecast.ts',
  'lib/projections/winProbability.ts',
]

/**
 * Every English prose literal in a file — single-quoted, double-quoted or template — with comments
 * stripped. A `${…}` is filled as a reader would see it: a ternary (`starter${n === 1 ? '' : 's'}`)
 * by its empty branch, anything else by a digit.
 */
function proseLiterals(path: string): Array<{ at: string; text: string }> {
  const src = readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '')
  const out: Array<{ at: string; text: string }> = []
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g)) {
    const text = m[2]!.replace(/\$\{([^}]*)\}/g, (_, expr: string) => (expr.includes('?') ? '' : '7'))
    const words = text.match(/[A-Za-z][a-z’']+/g) ?? []
    if (words.length < 5 || !text.includes(' ')) continue
    out.push({ at: `${path}:${code.slice(0, m.index).split('\n').length}`, text })
  }
  return out
}

describe('matchupReasonText', () => {
  it('🛑 every English sentence the Matchup loaders can return has Spanish — templates included', () => {
    const all = PRODUCERS.flatMap(proseLiterals)
    // The scan must find real strings — and the TEMPLATES among them — or it asserts nothing.
    expect(all.length).toBeGreaterThan(30)
    expect(all.some((r) => r.text.startsWith('no per-player scoring has been ingested for 7 week 7'))).toBe(true)
    const untranslated = all.filter((r) => matchupReasonText(r.text, 'es') === r.text).map((r) => `${r.at}  ${r.text}`)
    expect(untranslated).toEqual([])
  })

  it('the My Team card’s unpriced reason, which it relays through this translator, has Spanish', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/core-app/playerProjections.ts'), 'utf8')
    const m = src.match(/NOTHING_LEAGUE_SCORED_REASON\s*=\s*\n?\s*"([^"]+)"/)
    expect(m).not.toBeNull()
    expect(matchupReasonText(m![1]!, 'es')).not.toBe(m![1])
  })

  it('🛑 the Matchup screen prints no server reason raw — each goes through the translator', () => {
    const src = readFileSync(resolve(process.cwd(), 'components/core-app/screens/Matchup.tsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const reads = [...code.matchAll(/data\.\w+\.(?:reason|data\.detail)\b/g)]
    // The scan must see the reads, or it asserts nothing.
    expect(reads.length).toBeGreaterThan(8)
    const raw = reads.filter((m) => !code.slice(Math.max(0, m.index! - 40), m.index!).includes('matchupReasonText('))
    expect(raw.map((m) => m[0])).toEqual([])
  })

  it('the league-scoring refusal, which the forecast relays, has Spanish', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/projections/leagueScoring.ts'), 'utf8')
    const m = src.match(/NO_LEAGUE_SCORING_REASON\s*=\s*\n?\s*'([^']+)'/)
    expect(m).not.toBeNull()
    expect(matchupReasonText(m![1]!, 'es')).not.toBe(m![1])
  })

  it('translates every parameterised reason, in the singular and the plural', () => {
    const samples = [
      'your team has no result stored for week 4',
      'week 5 is on file but nothing has been scored — this is an unplayed week, not a 0-0 game',
      "1 starter could not be priced under this league's scoring — no projection on file, or stats its rules do not cover — and counting them as zero would tilt the result toward the other side",
      "3 starters could not be priced under this league's scoring — no projection on file, or stats its rules do not cover — and counting them as zero would tilt the result toward the other side",
      '2 starters still to play have no projection — treating them as zero would tilt the result toward the other side',
      'all starters final — decided by 12.4',
      '4 starters with scoring remaining, 61.3 projected points outstanding',
      'Your roster: the full roster is unavailable',
      'Opponent roster: a roster player has no verified position',
    ]
    for (const s of samples) {
      const es = matchupReasonText(s, 'es')
      expect(es, s).not.toBe(s)
      // No English left behind in a translated line.
      expect(es, s).not.toMatch(/\b(the|starters?|roster|projected|week)\b/)
    }
  })

  it('translates a composite " · " line segment by segment', () => {
    const tally = '3 yet to start · 2 in progress · 5 finished or unavailable · 1 game states unavailable'
    expect(matchupReasonText(tally, 'es')).toBe(
      '3 por empezar · 2 en juego · 5 terminados o no disponibles · 1 estados de partido no disponibles',
    )
    const detail = '3 yet to start · 2 starters with scoring remaining, 24.0 projected points outstanding'
    expect(matchupReasonText(detail, 'es')).toBe(
      '3 por empezar · 2 titulares con puntos por sumar, 24.0 puntos proyectados pendientes',
    )
  })

  it('leaves English untouched, and passes unknown text through rather than blanking it', () => {
    const r = 'no weekly results stored for this league'
    expect(matchupReasonText(r, 'en')).toBe(r)
    expect(matchupReasonText('something new nobody translated', 'es')).toBe('something new nobody translated')
    expect(matchupReasonText(null, 'es')).toBe('')
  })

  it('names the confidence tier in the reader’s word order', () => {
    expect(matchupConfidenceText('MEDIUM', 'en')).toBe('MEDIUM confidence')
    expect(matchupConfidenceText('MEDIUM', 'es')).toBe('confianza media')
    expect(matchupConfidenceText('LOW', 'es')).toBe('confianza baja')
  })
})
