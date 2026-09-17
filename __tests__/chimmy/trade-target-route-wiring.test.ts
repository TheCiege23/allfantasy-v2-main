import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Where the trade-target verdict sits in `/api/chat/chimmy`, asserted against the route source —
 * the same source-shape approach as `chimmy-tool-loop-route-wiring.test.ts`, for the same reason:
 * the properties that matter are positional (before the model, after the spend) and a refactor
 * breaks them silently.
 */
const ROUTE = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'chat', 'chimmy', 'route.ts'), 'utf8')
const idx = (needle: string) => {
  const at = ROUTE.indexOf(needle)
  if (at < 0) throw new Error(`route no longer contains: ${needle}`)
  return at
}

const DETERMINISTIC_AT = idx('const deterministic = await tryDeterministicAnswerDetailed(')
const VERDICT_AT = idx('await buildTradeTargetVerdict(')
const UNRESOLVED_RETURN_AT = idx("if (tradeTargetResult?.status === 'unresolved')")
const MAIN_SPEND_PREVIEW_AT = idx("tokenPreview = await spendService.previewSpend(userId, 'ai_chimmy_chat_message', userEmail)")
/* The main charge: the first spend call after the main preview (the live-search one sits far above). */
const MAIN_SPEND_AT = ROUTE.indexOf('await spendService.spendTokensForRule(', MAIN_SPEND_PREVIEW_AT)
/* The unconfirmed-request refusal that follows the main preview. */
const CONFIRMATION_REFUSAL_AT = ROUTE.indexOf("code: 'token_confirmation_required'", MAIN_SPEND_PREVIEW_AT)
const DECIDED_RETURN_AT = idx("if (tradeTargetResult?.status === 'decided')")
const LOOP_AT = idx('if (chimmyToolLoopEnabled)')
const PECR_AT = idx('const pecrResult = await runPECR')

describe('the trade-target verdict in the chat route', () => {
  it('runs after the price shortcut, which now steps aside for it', () => {
    expect(DETERMINISTIC_AT).toBeLessThan(VERDICT_AT)
  })

  it('🛑 reads the MEMBERSHIP-PROVEN league, never the raw request field', () => {
    const call = ROUTE.slice(VERDICT_AT, ROUTE.indexOf('})', VERDICT_AT) + 2)
    expect(call).toMatch(/leagueId:\s*leagueSnapshot\.id/)
    expect(call).not.toMatch(/leagueId:\s*leagueId\b/)
  })

  it('only parses the question when a proven league is in scope', () => {
    expect(ROUTE).toMatch(/const tradeTargetQuestion = leagueSnapshot \? parseTradeTargetQuestion\(message\) : null/)
  })

  it('is computed AFTER the confirmation check — the drawer sends every paid question twice', () => {
    expect(VERDICT_AT).toBeGreaterThan(CONFIRMATION_REFUSAL_AT)
  })

  it('an unresolved read returns FREE, before anything is charged', () => {
    expect(UNRESOLVED_RETURN_AT).toBeGreaterThan(CONFIRMATION_REFUSAL_AT)
    expect(UNRESOLVED_RETURN_AT).toBeLessThan(MAIN_SPEND_AT)
    const block = ROUTE.slice(UNRESOLVED_RETURN_AT, ROUTE.indexOf('let spendLedger', UNRESOLVED_RETURN_AT))
    expect(block).toMatch(/free:\s*true/)
    expect(block).not.toMatch(/tokenSpend/)
  })

  it('a decided verdict is returned only AFTER the spend settles', () => {
    expect(MAIN_SPEND_AT).toBeGreaterThan(MAIN_SPEND_PREVIEW_AT)
    expect(DECIDED_RETURN_AT).toBeGreaterThan(MAIN_SPEND_AT)
    const block = ROUTE.slice(DECIDED_RETURN_AT, LOOP_AT)
    expect(block).toMatch(/tokenSpend:/)
    expect(block).toMatch(/spendLedger/)
  })

  it('🛑 and BEFORE any model can answer the same question', () => {
    expect(DECIDED_RETURN_AT).toBeLessThan(LOOP_AT)
    expect(DECIDED_RETURN_AT).toBeLessThan(PECR_AT)
    // The verdict's text is the rendered decision — no model output is involved on this path.
    const block = ROUTE.slice(DECIDED_RETURN_AT, LOOP_AT)
    expect(block).toMatch(/renderTradeTargetVerdict\(v\)/)
    expect(block).toMatch(/grok:\s*'skipped'/)
  })

  it('tells the drawer which league the answer was about, on both returns', () => {
    expect(ROUTE.slice(UNRESOLVED_RETURN_AT, MAIN_SPEND_AT)).toMatch(/leagueGrounding: tradeTargetGrounding/)
    expect(ROUTE.slice(DECIDED_RETURN_AT, LOOP_AT)).toMatch(/leagueGrounding: tradeTargetGrounding/)
  })
})
