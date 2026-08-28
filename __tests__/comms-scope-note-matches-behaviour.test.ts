import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DRAWER = fs.readFileSync(
  path.join(process.cwd(), 'components', 'core-app', 'comms', 'CommsDrawer.tsx'),
  'utf8',
)
const TOOLS = fs.readFileSync(
  path.join(process.cwd(), 'lib', 'chimmy', 'tools', 'chimmyTools.ts'),
  'utf8',
)

/**
 * ⚠ THE SCOPE CHIP IS A DEFAULT, NOT A FENCE, AND THE COPY SAID OTHERWISE.
 *
 * Observed in production: scoped to KBFL, asked "who can I pick up in the zombie
 * league?", Chimmy answered about Beta 1 Zombie League — correctly.
 * `find_league_by_name` rebinds the scope after verifying membership, because a
 * league named in the question is a clearer signal than a chip left selected
 * from an earlier one.
 *
 * The behaviour is right; the sentence under the chips claimed the opposite.
 */
describe('the scope note describes what actually happens', () => {
  it('no longer promises a fence it does not build', () => {
    expect(DRAWER).not.toContain('are grounded in ${scope.name} only')
  })

  it('says the scope is a default', () => {
    expect(DRAWER).toMatch(/Answers default to \$\{scope\.name\}/)
  })

  /* The "All leagues" line already advertised this; the scoped one now agrees. */
  it('teaches the override the same way both lines do', () => {
    expect(DRAWER).toMatch(/Name another of your leagues in the question/)
    expect(DRAWER).toContain('Ask about one by name, or pick it above.')
  })
})

describe('the override the copy now promises is real', () => {
  /*
   * ⚠ MEMBERSHIP IS VERIFIED BEFORE THE REBIND. This is the whole reason a
   * model-supplied league name is safe to honour — no id crosses the model
   * boundary, and the tool resolves the name against the user's own leagues.
   */
  it('rebinds scope only through find_league_by_name', () => {
    expect(TOOLS).toMatch(/ctx\.leagueId = found\.league\.id/)
    const rebinds = TOOLS.match(/ctx\.leagueId\s*=/g) ?? []
    expect(rebinds).toHaveLength(1)
  })

  it('keeps the resolver free of a caller-supplied league id', () => {
    const spec = TOOLS.slice(TOOLS.indexOf("name: 'find_league_by_name'"), TOOLS.indexOf("name: 'get_available_players'"))
    expect(spec).not.toMatch(/leagueId/)
  })
})
