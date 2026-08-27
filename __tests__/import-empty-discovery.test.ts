/**
 * "I click connect yahoo and nothing happens."
 *
 * Yahoo was connected the whole time and the button did exactly what it was
 * written to do: it ran discovery, Yahoo answered with an empty collection, and
 * the success branch cleared the error, set an empty list and returned to idle.
 * The screen repainted identically. A working button, a valid token, and no way
 * for the person in front of it to learn any of that.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FILE = readFileSync(
  resolve(process.cwd(), 'components/core-app/screens/ImportV4.tsx'),
  'utf8',
).replace(/\r\n/g, '\n')

/** The screen's own rule for whether an error gets a "connect" action beside it. */
const NEEDS_SETUP = /\b(link|connect|reconnect)\b/i

/**
 * Only the sentences a user is shown — comments stripped first.
 *
 * The comment above the Sleeper branch explains why it must NOT offer a
 * "connect your accounts" link, and that explanation contains the very word
 * being tested for. Matching raw source would fail on the reasoning rather than
 * on the behaviour.
 */
function shownText(branch: string): string {
  return branch.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const FN = FILE.slice(FILE.indexOf('function emptyDiscoveryMessage'))
const YAHOO = FN.slice(FN.indexOf("provider === 'yahoo'"), FN.indexOf("provider === 'sleeper'"))
const SLEEPER = FN.slice(FN.indexOf("provider === 'sleeper'"), FN.indexOf('return \'The lookup worked'))

describe('⚠ an empty result is reported, not swallowed', () => {
  it('sets a message when the lookup succeeds with no leagues', () => {
    expect(FILE).toContain('if (found.length === 0) setError(emptyDiscoveryMessage(provider))')
  })

  it('says why the blank screen was the worst option', () => {
    expect(FILE).toContain('A LOOKUP THAT SUCCEEDED AND FOUND NOTHING USED TO RENDER AS NOTHING')
  })

  it('leaves the on-select lookup silent, which is a different question', () => {
    // Nobody asked it anything, so it has no answer to report — greeting someone
    // with an error on a screen they just opened is its own defect.
    expect(FILE).toContain('if (!payload?.leagues?.length) return')
    expect(FILE).toContain('ONLY ON THE EXPLICIT PRESS')
  })
})

describe('⚠ the message carries the action that resolves it', () => {
  it('gives Yahoo a reconnect, because the error panel keys off these words', () => {
    expect(NEEDS_SETUP.test(shownText(YAHOO))).toBe(true)
  })

  it('does NOT send a Sleeper typo to a connection screen', () => {
    /*
     * An empty Sleeper result is usually a misspelt username. Offering "connect
     * your accounts" there sends someone to repair a connection that is fine.
     */
    expect(NEEDS_SETUP.test(shownText(SLEEPER))).toBe(false)
  })
})

describe('⚠ it does not claim which cause it was', () => {
  it('names both readings of an empty Yahoo list', () => {
    /*
     * Yahoo answers an approval missing fantasy scope and an account with no
     * leagues the same way — an empty collection. The screen cannot tell them
     * apart, so it must not pick one.
     */
    const shown = shownText(YAHOO)
    expect(shown).toContain('did not include fantasy read access')
    expect(shown).toContain('different Yahoo account')
  })

  it('records that the ambiguity is deliberate', () => {
    expect(FILE).toContain('IT MUST NOT CLAIM WHICH CAUSE IT WAS')
  })
})

describe('⚠ the connected banner stops promising leagues it does not have', () => {
  it('distinguishes listed, looking, and none', () => {
    /*
     * The screenshot that opened this: "Yahoo is connected. Your Yahoo leagues
     * are listed below." above an empty list, with a button that appeared dead.
     * Two false statements and no action.
     */
    expect(FILE).toContain('Yahoo is connected. Your Yahoo leagues are listed below.')
    expect(FILE).toContain('Yahoo is connected. Looking up your leagues')
    expect(FILE).toContain('Yahoo is connected, but no leagues have come back yet.')
  })

  it('gates the "listed below" claim on there actually being some', () => {
    expect(FILE).toContain('{leagues.length > 0 ? (')
  })

  it('records why the old copy was worse than saying nothing', () => {
    expect(FILE).toContain('THIS SAID "YOUR LEAGUES ARE LISTED BELOW" WHETHER OR NOT ANY WERE')
  })
})
