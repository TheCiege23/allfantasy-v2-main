import { describe, expect, it } from 'vitest'
import {
  DISPUTES_SETTINGS_KEY,
  OPEN_PER_FILER_MAX,
  STORED_MAX,
  fileDispute,
  readDisputes,
  ruleDispute,
  rulingChatMessage,
  visibleDisputes,
  withDisputes,
  withdrawDispute,
  type LeagueDispute,
} from '@/lib/disputes/disputeStore'

const NOW = new Date('2026-10-19T12:00:00Z')
const filer = { filedByUserId: 'u-filer', filedByName: 'Filer' }

function filed(list: LeagueDispute[] = [], id = 'd1', extra: Record<string, unknown> = {}) {
  const r = fileDispute(list, { category: 'stat_correction', subject: '  Week 6 TD credited wrong  ', details: 'It was a rushing TD', ...filer, ...extra }, NOW, id)
  if (!r.ok) throw new Error(r.error)
  return r
}

describe('fileDispute', () => {
  it('trims the subject and opens the dispute', () => {
    const r = filed()
    expect(r.dispute).toMatchObject({ id: 'd1', subject: 'Week 6 TD credited wrong', status: 'open', ruling: null, createdAt: NOW.toISOString() })
    expect(r.disputes).toHaveLength(1)
  })

  it('requires a subject and a known category', () => {
    expect(fileDispute([], { category: 'trade', subject: '   ', details: '', ...filer }, NOW, 'x')).toEqual({ ok: false, error: 'subject_required' })
    expect(fileDispute([], { category: 'bribery', subject: 'x', details: '', ...filer }, NOW, 'x')).toEqual({ ok: false, error: 'invalid_category' })
  })

  it('caps open disputes per filer, and only open ones count', () => {
    let list: LeagueDispute[] = []
    for (let i = 0; i < OPEN_PER_FILER_MAX; i++) list = filed(list, `d${i}`).disputes
    expect(fileDispute(list, { category: 'other', subject: 'one more', details: '', ...filer }, NOW, 'dx')).toEqual({ ok: false, error: 'too_many_open' })
    // Someone else is not blocked by this filer's queue.
    expect(fileDispute(list, { category: 'other', subject: 'mine', details: '', filedByUserId: 'u-other', filedByName: null }, NOW, 'dy').ok).toBe(true)
    // Withdrawing one frees a slot.
    const w = withdrawDispute(list, 'd0', 'u-filer', NOW)
    if (!w.ok) throw new Error(w.error)
    expect(fileDispute(w.disputes, { category: 'other', subject: 'again', details: '', ...filer }, NOW, 'dz').ok).toBe(true)
  })
})

describe('ruleDispute', () => {
  it('records the ruling and closes the dispute', () => {
    const r = ruleDispute(filed().disputes, 'd1', { outcome: 'upheld', text: 'Stat provider corrected it', postToChat: true, ruledByUserId: 'u-commish', ruledByName: 'Commish' }, NOW)
    if (!r.ok) throw new Error(r.error)
    expect(r.dispute.status).toBe('ruled')
    expect(r.dispute.ruling).toMatchObject({ outcome: 'upheld', postedToChat: true, ruledByUserId: 'u-commish' })
    expect(rulingChatMessage(r.dispute)).toContain('Upheld: Stat provider corrected it')
  })

  it('needs a valid outcome and a reason', () => {
    const list = filed().disputes
    const base = { postToChat: false, ruledByUserId: 'c', ruledByName: null }
    expect(ruleDispute(list, 'd1', { ...base, outcome: 'maybe', text: 'x' }, NOW)).toEqual({ ok: false, error: 'invalid_outcome' })
    expect(ruleDispute(list, 'd1', { ...base, outcome: 'denied', text: '  ' }, NOW)).toEqual({ ok: false, error: 'ruling_required' })
    expect(ruleDispute(list, 'nope', { ...base, outcome: 'denied', text: 'x' }, NOW)).toEqual({ ok: false, error: 'not_found' })
  })

  it('cannot rule twice — a posted ruling is not rewritten', () => {
    const first = ruleDispute(filed().disputes, 'd1', { outcome: 'denied', text: 'No', postToChat: true, ruledByUserId: 'c', ruledByName: null }, NOW)
    if (!first.ok) throw new Error(first.error)
    expect(ruleDispute(first.disputes, 'd1', { outcome: 'upheld', text: 'Yes', postToChat: false, ruledByUserId: 'c', ruledByName: null }, NOW)).toEqual({ ok: false, error: 'not_open' })
  })
})

