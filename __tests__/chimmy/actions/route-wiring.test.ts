import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * How the confirm cards and the two new rules reach the chat, asserted on the route source (the
 * same approach as chimmy-tool-loop-route-wiring.test.ts: driving the route end to end needs a dozen
 * mocks, and these properties are structural). Anchored to code, not comments.
 */

const ROUTE = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'chat', 'chimmy', 'route.ts'), 'utf8')
const CODE = ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const LOOP = CODE.slice(CODE.indexOf('if (chimmyToolLoopEnabled)'), CODE.indexOf('const pecrResult = await runPECR'))

describe('confirm cards in the chat route', () => {
  it('gives the loop a card collector on the SAME tool context the loop is handed', () => {
    expect(LOOP).toMatch(/const toolContext = \{[^}]*actionCards: \[\] as ChimmyActionCard\[\][^}]*\}/)
    expect(LOOP).toMatch(/context:\s*toolContext\b/)
  })

  it('returns the collected cards in meta, only when there are some', () => {
    const answered = LOOP.slice(LOOP.indexOf('if (loop?.text)'))
    expect(answered).toMatch(/\.\.\.\(toolContext\.actionCards\.length > 0 \? \{ actionCards: toolContext\.actionCards \} : \{\}\)/)
  })

  it('tells the model it can read league chat but never private messages, and never acts without a tap', () => {
    expect(CODE).toMatch(/You can NEVER read direct messages, Huddles or any private conversation/)
    expect(CODE).toMatch(/These change NOTHING: they put a confirm card under your answer, and the move happens only if the user taps Confirm/)
    expect(CODE).toMatch(/NEVER say a lineup was set or a trade was sent/)
  })

  it('does not charge for the confirm tap: the confirm route never touches token spend', () => {
    const confirm = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'chimmy', 'actions', 'confirm', 'route.ts'), 'utf8')
    expect(confirm).not.toMatch(/spendTokens|TokenSpendService|previewSpend/)
    expect(confirm).toMatch(/confirmChimmyAction\(\{ token: body\?\.token, userId \}\)/)
  })
})
