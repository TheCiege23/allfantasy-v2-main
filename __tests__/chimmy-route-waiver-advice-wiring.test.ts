// @vitest-environment node
/**
 * The Chimmy chat route wires the waiver bridge's claims into Chimmy advice (user decision
 * 2026-09-14: waiver claims only).
 *
 * ⚠ A SOURCE CONTRACT, AND WHY. No suite exercises the grounding branch of this ~2,000-line route
 * (it is behind DECISION_OS_GROUNDING_ENABLED and a proved league membership), so deleting the
 * sink would leave every behavioural test green. The recorder and the bridge sink are tested for
 * behaviour elsewhere; this pins the lines that connect them.
 *
 * 🛑 THE CONTRACT CHANGED 2026-09-16 (Chimmy item 10). It used to record fire-and-forget INSIDE the
 * grounding call, which ran before the token-spend confirmation, recorded advice from packets that
 * had timed out, and stored the engine's confidence. The claims are now only HELD there, and
 * recorded after the answer exists.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(path.join(process.cwd(), 'app/api/chat/chimmy/route.ts'), 'utf8')

describe('Chimmy route → waiver advice wiring', () => {
  it('imports the recorder', () => {
    expect(src).toMatch(/import \{ recordChatWaiverAdvice \} from '@\/lib\/chimmy-advice\/chatWaiverAdvice'/)
  })

  it('only HOLDS the claims inside the grounding call — no recording there', () => {
    const call = src.slice(src.indexOf('withPacketCeiling(buildDecisionOsGroundingPacket({'))
    const args = call.slice(0, call.indexOf('.then((packet)'))
    expect(args).toMatch(/onWaiverClaims: \(claims\) => \{\s*waiverClaimsSeen\.claims = claims\s*\}/)
    expect(args).not.toMatch(/recordChatWaiverAdvice/)
  })

  it('🛑 records once, after the unconfirmed-spend return, only when the packet was used', () => {
    const recordAt = src.indexOf('recordChatWaiverAdvice({')
    const confirmAt = src.indexOf("code: 'token_confirmation_required'")
    expect(confirmAt).toBeGreaterThan(-1)
    expect(recordAt).toBeGreaterThan(confirmAt)

    const guard = src.slice(recordAt - 300, recordAt)
    expect(guard).toMatch(/if \(waiverClaimsSeen\.claims && grounding\.outcome === 'ok' && leagueSnapshot\)/)

    const call = src.slice(recordAt, src.indexOf('})', recordAt) + 2)
    expect(call).toContain('leagueId: leagueSnapshot.id')
    expect(call).toContain('claims: waiverClaimsSeen.claims')
    // The confidence the user was SHOWN (`meta.confidencePct` is this same value).
    expect(call).toContain('confidencePct: pecrOutput.responseContract.confidence ?? null')
    expect(call).toContain('answer: assistantResponse')
  })

  it('the recorder is called in exactly one place', () => {
    // The import, the holder's type, and the one call.
    expect(src.match(/recordChatWaiverAdvice/g)).toHaveLength(3)
    expect(src.match(/recordChatWaiverAdvice\(\{/g)).toHaveLength(1)
  })
})

/*
 * Chimmy item 10: the drawer's "Did it / Not doing it" buttons need the key of the advice this
 * answer put on file, and the confidence shown needs Chimmy's track record.
 */
describe('Chimmy route → outcome loop wiring', () => {
  it('puts the recorded advice on meta before the response is sent', () => {
    const recordAt = src.indexOf('recordChatWaiverAdvice({')
    const call = src.slice(recordAt, src.indexOf('})', recordAt) + 2)
    expect(call).toMatch(/onRecorded: \(advice\) => \{\s*meta\.advice = \{ key: advice\.key, type: 'add', playerName: advice\.playerName \}/)

    // The recorder runs inside persistTasks, which are awaited before the response carries `meta`.
    const settledAt = src.indexOf('await Promise.allSettled(persistTasks)', recordAt)
    const sentAt = src.indexOf('meta,', settledAt)
    expect(settledAt).toBeGreaterThan(recordAt)
    expect(sentAt).toBeGreaterThan(settledAt)
    expect(src.slice(settledAt, sentAt)).toContain('return NextResponse.json(')
  })

  it('declares the advice slot on meta, empty until something is recorded', () => {
    const metaAt = src.indexOf('const meta = {')
    expect(metaAt).toBeGreaterThan(-1)
    expect(src.slice(metaAt, metaAt + 1200)).toMatch(/advice: undefined as \{ key: string; type: 'add'; playerName: string \} \| undefined/)
  })

  it('passes the track record into the answer contract', () => {
    expect(src).toMatch(/const trackRecords = trackRecordsFrom\(await readAdviceLearningSnapshot\(\)\)/)
    const buildAt = src.indexOf('buildChimmyAnswerContract({')
    const args = src.slice(buildAt, src.indexOf('})', buildAt))
    expect(args).toMatch(/\btrackRecords,/)
    expect(src.indexOf('const trackRecords =')).toBeLessThan(buildAt)
  })
})
