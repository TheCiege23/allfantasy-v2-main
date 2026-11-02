/**
 * /core batch B2 (My team, Your week, Defense Hub): the pure mappings (lib/core-app/redraftCoreMyTeam.ts),
 * the status shorthand (lib/core-app/myTeamStatusShorthand.ts), and the stylesheet's gating — every rule
 * in af-core-redraft-myteam.css applies only under the shell's redraft stamp.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  lineupPeriodLabel,
  noGameBadge,
  redraftCorePosTone,
  seasonRaceOrdinal,
  seasonRaceRank,
} from '@/lib/core-app/redraftCoreMyTeam'
import { statusShorthand } from '@/lib/core-app/myTeamStatusShorthand'

describe('redraftCorePosTone — the same letters mean different jobs by sport', () => {
  it('C is a centre in the NBA and NHL and a catcher in MLB — three different tones', () => {
    expect(redraftCorePosTone('NBA', 'C')).toBe('amber')
    expect(redraftCorePosTone('NHL', 'C')).toBe('blue')
    expect(redraftCorePosTone('MLB', 'C')).toBe('violet')
  })
  it('G is a guard in the NBA and a goalie in the NHL', () => {
    expect(redraftCorePosTone('NBA', 'G')).toBe('blue')
    expect(redraftCorePosTone('NHL', 'G')).toBe('red')
  })
  it('DEF is a team defence in the NFL and a defender in soccer', () => {
    expect(redraftCorePosTone('NFL', 'DEF')).toBe('slate')
    expect(redraftCorePosTone('SOCCER', 'DEF')).toBe('blue')
  })
  it('SF is a small forward in the NBA and a superflex slot in the NFL', () => {
    expect(redraftCorePosTone('NBA', 'SF')).toBe('green')
    expect(redraftCorePosTone('NFL', 'SF')).toBe('flex')
  })
  it('flex / util slots read as flex; bench and reserve labels are common to every sport', () => {
    expect(redraftCorePosTone('NFL', 'FLEX')).toBe('flex')
    expect(redraftCorePosTone('NBA', 'UTIL')).toBe('flex')
    expect(redraftCorePosTone('MLB', 'BN')).toBe('bench')
    expect(redraftCorePosTone('NHL', 'IR')).toBe('ir')
    expect(redraftCorePosTone('MLB', 'IL')).toBe('ir')
  })
  it('case and whitespace do not matter', () => {
    expect(redraftCorePosTone('nfl', ' qb ')).toBe('red')
  })
  it('null when the sport does not use the label, the sport is unknown, or there is no label', () => {
    expect(redraftCorePosTone('NCAAF', 'DEF')).toBeNull()
    expect(redraftCorePosTone('NBA', 'QB')).toBeNull()
    expect(redraftCorePosTone('CRICKET', 'QB')).toBeNull()
    expect(redraftCorePosTone(null, 'QB')).toBeNull()
    expect(redraftCorePosTone('NFL', '')).toBeNull()
  })
  it('pins the tone tables so a drift from PR #3101 redraftPositionTone shows up here', () => {
    const nfl = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX'].map((p) => redraftCorePosTone('NFL', p))
    expect(nfl).toEqual(['red', 'green', 'blue', 'amber', 'violet', 'slate', 'flex'])
    const mlb = ['C', '1B', 'SS', 'OF', 'SP', 'RP', 'DH'].map((p) => redraftCorePosTone('MLB', p))
    expect(mlb).toEqual(['violet', 'green', 'green', 'blue', 'red', 'amber', 'flex'])
  })
})

describe('lineupPeriodLabel — the period the outlook priced, never the clock', () => {
  it('a daily period names its day, in UTC so an Eastern day key cannot shift', () => {
    expect(lineupPeriodLabel({ kind: 'day', day: '2026-10-30', week: 4 })).toBe('Fri, Oct 30')
  })
  it('a weekly period gives its week number', () => {
    expect(lineupPeriodLabel({ kind: 'week', day: null, week: 5 })).toBe('5')
  })
  it('null with no period, a malformed day, or no week — dropped, not guessed', () => {
    expect(lineupPeriodLabel(null)).toBeNull()
    expect(lineupPeriodLabel(undefined)).toBeNull()
    expect(lineupPeriodLabel({ kind: 'day', day: null, week: 4 })).toBeNull()
    expect(lineupPeriodLabel({ kind: 'day', day: 'tomorrow', week: 4 })).toBeNull()
    expect(lineupPeriodLabel({ kind: 'week', day: null, week: null })).toBeNull()
    expect(lineupPeriodLabel({ kind: 'week', day: null, week: 0 })).toBeNull()
  })
})

describe('noGameBadge', () => {
  it('day → off day, week → idle, anything else → nothing', () => {
    expect(noGameBadge('day')).toBe('offday')
    expect(noGameBadge('week')).toBe('idle')
    expect(noGameBadge(undefined)).toBeNull()
    expect(noGameBadge(null)).toBeNull()
  })
})

describe('seasonRaceRank — place BY RECORD, only when every team in the week has one', () => {
  const rec = (w: number, l: number, t = 0) => ({ wins: w, losses: l, ties: t })
  const records = { a: rec(6, 2), b: rec(6, 2), c: rec(5, 3), d: rec(2, 6) }
  it('ranks by win percentage, a tie said as a tie', () => {
    expect(seasonRaceRank(records, 'a', ['b', 'c', 'd'])).toEqual({ rank: 1, of: 4, tied: true })
    expect(seasonRaceRank(records, 'c', ['a', 'b', 'd'])).toEqual({ rank: 3, of: 4, tied: false })
    expect(seasonRaceRank(records, 'd', ['a', 'b', 'c'])).toEqual({ rank: 4, of: 4, tied: false })
  })
  it('a tie counts half a win', () => {
    expect(seasonRaceRank({ a: rec(5, 2, 1), b: rec(5, 3) }, 'a', ['b'])).toEqual({ rank: 1, of: 2, tied: false })
  })
  it('a team in the week with no record drops the whole rank — never "1st of 4" in a 12-team league', () => {
    expect(seasonRaceRank(records, 'a', ['b', 'c', 'd', 'e'])).toBeNull()
  })
  it('no record for you, no roster id, or nobody else → null', () => {
    expect(seasonRaceRank(records, 'zz', ['a'])).toBeNull()
    expect(seasonRaceRank(records, null, ['a'])).toBeNull()
    expect(seasonRaceRank(records, 'a', [])).toBeNull()
    expect(seasonRaceRank({ a: rec(0, 0), b: rec(1, 0) }, 'a', ['b'])).toBeNull()
  })
  it('duplicates and blanks in the slate are ignored', () => {
    expect(seasonRaceRank(records, 'a', ['b', 'b', null, '', 'a'])).toEqual({ rank: 1, of: 2, tied: true })
  })
  it('ordinals', () => {
    expect(seasonRaceOrdinal({ rank: 1, of: 10, tied: false })).toBe('1st')
    expect(seasonRaceOrdinal({ rank: 2, of: 10, tied: false })).toBe('2nd')
    expect(seasonRaceOrdinal({ rank: 3, of: 10, tied: true })).toBe('T-3rd')
    expect(seasonRaceOrdinal({ rank: 11, of: 12, tied: false })).toBe('11th')
    expect(seasonRaceOrdinal({ rank: 12, of: 12, tied: false })).toBe('12th')
  })
})

describe('statusShorthand — what NBA / NHL / MLB feeds send', () => {
  it.each([
    ['Day-To-Day', 'DTD', 'warn'],
    ['day to day', 'DTD', 'warn'],
    ['Game-Time Decision', 'GTD', 'warn'],
    ['GTD', 'GTD', 'warn'],
    ['10-Day IL', 'IL', 'bad'],
    ['60-day IL', 'IL', 'bad'],
    ['Injured List', 'IL', 'bad'],
    ['IL15', 'IL', 'bad'],
  ])('%s → %s (%s)', (input, short, tone) => {
    expect(statusShorthand(input)).toMatchObject({ short, tone })
  })
  it.each([
    ['Questionable', 'Q', 'warn'],
    ['Doubtful', 'D', 'bad'],
    ['Out', 'O', 'bad'],
    ['Injured Reserve', 'IR', 'bad'],
    ['Inactive', 'INA', 'bad'],
    ['Active', 'H', 'ok'],
    ['Probable', 'P', 'ok'],
    ['Suspended', 'SUS', 'bad'],
  ])('unchanged for the football designations: %s → %s', (input, short, tone) => {
    expect(statusShorthand(input)).toMatchObject({ short, tone })
  })
  it('an unfamiliar word is shown as-is, never given an invented letter — and "civil" is not IL', () => {
    expect(statusShorthand('Personal')).toMatchObject({ short: 'PER', tone: 'none' })
    expect(statusShorthand('Civil')).toMatchObject({ short: 'CIV', tone: 'none' })
  })
})

describe('af-core-redraft-myteam.css — gated on the shell stamp', () => {
  const css = readFileSync(join(process.cwd(), 'components/core-app/af-core-redraft-myteam.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  /** A selector list split on its TOP-LEVEL commas — `:is(a,b)` is one selector, not two. */
  const splitTopLevel = (list: string) => {
    const out: string[] = []
    let depth = 0
    let cur = ''
    for (const ch of list) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
    }
    out.push(cur)
    return out
  }
  /** Every selector list in the file, @media wrappers unwrapped. */
  const selectors = [...css.replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap((m) => splitTopLevel(m[1]))
    .map((s) => s.trim())
    .filter(Boolean)
  /** The two rules that HIDE the new elements outside the stamp — the only unscoped ones allowed. */
  const HIDE_ONLY = ['.af-mt-period', '.af-wl-race', '.af-mt-total', '.af-mt-check-icon']

  it('finds the rules at all (a renamed file would otherwise pass trivially)', () => {
    expect(selectors.length).toBeGreaterThan(40)
  })
  it('every selector is under .af-core.af-shell[data-format=redraft], except the hide-only rules', () => {
    const unscoped = selectors.filter((s) => !s.includes('.af-core.af-shell[data-format=redraft]') && !HIDE_ONLY.includes(s))
    expect(unscoped).toEqual([])
  })
  it('the unscoped rules only hide', () => {
    for (const sel of HIDE_ONLY) {
      const body = css.match(new RegExp(`(^|\\})\\s*${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[2]?.trim()
      expect(body).toBe('display:none')
    }
  })
  it('no hex and no rgba() literal — tokens only', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/rgba?\(/)
  })
  it('exactly one top-level @media block, at depth 0 (CLAUDE.md, af-matchup.css 2026-08-30)', () => {
    const medias = [...css.matchAll(/@media/g)]
    expect(medias.length).toBe(1)
    const depth = css.slice(0, medias[0].index).split('{').length - css.slice(0, medias[0].index).split('}').length
    expect(depth).toBe(0)
  })
  it('a position tone base rule never sets --rd-pos itself (it outranked every per-tone rule once)', () => {
    const base = css.match(/\.af-mt-slot\[data-rd-pos\]\{([^}]*)\}/)?.[1] ?? ''
    expect(base).toContain('color:')
    expect(base).not.toMatch(/--rd-pos\s*:/)
  })
})
