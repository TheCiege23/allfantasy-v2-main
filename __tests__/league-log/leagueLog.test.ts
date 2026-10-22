import { describe, expect, it } from 'vitest'
import {
  describeLogEntry,
  LOG_ACTIONS,
  MEMBER_LOG_ACTION_TYPES,
  parseLeagueLogVisibility,
  readLeagueLogVisibility,
  rosterIdsNamedBy,
  userIdsNamedBy,
  type AuditRow,
  type LogNames,
} from '@/lib/league-log/leagueLog'

const names: LogNames = { users: { u1: 'Coach Dee', m2: 'Riley' }, teams: { r9: 'Taco Tuesday' } }

function row(over: Partial<AuditRow>): AuditRow {
  return {
    id: 'a1',
    actionType: 'settings_patch',
    entityId: null,
    userId: 'u1',
    beforeState: null,
    afterState: null,
    metadata: null,
    createdAt: new Date('2026-10-20T12:00:00Z'),
    ...over,
  }
}

const member = { lang: 'en' as const, names, forCommissioner: false }
const commish = { lang: 'en' as const, names, forCommissioner: true }

describe('visibility setting', () => {
  it('defaults to visible to the league and reads only the two known values', () => {
    expect(readLeagueLogVisibility(null)).toBe('league')
    expect(readLeagueLogVisibility({})).toBe('league')
    expect(readLeagueLogVisibility({ league_log_visibility: 'commish_only' })).toBe('commish_only')
    expect(readLeagueLogVisibility({ league_log_visibility: 'private' })).toBe('league')
  })

  it('refuses an unknown value on save', () => {
    expect(parseLeagueLogVisibility('commish_only')).toEqual({ ok: true, value: 'commish_only' })
    expect(parseLeagueLogVisibility('league')).toEqual({ ok: true, value: 'league' })
    expect(parseLeagueLogVisibility('private').ok).toBe(false)
    expect(parseLeagueLogVisibility(undefined).ok).toBe(false)
  })
})

describe('what a member sees', () => {
  it('a sentence, never the raw row', () => {
    const e = describeLogEntry(
      row({ actionType: 'settings_patch', metadata: { section: 'scoring', updatedFields: ['secret_field'] }, afterState: { sealed: 'x' } }),
      member,
    )
    expect(e).toMatchObject({ title: 'Changed the scoring settings', actor: 'Coach Dee', category: 'settings' })
    expect(e?.raw).toBeUndefined()
    expect(JSON.stringify(e)).not.toContain('secret_field')
    expect(JSON.stringify(e)).not.toContain('sealed')
  })

  it('nothing at all for an action type the log does not word for members', () => {
    expect(describeLogEntry(row({ actionType: 'survivor_idol_draw', afterState: { holder: 'm2' } }), member)).toBeNull()
    expect(describeLogEntry(row({ actionType: 'waiver_process_run' }), member)).toBeNull()
    expect(describeLogEntry(row({ actionType: 'dispute_filed' }), member)).toBeNull()
  })

  it('every member-visible type is worded, and only those are', () => {
    for (const t of MEMBER_LOG_ACTION_TYPES) {
      expect(LOG_ACTIONS[t]?.members).toBe(true)
      expect(describeLogEntry(row({ actionType: t }), member)?.title).toBeTruthy()
    }
    expect(MEMBER_LOG_ACTION_TYPES).not.toContain('dispute_filed')
    expect(MEMBER_LOG_ACTION_TYPES).not.toContain('finance_payout_requested')
  })

  it('a score adjustment names the team, the points, the week and the reason', () => {
    const e = describeLogEntry(
      row({
        actionType: 'score_adjustment_added',
        metadata: { rosterId: 'r9', week: 7, matchupId: 'mx' },
        afterState: { points: -4.5, reason: 'Stat correction from the league office' },
      }),
      member,
    )
    expect(e?.title).toBe("Adjusted Taco Tuesday's score by -4.5 in week 7")
    expect(e?.detail).toBe('Stat correction from the league office')
  })

  it('a dues line says who, never how much', () => {
    const e = describeLogEntry(row({ actionType: 'finance_dues_manual', afterState: { targetUserId: 'm2', amountCents: 5000 } }), member)
    expect(e?.title).toBe("Marked Riley's dues as paid")
    expect(JSON.stringify(e)).not.toContain('5000')
  })

  it('a ruling says one was made, not what the case was', () => {
    const e = describeLogEntry(row({ actionType: 'dispute_ruled', afterState: { body: 'private complaint text' } }), member)
    expect(e?.title).toBe('Ruled on a dispute')
    expect(JSON.stringify(e)).not.toContain('private complaint')
  })

  it('falls back to neutral words when a name is unknown, and names automation as AllFantasy', () => {
    const e = describeLogEntry(row({ actionType: 'commissioner_edit_faab', entityId: 'gone', userId: null, afterState: { faabRemaining: 40 } }), member)
    expect(e?.title).toBe("Set a team's FAAB to $40")
    expect(e?.actor).toBe('AllFantasy (automatic)')
  })

  it('speaks Spanish', () => {
    const e = describeLogEntry(row({ actionType: 'league_lock_toggle', afterState: { locked: true } }), { ...member, lang: 'es' })
    expect(e?.title).toBe('Bloqueó la liga')
  })
})

describe('what a commissioner sees', () => {
  it('every row, unknown types by name, with the raw row attached', () => {
    const e = describeLogEntry(row({ actionType: 'survivor_idol_draw', afterState: { holder: 'm2' } }), commish)
    expect(e?.title).toBe('survivor idol draw')
    expect(e?.category).toBeNull()
    expect(e?.raw).toEqual({ actionType: 'survivor_idol_draw', beforeState: null, afterState: { holder: 'm2' }, metadata: null })
  })
})

describe('names to look up', () => {
  it('collects the rosters and users a page of rows mentions', () => {
    const rows = [
      row({ actionType: 'score_adjustment_added', metadata: { rosterId: 'r1' } }),
      row({ actionType: 'commissioner_edit_waiver_priority', entityId: 'r2', userId: 'u2' }),
      row({ actionType: 'finance_dues_waived', afterState: { targetUserId: 'm3' }, userId: null }),
      row({ actionType: 'settings_patch', entityId: 'league-id' }),
    ]
    expect(rosterIdsNamedBy(rows).sort()).toEqual(['r1', 'r2'])
    expect(userIdsNamedBy(rows).sort()).toEqual(['m3', 'u1', 'u2'])
  })
})
