// @vitest-environment node
/**
 * Two fixes from the 2026-09-29 UI audit.
 *
 * 1. ONE platform list. The nav card, the read-only tips and the welcome tour promised
 *    "Sleeper, ESPN or Yahoo" while Yahoo is unavailable ("Coming soon" on the importer), and the
 *    home card named a different set. Every in-app sentence now reads `availableImportPlatformsPhrase`.
 * 2. Readable errors. Screens printed a failed response's raw `error` ("GEO_BLOCKED", "Premium
 *    feature", "Unauthorized", "Missing leagueId") while a readable `message` sat unused.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { IMPORT_PROVIDER_UI_OPTIONS, availableImportPlatformsPhrase } from '@/lib/league-import/provider-ui-config'
import { connectLeagueCopy } from '@/lib/core-app/connectLeague'
import { readableApiError } from '@/lib/http/readableApiError'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('availableImportPlatformsPhrase', () => {
  it('names exactly the platforms marked available, in menu order', () => {
    expect(availableImportPlatformsPhrase()).toBe('Sleeper, ESPN, Fantrax, MFL or Fleaflicker')
    const available = IMPORT_PROVIDER_UI_OPTIONS.filter((o) => o.available).length
    expect(availableImportPlatformsPhrase().split(/, | or /)).toHaveLength(available)
  })

  it('does not name Yahoo while Yahoo is unavailable — and would, the moment it is', () => {
    const yahoo = IMPORT_PROVIDER_UI_OPTIONS.find((o) => o.provider === 'yahoo')!
    expect(yahoo.available).toBe(false)
    expect(availableImportPlatformsPhrase()).not.toMatch(/Yahoo/)
    const saved = yahoo.available
    try {
      ;(yahoo as { available: boolean }).available = true
      expect(availableImportPlatformsPhrase()).toBe('Sleeper, ESPN, Yahoo, Fantrax, MFL or Fleaflicker')
    } finally {
      ;(yahoo as { available: boolean }).available = saved
    }
  })

  it('drives the home connect card', () => {
    expect(connectLeagueCopy('connect').body.startsWith(`${availableImportPlatformsPhrase()}. `)).toBe(true)
  })

  /** 🛑 No in-app screen may hardcode the old list again. */
  it.each([
    'components/core-app/AfCoreShell.tsx',
    'components/core-app/CoreWelcomeTour.tsx',
    'components/core-app/comms/CommsDrawer.tsx',
    'components/core-app/player-finder/PlayerVerdict.tsx',
    'components/core-app/screens/Dashboard34.tsx',
    'components/core-app/screens/Dashboard3A.tsx',
    'components/core-app/screens/FormatHub.tsx',
    'components/core-app/screens/ImportV4.tsx',
    'lib/core-app/connectLeague.ts',
  ])('%s names platforms through the shared phrase', (rel) => {
    const src = read(rel)
    expect(src).toMatch(/availableImportPlatformsPhrase\(\)/)
    // What a user can see: code comments may still describe history.
    const shown = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(shown).not.toMatch(/Sleeper, ESPN or Yahoo|Sleeper, ESPN, Yahoo|ESPN or Yahoo\./)
  })
})

describe('readableApiError', () => {
  const FALLBACK = 'Something went wrong.'

  it('prefers the response message', () => {
    expect(readableApiError({ error: 'GEO_BLOCKED', message: 'Account creation is not available in WA.' }, FALLBACK)).toBe(
      'Account creation is not available in WA.',
    )
    expect(readableApiError({ error: 'Premium feature', message: 'The trade finder is part of AF Pro.' }, FALLBACK)).toBe(
      'The trade finder is part of AF Pro.',
    )
  })

  it('never shows a machine code, a bare HTTP word or a field name', () => {
    for (const error of ['PHONE_VERIFY_NOT_CONFIGURED', 'VPN_BLOCKED', 'Unauthorized', 'Forbidden', 'Missing leagueId', 'x']) {
      expect(readableApiError({ error }, FALLBACK)).toBe(FALLBACK)
    }
  })

  it('keeps an error that is already a sentence', () => {
    expect(readableApiError({ error: 'An account with this email already exists.' }, FALLBACK)).toBe(
      'An account with this email already exists.',
    )
    expect(readableApiError({ error: 'Trade finder temporarily unavailable' }, FALLBACK)).toBe('Trade finder temporarily unavailable')
  })

  it('falls back on no body', () => {
    expect(readableApiError(null, FALLBACK)).toBe(FALLBACK)
    expect(readableApiError('oops', FALLBACK)).toBe(FALLBACK)
    expect(readableApiError({}, FALLBACK)).toBe(FALLBACK)
  })
})

describe('screens that printed raw API errors', () => {
  it.each([
    ['components/core-app/screens/TradeFinderPanel.tsx', /\{data\.error\}/],
    ['components/core-app/screens/AuthV4.tsx', /\? data\.error\s*:/],
    ['components/core-app/WaiverOversight.tsx', /\$\{body\.error\}/],
    ['components/core-app/hubs/HubBroadcast.tsx', /\$\{body\.error\}/],
  ])('%s shows readableApiError, never the raw field', (rel, raw) => {
    const src = read(rel)
    expect(src).toMatch(/readableApiError\(/)
    expect(src).not.toMatch(raw)
  })

  it('the Waivers board no longer shows the internal field name scoring_settings', () => {
    expect(read('components/core-app/boards/WaiversBoard.tsx')).not.toMatch(/<code>scoring_settings<\/code>/)
  })
})
