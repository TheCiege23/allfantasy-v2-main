import { describe, expect, it } from 'vitest'
import {
  activeFaLockWindow,
  anyWaiverExtraOn,
  defaultWaiverExtras,
  faLockMessage,
  parseWaiverExtras,
  readWaiverExtras,
} from '@/lib/waivers/waiverExtras'

describe('waiver extras record', () => {
  it('reads all-off when absent or malformed, and rejects a backwards lock window', () => {
    expect(readWaiverExtras({})).toEqual(defaultWaiverExtras())
    expect(readWaiverExtras({ af_waiver_extras: { nope: true } })).toEqual(defaultWaiverExtras())
    expect(parseWaiverExtras({ ...defaultWaiverExtras(), faLockWindows: [{ day: 0, startHour: 20, endHour: 10 }] })).toBeNull()
    expect(anyWaiverExtraOn(defaultWaiverExtras())).toBe(false)
    expect(anyWaiverExtraOn({ ...defaultWaiverExtras(), rebuildPriority: true })).toBe(true)
  })
})

describe('free-agent lock windows, in league time', () => {
  const extras = { ...defaultWaiverExtras(), faLockWindows: [{ day: 0, startHour: 10, endHour: 20 }] } // Sunday 10 AM–8 PM

  it('locks inside the window and not outside it', () => {
    // Sun Nov 29 2026 1:00 PM Eastern = 18:00 UTC.
    expect(activeFaLockWindow(extras, new Date('2026-11-29T18:00:00Z'), 'America/New_York')).toEqual({ day: 0, startHour: 10, endHour: 20 })
    // 9:00 PM Eastern.
    expect(activeFaLockWindow(extras, new Date('2026-11-30T02:00:00Z'), 'America/New_York')).toBeNull()
    // Monday.
    expect(activeFaLockWindow(extras, new Date('2026-11-30T18:00:00Z'), 'America/New_York')).toBeNull()
  })

  it('reads the window in the league zone, not the server\'s', () => {
    // 18:00 UTC Sunday is 10:00 AM Pacific — inside; 17:00 UTC is 9:00 AM Pacific — outside.
    expect(activeFaLockWindow(extras, new Date('2026-11-29T18:00:00Z'), 'America/Los_Angeles')).not.toBeNull()
    expect(activeFaLockWindow(extras, new Date('2026-11-29T17:00:00Z'), 'America/Los_Angeles')).toBeNull()
  })

  it('says why, in plain words', () => {
    expect(faLockMessage({ day: 0, startHour: 10, endHour: 20 })).toBe('Free-agent adds are locked Sunday 10 AM–8 PM league time by the commissioner.')
  })
})
