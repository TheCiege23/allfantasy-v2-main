// @vitest-environment node
/**
 * The Chimmy chat route hands the packet's trade letters to the answer check (Trade OS, 2026-11-20).
 *
 * ⚠ A SOURCE CONTRACT, for the reason `chimmy-route-waiver-advice-wiring.test.ts` gives: no suite exercises the
 * grounding branch of this route. The packet's `pendingTrades` slice grades the offers waiting on the asker; an answer
 * quoting one of those letters must pass `enforceTradeLetters`, which reads `toolContext.tradeGrades`. If the packet's
 * letters went anywhere else, a correct answer from the packet would be refused as an invented grade.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(path.join(process.cwd(), 'app/api/chat/chimmy/route.ts'), 'utf8')

describe('Chimmy route → packet trade grades', () => {
  it('the packet pushes each letter into one shared list', () => {
    const call = src.slice(src.indexOf('withPacketCeiling(buildDecisionOsGroundingPacket({'))
    const args = call.slice(0, call.indexOf('.then((packet)'))
    expect(args).toMatch(/onTradeGrade: \(grade\) => \{\s*packetTradeGrades\.push\(grade\)\s*\}/)
  })

  it('and the tool loop collects into that same list, which the letter check reads', () => {
    expect(src).toMatch(/^\s*const packetTradeGrades: ChimmyTradeGrade\[\] = \[\]/m)
    expect(src).toMatch(/^\s*const toolContext = \{[^\n]*tradeGrades: packetTradeGrades,/m)
    expect(src).toMatch(/grades: toolContext\.tradeGrades,/)
  })
})

describe('Chimmy route → the draft board slice', () => {
  it('is asked for on draft questions, but never from inside the draft room, which already hands the loop that board', () => {
    const call = src.slice(src.indexOf('withPacketCeiling(buildDecisionOsGroundingPacket({'))
    const args = call.slice(0, call.indexOf('.then((packet)'))
    expect(args).toMatch(/\.\.\.earlyWant,\s*(?:\/\/[^\n]*\n\s*)?draftBoard: earlyWant\.draftBoard && insightType !== 'draft',/)
    expect(src).toMatch(/const draftRoomBoard = insightType === 'draft' && leagueSnapshot && userId/)
  })
})
