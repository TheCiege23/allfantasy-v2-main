import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The drawer is a large client component and rendering it needs the whole comms
 * stack, so this asserts the SOURCE — which is where the defect was. A non-admin
 * account asking an ordinary question saw the literal string
 * "VERIFICATION_REQUIRED Nothing was charged.": an internal constant, in red,
 * with no hint that verifying an email would fix it.
 */
const SRC = fs.readFileSync(
  path.join(process.cwd(), 'components', 'core-app', 'comms', 'CommsDrawer.tsx'),
  'utf8',
)

describe('chimmy error copy', () => {
  it('never throws the raw API error code at the reader', () => {
    expect(SRC).not.toContain("new Error(payload.error ?? ")
    expect(SRC).toContain('describeChimmyError(payload.error)')
  })

  /*
   * The point is not politeness. An unverified user cannot use Chimmy at all,
   * and the old message gave them no reason to believe verifying would change
   * that — it read as a crash rather than a door.
   */
  it('tells a blocked user what to actually do', () => {
    const start = SRC.indexOf('CHIMMY_ERROR_COPY')
    const block = SRC.slice(start, start + 1200)

    expect(block).toContain('VERIFICATION_REQUIRED')
    expect(block).toMatch(/verify/i)
    expect(block).toContain('AGE_REQUIRED')
    expect(block).toContain('insufficient_token_balance')
  })

  /*
   * ⚠ A BLANKET "Nothing was charged." WAS A CLAIM WE COULD NOT BACK.
   * app/api/chat/chimmy/route.ts returns a 500 AFTER the token spend, so a
   * charged request could report itself as free.
   */
  it('does not promise every failure was free', () => {
    expect(SRC).not.toContain('{error} Nothing was charged.')
  })

  /* An unmapped code must still degrade to a sentence, not a constant. */
  it('keeps a fallback for codes nobody has mapped yet', () => {
    const start = SRC.indexOf('function describeChimmyError')
    const fn = SRC.slice(start, start + 900)

    expect(fn).toContain('Chimmy could not answer that.')
    /* SCREAMING_SNAKE and lower_snake are internal identifiers by definition. */
    expect(fn).toMatch(/A-Z0-9_/)
  })
})
