import { describe, expect, it } from 'vitest'

import { resolveDraftRoomMode } from '@/components/app/draft-room/DraftModeBanner'
import { draftRoomRedesignMessages } from '@/lib/core-app/messages/draftRoomRedesign'
import { refusesHandPickInAutoDraft } from '@/lib/live-draft-engine/autoDraftPickRule'
import { DRAFT_PICK_AUTO_DRAFT, httpStatusForPickAuthorityCode } from '@/lib/live-draft-engine/pickAuthorityCodes'

/** An auto draft is drafted by the computer for every seat; nobody picks by hand (production, 2026-11-25). */

describe('refusesHandPickInAutoDraft', () => {
  it('refuses every source but the commissioner override in an auto draft', () => {
    for (const source of ['user', 'auto', 'keeper', 'devy', 'college', 'promoted_devy', null, undefined]) {
      expect(refusesHandPickInAutoDraft('auto', source), String(source)).toBe(true)
    }
    expect(refusesHandPickInAutoDraft('auto', 'commissioner')).toBe(false)
  })

  it('refuses nothing in a live or offline draft, or when the mode is unknown', () => {
    for (const mode of ['live', 'offline', null, undefined, '']) {
      expect(refusesHandPickInAutoDraft(mode, 'user'), String(mode)).toBe(false)
    }
  })

  it('answers 409, like the offline refusal', () => {
    expect(httpStatusForPickAuthorityCode(DRAFT_PICK_AUTO_DRAFT)).toBe(409)
  })
})

describe('the room says so', () => {
  it('shows the auto draft banner, ahead of a viewer’s own auto-pick switch', () => {
    expect(resolveDraftRoomMode({ executionMode: 'auto' })).toBe('auto')
    expect(resolveDraftRoomMode({ executionMode: 'auto', viewerAutopickEnabled: true })).toBe('auto')
    // Controls: the other modes are unchanged.
    expect(resolveDraftRoomMode({ executionMode: 'offline' })).toBe('offline')
    expect(resolveDraftRoomMode({ executionMode: 'live', viewerAutopickEnabled: true })).toBe('autopick')
    expect(resolveDraftRoomMode({ executionMode: 'live' })).toBeNull()
    expect(resolveDraftRoomMode({ executionMode: 'auto', isMock: true })).toBe('mock')
  })

  it('has the banner copy in every locale, and never says "AI"', () => {
    const locales = Object.values(draftRoomRedesignMessages) as Array<{ modeAutoLabel: string; modeAutoBody: string }>
    expect(locales.length).toBeGreaterThanOrEqual(2)
    for (const locale of locales) {
      expect(locale.modeAutoLabel.trim().length).toBeGreaterThan(0)
      expect(locale.modeAutoBody.trim().length).toBeGreaterThan(0)
      expect(`${locale.modeAutoLabel} ${locale.modeAutoBody}`).not.toMatch(/\bAI\b|\bIA\b/)
    }
  })
})
