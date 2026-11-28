/**
 * Owner's decision 2026-11-28, item C: the War Room `draft_prep` card says only what `draft_prep` unlocks —
 * the War Room prep flows — in English and Spanish. It read "Pick explanations and prep flows tied to your
 * draft" and locked AF Pro users, who have had the draft-room pick explanation since that same day.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { messagesFor, missingMessages } from '@/lib/i18n/messages'
import { warRoomDraftPlanningMessages } from '@/lib/league/warRoomDraftPlanningMessages'
import { hasFeatureAccessForPlans } from '@/lib/subscription/feature-access'

const TAB = readFileSync(join(process.cwd(), 'app/league/[leagueId]/tabs/WarRoomTab.tsx'), 'utf8')

describe('War Room draft_prep card copy', () => {
  it('describes the War Room prep flows and promises no pick explanation, in English', () => {
    const en = messagesFor(warRoomDraftPlanningMessages, 'en')
    expect(en.description).toMatch(/War Room prep flows/)
    expect(`${en.title} ${en.description} ${en.cta}`).not.toMatch(/explanation/i)
  })

  it('is fully translated into Spanish, and the Spanish promises no explanation either', () => {
    expect(missingMessages(warRoomDraftPlanningMessages, 'es')).toEqual([])
    const es = messagesFor(warRoomDraftPlanningMessages, 'es')
    expect(es.description).toMatch(/preparación de War Room/)
    expect(`${es.title} ${es.description} ${es.cta}`).not.toMatch(/explicaci/i)
  })

  it('the card reads the catalog; the old sentence is gone from the tab', () => {
    expect(TAB).not.toMatch(/Pick explanations and prep flows/)
    const card = TAB.slice(TAB.indexOf("featureId: 'draft_prep'"), TAB.indexOf("featureId: 'future_planning'"))
    expect(card).toMatch(/^\s*description: draftPlanning\.description,$/m)
    expect(card).toMatch(/^\s*title: draftPlanning\.title,$/m)
  })

  it('the card still locks on draft_prep, which AF Pro does not hold and AF Legacy does', () => {
    expect(hasFeatureAccessForPlans(['pro'], 'active', 'draft_prep')).toBe(false)
    expect(hasFeatureAccessForPlans(['war_room'], 'active', 'draft_prep')).toBe(true)
    expect(hasFeatureAccessForPlans(['pro'], 'active', 'draft_room_ai_explanation')).toBe(true)
  })
})