describe('withdrawDispute', () => {
  it('only the filer may withdraw, and only while open', () => {
    const list = filed().disputes
    expect(withdrawDispute(list, 'd1', 'u-someone', NOW)).toEqual({ ok: false, error: 'not_filer' })
    const w = withdrawDispute(list, 'd1', 'u-filer', NOW)
    if (!w.ok) throw new Error(w.error)
    expect(w.dispute.status).toBe('withdrawn')
    expect(withdrawDispute(w.disputes, 'd1', 'u-filer', NOW)).toEqual({ ok: false, error: 'not_open' })
  })
})

describe('visibility', () => {
  it('members see their own and rulings posted to chat; commissioners see all', () => {
    let list = filed([], 'mine').disputes
    list = filed(list, 'theirs', { filedByUserId: 'u-other' }).disputes
    list = filed(list, 'public', { filedByUserId: 'u-other' }).disputes
    list = filed(list, 'private-ruling', { filedByUserId: 'u-other' }).disputes
    const pub = ruleDispute(list, 'public', { outcome: 'partial', text: 'Half', postToChat: true, ruledByUserId: 'c', ruledByName: null }, NOW)
    if (!pub.ok) throw new Error(pub.error)
    const priv = ruleDispute(pub.disputes, 'private-ruling', { outcome: 'denied', text: 'No', postToChat: false, ruledByUserId: 'c', ruledByName: null }, NOW)
    if (!priv.ok) throw new Error(priv.error)
    expect(visibleDisputes(priv.disputes, 'u-filer', false).map((d) => d.id).sort()).toEqual(['mine', 'public'])
    expect(visibleDisputes(priv.disputes, 'u-filer', true)).toHaveLength(4)
  })
})

describe('settings round trip', () => {
  it('persists under league_disputes, keeps other settings, and skips malformed rows', () => {
    const settings = withDisputes({ keep: 1 }, filed().disputes)
    expect(settings.keep).toBe(1)
    const raw = [...(settings[DISPUTES_SETTINGS_KEY] as unknown[]), { id: 'bad' }, 'junk', { id: 'b2', subject: 's', filedByUserId: 'u', createdAt: NOW.toISOString(), category: 'x', status: 'open' }]
    const read = readDisputes({ [DISPUTES_SETTINGS_KEY]: raw })
    expect(read.map((d) => d.id)).toEqual(['d1'])
  })

  it('prunes closed disputes first and never drops an open one', () => {
    const open: LeagueDispute[] = [], closed: LeagueDispute[] = []
    const base = filed().dispute
    for (let i = 0; i < 10; i++) open.push({ ...base, id: `o${i}` })
    for (let i = 0; i < STORED_MAX; i++)
      closed.push({ ...base, id: `c${i}`, status: 'withdrawn', closedAt: new Date(NOW.getTime() + i * 1000).toISOString() })
    const stored = withDisputes({}, [...open, ...closed])[DISPUTES_SETTINGS_KEY] as LeagueDispute[]
    expect(stored).toHaveLength(STORED_MAX)
    expect(stored.filter((d) => d.status === 'open')).toHaveLength(10)
    // The newest closed ones are kept.
    expect(stored.some((d) => d.id === `c${STORED_MAX - 1}`)).toBe(true)
    expect(stored.some((d) => d.id === 'c0')).toBe(false)
  })
})
