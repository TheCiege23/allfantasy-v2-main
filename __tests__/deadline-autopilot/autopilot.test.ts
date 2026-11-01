import { describe, expect, it } from 'vitest'
import {
  AUTOPILOT_SETTINGS_KEY,
  CUSTOM_MAX,
  dueReminders,
  manualReminderAllowed,
  parseCustomDeadlines,
  pruneSent,
  readAutopilotSettings,
  reminderCopy,
  withAutopilotSettings,
  type LeagueDeadline,
} from '@/lib/deadline-autopilot/autopilot'

const NOW = new Date('2026-10-19T12:00:00Z')
const H = 3600_000
const deadline = (hoursOut: number, extra: Partial<LeagueDeadline> = {}): LeagueDeadline => ({
  key: 'custom:d1',
  kind: 'trade',
  label: 'Trade deadline',
  at: new Date(NOW.getTime() + hoursOut * H),
  recipientUserIds: ['u1', 'u2'],
  targeted: false,
  ...extra,
})
const stages = (hoursOut: number, sent: Record<string, string> = {}) => dueReminders([deadline(hoursOut)], sent, NOW).map((r) => r.stage)

describe('dueReminders', () => {
  it('fires each stage inside its window', () => {
    expect(stages(100)).toEqual([])
    expect(stages(72)).toEqual(['72h'])
    expect(stages(30)).toEqual(['72h'])
    expect(stages(24)).toEqual(['24h'])
    expect(stages(0.99)).toEqual(['1h'])
    expect(stages(-0.1)).toEqual([])
  })

  it('sends only the tightest due stage and marks the looser ones with it', () => {
    const [r] = dueReminders([deadline(10)], {}, NOW)
    expect(r.stage).toBe('24h')
    expect(r.marks).toEqual(['custom:d1:72h', 'custom:d1:24h'])
  })

  it('never sends a stage twice', () => {
    expect(stages(30, { 'custom:d1:72h': 'x' })).toEqual([])
    expect(stages(20, { 'custom:d1:72h': 'x' })).toEqual(['24h'])
    expect(stages(0.5, { 'custom:d1:72h': 'x', 'custom:d1:24h': 'x', 'custom:d1:1h': 'x' })).toEqual([])
  })

  it('skips a deadline with nobody left to remind', () => {
    expect(dueReminders([deadline(10, { recipientUserIds: [] })], {}, NOW)).toEqual([])
  })
})

describe('custom deadline list', () => {
  it('validates, keeps ids, assigns new ones and sorts by time', () => {
    let n = 0
    const r = parseCustomDeadlines(
      [
        { id: 'keep', kind: 'taxi', label: ' Taxi lock ', at: '2026-11-02T00:00:00Z' },
        { kind: 'bogus', label: 'Trade deadline', at: '2026-10-30T23:00:00Z' },
      ],
      () => `new${++n}`,
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.custom).toEqual([
      { id: 'new1', kind: 'other', label: 'Trade deadline', at: '2026-10-30T23:00:00.000Z' },
      { id: 'keep', kind: 'taxi', label: 'Taxi lock', at: '2026-11-02T00:00:00.000Z' },
    ])
  })

  it('refuses missing names, bad times and too many rows', () => {
    const id = () => 'x'
    expect(parseCustomDeadlines([{ label: ' ', at: '2026-10-30T00:00:00Z' }], id)).toEqual({ ok: false, error: 'label_required' })
    expect(parseCustomDeadlines([{ label: 'A', at: 'soon' }], id)).toEqual({ ok: false, error: 'invalid_time' })
    expect(parseCustomDeadlines(Array.from({ length: CUSTOM_MAX + 1 }, () => ({ label: 'A', at: '2026-10-30T00:00:00Z' })), id)).toEqual({ ok: false, error: 'too_many' })
  })

  it('round-trips through league settings without touching other keys', () => {
    const settings = withAutopilotSettings({ other: 1 }, { enabled: true, custom: [{ id: 'a', kind: 'trade', label: 'T', at: '2026-10-30T00:00:00.000Z' }], sent: { 'custom:a:72h': 'x' } })
    expect(settings.other).toBe(1)
    expect(readAutopilotSettings(settings)).toEqual(settings[AUTOPILOT_SETTINGS_KEY])
    expect(readAutopilotSettings({})).toEqual({ enabled: false, custom: [], sent: {} })
  })
})

describe('bookkeeping', () => {
  it('prunes markers of deadlines that are gone, including keys containing colons', () => {
    const sent = { 'keeper:s1:24h': 'a', 'custom:old:72h': 'b', 'custom:d1:manual': 'c' }
    expect(pruneSent(sent, ['keeper:s1', 'custom:d1'])).toEqual({ 'keeper:s1:24h': 'a', 'custom:d1:manual': 'c' })
  })

  it('manual reminders cool down for 6 hours', () => {
    expect(manualReminderAllowed({}, 'custom:d1', NOW)).toBe(true)
    expect(manualReminderAllowed({ 'custom:d1:manual': new Date(NOW.getTime() - 5 * H).toISOString() }, 'custom:d1', NOW)).toBe(false)
    expect(manualReminderAllowed({ 'custom:d1:manual': new Date(NOW.getTime() - 6 * H).toISOString() }, 'custom:d1', NOW)).toBe(true)
  })

  it('copy names the time left and, for keepers, that this manager has not submitted', () => {
    expect(reminderCopy(deadline(72), NOW, 'Dynasty Bros').title).toBe('Trade deadline — 3 days left')
    expect(reminderCopy(deadline(0.75), NOW, 'Dynasty Bros').title).toBe('Trade deadline — 45 minutes left')
    expect(reminderCopy(deadline(24, { kind: 'keeper', targeted: true, label: 'Keeper deadline' }), NOW, 'Dynasty Bros').body).toContain("haven't submitted keepers")
  })
})
