/**
 * The words of an integrity alert on push, in-app and SMS (lib/integrity/alertCopy.ts).
 * Names go in the title because a lock screen cuts the body; the text message carries no emoji.
 */
import { describe, expect, it } from 'vitest'

import { assetList, buildIntegrityAlertCopy } from '@/lib/integrity/alertCopy'

const URL = 'https://allfantasy.ai/league/L1/commissioner/integrity?flag=f1'

const EVIDENCE = {
  team1: { rosterId: 'r1', teamName: '@lex' },
  team2: { rosterId: 'r2', teamName: '@pav' },
  assetsTeam1Gave: [{ name: 'R. Shaheed' }],
  assetsTeam2Gave: [{ name: 'B. Bowers' }, { name: '2027 1st' }],
  valueDifferentialPct: 62.9,
}

const base = {
  flagType: 'collusion' as const,
  managers: ['Alex Rivera', 'Pat Vance'],
  evidence: EVIDENCE,
  summary: 'Flagged for the commissioner: large value gap.',
  leagueName: 'Dynasty Bros',
  url: URL,
}

describe('collusion alert copy', () => {
  it('puts both managers in the title', () => {
    expect(buildIntegrityAlertCopy(base).title).toBe('⚠️ Possible collusion · Alex Rivera ↔ Pat Vance')
  })

  it('opens the body with what moved and the gap, then the note', () => {
    expect(buildIntegrityAlertCopy(base).body).toBe(
      'Alex Rivera got B. Bowers, 2027 1st for R. Shaheed · 63% value gap. Flagged for the commissioner: large value gap.',
    )
  })

  it('writes a short text with the league, the pair, the gap and the link — and no emoji', () => {
    const { sms } = buildIntegrityAlertCopy(base)
    expect(sms).toBe(
      `AllFantasy: Possible collusion in Dynasty Bros between Alex Rivera and Pat Vance, 63% value gap. Review: ${URL}`,
    )
    // GSM-7 only: anything outside it (emoji, ↔) switches the text to UCS-2 and halves a segment.
    expect(/[^\x20-\x7E\n]/.test(sms)).toBe(false)
  })

  it('falls back to team names when no manager resolved', () => {
    expect(buildIntegrityAlertCopy({ ...base, managers: [] }).title).toBe('⚠️ Possible collusion · @lex ↔ @pav')
  })

  it('keeps the plain wording when nobody can be named at all', () => {
    const copy = buildIntegrityAlertCopy({ ...base, managers: [], evidence: {} })
    expect(copy.title).toBe('⚠️ Potential collusion detected')
    expect(copy.body).toBe(base.summary)
    expect(copy.sms).toBe(`AllFantasy: A trade in Dynasty Bros was flagged for review. Review: ${URL}`)
  })

  it('leaves the gap out when there is none to report', () => {
    const copy = buildIntegrityAlertCopy({ ...base, evidence: { ...EVIDENCE, valueDifferentialPct: 0 } })
    expect(copy.body.startsWith('Alex Rivera got B. Bowers, 2027 1st for R. Shaheed. ')).toBe(true)
    expect(copy.sms).not.toContain('value gap')
  })
})

describe('tanking alert copy', () => {
  it('names the manager in the title and the text', () => {
    const copy = buildIntegrityAlertCopy({ ...base, flagType: 'tanking', managers: ['Alex Rivera'], evidence: { teamName: '@lex' } })
    expect(copy.title).toBe('⚠️ Possible tanking · Alex Rivera')
    expect(copy.sms).toBe(`AllFantasy: Possible tanking in Dynasty Bros by Alex Rivera. Review: ${URL}`)
  })
})

describe('assetList', () => {
  it('shows two names and counts the rest so a push line stays one line', () => {
    expect(assetList([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }])).toBe('A, B +2 more')
  })
})
