// @vitest-environment node
/**
 * The Chimmy chat route wires the waiver bridge's claims into Chimmy advice (user decision
 * 2026-09-14: waiver claims only).
 *
 * ⚠ A SOURCE CONTRACT, AND WHY. No suite exercises the grounding branch of this ~2,000-line route
 * (it is behind DECISION_OS_GROUNDING_ENABLED and a proved league membership), so deleting the
 * sink would leave every behavioural test green. The recorder and the bridge sink are tested for
 * behaviour elsewhere; this pins the one line that connects them, and that it stays fire-and-forget
 * inside the grounding call rather than awaited in the turn.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(path.join(process.cwd(), 'app/api/chat/chimmy/route.ts'), 'utf8')

describe('Chimmy route → waiver advice wiring', () => {
  it('imports the recorder', () => {
    expect(src).toMatch(/import \{ recordChatWaiverAdvice \} from '@\/lib\/chimmy-advice\/chatWaiverAdvice'/)
  })

  it('🛑 passes onWaiverClaims into buildDecisionOsGroundingPacket, recording fire-and-forget with the proved league id', () => {
    const call = src.slice(src.indexOf('withPacketCeiling(buildDecisionOsGroundingPacket({'))
    const args = call.slice(0, call.indexOf('.then((packet)'))
    expect(args).toMatch(
      /onWaiverClaims: \(claims, confidencePct\) => \{\s*void recordChatWaiverAdvice\(\{ userId, leagueId: leagueSnapshot\.id, claims, confidencePct \}\)\.catch\(\(\) => \{\}\)\s*\}/,
    )
  })

  it('the recorder is referenced nowhere else in the route (never awaited in the turn)', () => {
    expect(src.match(/recordChatWaiverAdvice/g)).toHaveLength(2)
    expect(src).not.toMatch(/await recordChatWaiverAdvice/)
  })
})
