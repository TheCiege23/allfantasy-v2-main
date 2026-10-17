// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'

/**
 * Settings › Preferences' "saved" confirmation read "✓ Preferences saved" in English while the rest
 * of the panel was Spanish (found by a live language check, 2026-10-03). It now reads a key.
 */
describe('Preferences saved confirmation', () => {
  const src = readFileSync(path.join(process.cwd(), 'app/settings/components/sections/PreferencesSettingsSection.tsx'), 'utf8')

  it('is translated, not a hard-coded English literal', () => {
    expect(src).not.toMatch(/"✓ Preferences saved"/)
    expect(src).toMatch(/savedFlash\.saved \? t\("settings\.preferences\.saved"\)/)
  })

  it('has an English and a Spanish string', () => {
    expect(translations.en['settings.preferences.saved']).toBe('✓ Preferences saved')
    expect(translations.es['settings.preferences.saved']).toBe('✓ Preferencias guardadas')
  })
})
