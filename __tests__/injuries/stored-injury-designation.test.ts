import { describe, expect, it } from 'vitest'

import { isStoredInjuryDesignation, storedInjuryFields } from '@/lib/injuries/storedInjuryDesignation'

/*
 * The vocabulary below is what `sports_players.injury_status` actually held in production on
 * 2026-10-11, on rows the importer had not rewritten since e71912b3 — not an invented list.
 */
const PRODUCTION_NON_DESIGNATIONS = [
  'INACT', 'ACT', 'Active', 'active', 'Inactive', 'Unknown', 'Coaching', 'Free Agent', 'NA', 'Retired',
  'Practice Squad', 'Deceased', 'Hamstring injury', 'Knee injury', 'surgery',
]
const PRODUCTION_DESIGNATIONS = [
  'Questionable', 'IR', 'Injured Reserve', 'Out', 'Doubtful', 'Injured', 'Concussion Protocol', 'QUES', 'Sus',
  'Suspension', 'COV', 'Physically Unable to Perform', '60-day IL', 'Day-to-Day',
]

describe('isStoredInjuryDesignation — the production vocabulary', () => {
  it.each(PRODUCTION_NON_DESIGNATIONS)('%s is roster bookkeeping or free text, not a designation', (value) => {
    expect(isStoredInjuryDesignation(value)).toBe(false)
  })

  it.each(PRODUCTION_DESIGNATIONS)('%s is a designation', (value) => {
    expect(isStoredInjuryDesignation(value)).toBe(true)
  })

  it('is case- and whitespace-insensitive', () => {
    for (const v of ['inact', ' ACTIVE ', 'free  agent', 'PRACTICE SQUAD']) expect(isStoredInjuryDesignation(v)).toBe(false)
    for (const v of ['questionable', ' OUT ', 'injured  reserve', 'ques', 'sus']) expect(isStoredInjuryDesignation(v)).toBe(true)
  })

  it('treats empty and missing as nothing', () => {
    for (const v of [null, undefined, '', '   ']) expect(isStoredInjuryDesignation(v)).toBe(false)
  })
})

describe('isStoredInjuryDesignation — borderline decisions', () => {
  it('accepts every IR / IL spelling', () => {
    for (const v of ['IR-R', 'LTIR', 'IL', 'IL10', 'IL-60', '10-Day IL', '60-Day-IL', '15-day injured list', 'Injured List', 'Injured Reserve - Designated to Return']) {
      expect(isStoredInjuryDesignation(v), v).toBe(true)
    }
  })

  it('accepts PUP / NFI / suspension / COVID / DNR forms', () => {
    for (const v of ['PUP', 'PUP-R', 'NFI', 'NFI-R', 'Non-Football Injury', 'Suspended', 'SUSP', 'COVID-19', 'DNR', 'Did Not Report']) {
      expect(isStoredInjuryDesignation(v), v).toBe(true)
    }
  })

  it('accepts game-status designations including the bare letters some feeds use', () => {
    for (const v of ['Probable', 'GTD', 'Game-Time Decision', 'Day-To-Day', 'DTD', 'Q', 'D', 'O', 'Out for season', 'Out (ankle)']) {
      expect(isStoredInjuryDesignation(v), v).toBe(true)
    }
  })

  it('accepts personal-absence lists as availability designations', () => {
    for (const v of ['Paternity', 'Paternity List', 'Bereavement List', 'Personal']) expect(isStoredInjuryDesignation(v), v).toBe(true)
  })

  it('rejects practice participation and the position-colliding P', () => {
    for (const v of ['Limited', 'Full', 'DNP', 'P', 'Healthy', 'N/A']) expect(isStoredInjuryDesignation(v), v).toBe(false)
  })

  it('reads through a Reserve/ prefix rather than accepting it wholesale', () => {
    expect(isStoredInjuryDesignation('Reserve/Injured')).toBe(true)
    expect(isStoredInjuryDesignation('Reserve/COVID-19')).toBe(true)
    expect(isStoredInjuryDesignation('Reserve/Retired')).toBe(false)
    expect(isStoredInjuryDesignation('Reserve/Practice Squad')).toBe(false)
  })

  it('does not take a word that merely starts with "out"', () => {
    expect(isStoredInjuryDesignation('Outfielder')).toBe(false)
  })
})

describe('storedInjuryFields', () => {
  it('drops the note with a rejected status, so an orphan note cannot read as an injury', () => {
    expect(storedInjuryFields('INACT', 'Placed on roster')).toEqual({ injuryStatus: null, injuryNotes: null })
    expect(storedInjuryFields(null, 'Hamstring')).toEqual({ injuryStatus: null, injuryNotes: null })
  })

  it('keeps a designation and its note', () => {
    expect(storedInjuryFields(' Questionable ', ' Hamstring ')).toEqual({ injuryStatus: 'Questionable', injuryNotes: 'Hamstring' })
    expect(storedInjuryFields('Out', '  ')).toEqual({ injuryStatus: 'Out', injuryNotes: null })
  })
})
