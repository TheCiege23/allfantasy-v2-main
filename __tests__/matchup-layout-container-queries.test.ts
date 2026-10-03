// @vitest-environment node
/**
 * The matchup screens' layout keys on the space the SCREEN gets, not the window (2026-10-02 pass).
 *
 * 🛑 The phone rules keyed only on the viewport, while the shell's rail and nav take 288–532px of it.
 * Every tablet (781–1080) drew the desktop three-column banner in ~500–760px; 721–780 drew the phone
 * layout under a desktop shell with a full-width fixed scorebar over the rail. Pinned by each rule's
 * place in the parsed CSS — a rule in the wrong query reads the same to a text search.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Root, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const read = (f: string) => readFileSync(resolve(__dirname, '../components/core-app', f), 'utf8')
const MATCHUP = read('af-matchup.css')
const PULSE = read('af-matchup-pulse.css')
const LIVE = read('af-live.css')
const SHELL = read('af-core-shell.css')

type Found = { at: string; decls: Record<string, string> }
function rules(css: string, selector: string): Found[] {
  const out: Found[] = []
  postcss.parse(css).walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector)) return
    const at: string[] = []
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) at.push(`@${(p as AtRule).name} ${(p as AtRule).params}`)
    const decls: Record<string, string> = {}
    rule.walkDecls((d) => {
      decls[d.prop] = d.value
    })
    out.push({ at: at.join(' / '), decls })
  })
  return out
}
const inAt = (css: string, selector: string, at: string) => rules(css, selector).find((r) => r.at === at)

describe('no query is nested inside another (the af-matchup.css incident, CLAUDE.md)', () => {
  for (const [name, css] of [['af-matchup.css', MATCHUP], ['af-matchup-pulse.css', PULSE]] as const) {
    it(`${name}: every @media / @container is top-level`, () => {
      const nested: string[] = []
      ;(postcss.parse(css) as Root).walkAtRules((a) => {
        if ((a.name === 'media' || a.name === 'container') && a.parent?.type !== 'root') nested.push(a.params)
      })
      expect(nested).toEqual([])
    })
  }
})

describe('af-matchup.css keys on the matchup’s own width', () => {
  it('the matchup is a named inline-size container', () => {
    expect(inAt(MATCHUP, '.af-mu', '')?.decls.container).toBe('af-mu / inline-size')
  })

  it('🛑 the banner stacks to one column on a narrow MATCHUP, not only a narrow window', () => {
    expect(inAt(MATCHUP, '.af-mu-h2h', '@container af-mu (max-width: 760px)')?.decls['grid-template-columns']).toBe('minmax(0, 1fr)')
    /* The viewport rule stays as the fallback for a browser without container queries. */
    expect(inAt(MATCHUP, '.af-mu-h2h', '@media (max-width: 780px)')?.decls['grid-template-columns']).toBe('minmax(0, 1fr)')
  })

  it('🛑 the 36px score needs room in the MATCHUP — it is no longer a 1024px-window rule', () => {
    expect(inAt(MATCHUP, '.af-mu-score', '@container af-mu (min-width: 860px)')?.decls['font-size']).toBe('36px')
    expect(rules(MATCHUP, '.af-mu-score').some((r) => r.at.includes('min-width: 1024px'))).toBe(false)
  })

  it('🛑 the tablet scorebar sits over the matchup, and a phone goes full-bleed again', () => {
    const tablet = inAt(MATCHUP, '.af-mu-sticky', '@container af-mu (max-width: 760px)')?.decls
    expect(tablet?.left).toBe('var(--af-mu-sticky-left, 0px)')
    expect(tablet?.width).toBe('var(--af-mu-sticky-width, 100%)')
    expect(tablet?.right).toBe('auto')
    const phone = inAt(MATCHUP, '.af-mu-sticky', '@media (max-width: 720px)')?.decls
    expect(phone).toMatchObject({ left: '0', right: '0', width: 'auto' })
  })

  it('the phone full-bleed rule comes AFTER the container rule, so it wins on a phone', () => {
    const at = (needle: string) => MATCHUP.indexOf(needle)
    expect(at('@container af-mu (max-width: 760px)')).toBeGreaterThan(-1)
    expect(at('/* On a phone the shell is one column')).toBeGreaterThan(at('@container af-mu (max-width: 760px)'))
  })

  it('the two-row phone board and the name hit area follow the matchup too', () => {
    expect(inAt(MATCHUP, '.af-mu-board-row .af-mu-half', '@container af-mu (max-width: 540px)')?.decls.display).toBe('grid')
    expect(inAt(MATCHUP, '.af-mu-board-row .af-mu-half-name', '@container af-mu (max-width: 700px)')?.decls['padding-block']).toBe('11px')
  })

  it('a phone lineup name is 12px, the app’s floor', () => {
    expect(inAt(MATCHUP, '.af-mu-half-name', '@media (max-width: 780px)')?.decls['font-size']).toBe('12px')
    expect(inAt(MATCHUP, '.af-mu-half-name', '@container af-mu (max-width: 760px)')?.decls['font-size']).toBe('12px')
  })

  it('the provider buttons are a 44px target on touch', () => {
    expect(inAt(MATCHUP, '.af-core .af-btn.af-mu-source', '@media (pointer: coarse)')?.decls['min-height']).toBe('44px')
  })
})

describe('af-matchup-pulse.css keys on the board’s own width', () => {
  it('🛑 the two-up stacked grid needs a wide BOARD, not a wide window', () => {
    expect(inAt(PULSE, '.af-mp-cols[data-stack] .af-mp-rows', '@container af-board (min-width: 760px)')?.decls['grid-template-columns']).toBe(
      'repeat(2, minmax(0, 1fr))',
    )
    expect(rules(PULSE, '.af-mp-cols[data-stack] .af-mp-rows').some((r) => r.at.includes('min-width: 781px'))).toBe(false)
  })

  it('a narrow board stacks its columns and drops the crest', () => {
    expect(inAt(PULSE, '.af-mp-cols', '@container af-board (max-width: 760px)')?.decls['grid-template-columns']).toBe('minmax(0, 1fr)')
    expect(inAt(PULSE, '.af-mp-crest', '@container af-board (max-width: 760px)')?.decls.display).toBe('none')
  })

  it('platform initials are darkened for the light theme', () => {
    expect(inAt(PULSE, "html[data-mode='light'] .af-core .af-mp-face--none[data-platform='sleeper']", '')?.decls.color).toBe('#5b2fc9')
  })
})

describe('the Live strip and undefined tokens', () => {
  it('🛑 the leader’s score is chosen by data-side, never by :nth-of-type (which counts every span)', () => {
    expect(LIVE).not.toMatch(/af-live-matchup-score:nth-of-type/)
    expect(inAt(LIVE, ".af-live-matchup[data-lead='trail'] .af-live-matchup-score[data-side='them']", '')?.decls.color).toBe('var(--good)')
  })

  it('no token these files use is one defined nowhere', () => {
    for (const css of [MATCHUP, LIVE]) {
      expect(css).not.toMatch(/var\(--ink\)/)
      expect(css).not.toMatch(/var\(--af-good/)
      expect(css).not.toMatch(/var\(--af-border/)
    }
  })
})

describe('the shell honours a notch held sideways', () => {
  it('pads both side insets on the shell itself', () => {
    const shell = inAt(SHELL, '.af-shell', '')?.decls
    expect(shell?.['padding-left']).toBe('env(safe-area-inset-left, 0px)')
    expect(shell?.['padding-right']).toBe('env(safe-area-inset-right, 0px)')
  })
})
