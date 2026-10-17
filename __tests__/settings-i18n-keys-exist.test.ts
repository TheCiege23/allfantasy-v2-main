import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'
import { NOTIFICATION_CATEGORY_LABELS, NOTIFICATION_CATEGORY_LABEL_KEYS } from '@/lib/notification-settings/types'
import { DELIVERY_LABELS, DELIVERY_LABEL_KEYS } from '@/lib/notification-settings/DeliveryMethodResolver'
import { AVATAR_PRESET_LABELS, AVATAR_PRESET_LABEL_KEYS } from '@/lib/signup/avatar-presets'
import { CHIMMY_VOICES } from '@/lib/tts/voices'
import {
  getImportStatusLabel,
  getImportStatusLabelKey,
  getLegacyPrimaryActionLabelKey,
} from '@/lib/legacy-import-settings/ImportStatusQueryService'

/*
 * t() returns the KEY when a string is missing, so a key nobody defined does not throw — it puts
 * text like "settings.connected.connectError" on screen. That shipped twice in Settings: the
 * Connected Accounts connect error (whose `t(...) || fallback` fallback was dead code, because
 * the key itself is truthy) and the Spotify sign-in label. This census fails the moment a
 * settings file uses a key the English or Spanish table lacks.
 */

const ROOT = process.cwd()
const SCANNED = [
  'app/settings',
  'components/settings',
  'components/notification-settings',
  'components/core-app/import/ConnectedPlatforms.tsx',
  'components/core-app/import/EspnConnectPanel.tsx',
  'components/notifications/EnableWebPushCard.tsx',
  'components/notifications/IosAppPushCard.tsx',
  'components/chimmy-surfaces/ChimmyAlertPreferencesPanel.tsx',
]

function files(rel: string): string[] {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return /\.tsx?$/.test(abs) ? [abs] : []
  return fs.readdirSync(abs).flatMap((f) => files(path.join(rel, f)))
}

function staticKeys(): Map<string, string> {
  const out = new Map<string, string>()
  for (const file of SCANNED.flatMap(files)) {
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/\b(?:t|tInterpolate)\(\s*(["'])([^"'\n]+)\1/g)) {
      out.set(m[2]!, path.relative(ROOT, file))
    }
  }
  return out
}

describe('settings translation keys', () => {
  const keys = staticKeys()

  it('found keys to check (guards against the scan silently matching nothing)', () => {
    expect(keys.size).toBeGreaterThan(200)
  })

  for (const lang of ['en', 'es'] as const) {
    it(`every key used in Settings exists in "${lang}"`, () => {
      const table = translations[lang]!
      const missing = [...keys].filter(([k]) => !(k in table)).map(([k, f]) => `${k}  (${f})`)
      expect(missing).toEqual([])
    })
  }

  it('every sign-in provider id has a label in en and es', () => {
    const typesSrc = fs.readFileSync(path.join(ROOT, 'lib/connected-accounts/types.ts'), 'utf8')
    const union = typesSrc.match(/export type SignInProviderId\s*=\s*([^\n]+)/)?.[1] ?? ''
    const ids = [...union.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!)
    expect(ids).toContain('spotify')
    for (const lang of ['en', 'es'] as const) {
      const missing = ids.filter((id) => !(`settings.connected.signInProvider.${id}` in translations[lang]!))
      expect(missing, lang).toEqual([])
    }
  })

  /*
   * Labels defined in lib/ carry their key in a variable, so the static scan above cannot see them.
   * Each key must exist in both tables, and its English must equal the lib label it stands beside —
   * the label is the fallback, so a drift between the two would change English text on screen.
   */
  it('every lib label key exists in en and es, and its English matches the lib label', () => {
    const pairs: Array<[string, string]> = [
      ...Object.entries(NOTIFICATION_CATEGORY_LABEL_KEYS).map(
        ([id, key]) => [key, NOTIFICATION_CATEGORY_LABELS[id as keyof typeof NOTIFICATION_CATEGORY_LABELS]] as [string, string],
      ),
      ...Object.entries(DELIVERY_LABEL_KEYS).map(
        ([id, key]) => [key, DELIVERY_LABELS[id as keyof typeof DELIVERY_LABELS]] as [string, string],
      ),
      ...Object.entries(AVATAR_PRESET_LABEL_KEYS).map(
        ([id, key]) => [key, AVATAR_PRESET_LABELS[id as keyof typeof AVATAR_PRESET_LABELS]] as [string, string],
      ),
      ...CHIMMY_VOICES.map((v) => [v.descriptionKey ?? '', v.description] as [string, string]),
      ...['completed', 'running', 'queued', 'failed', 'error', 'not_started', 'none'].map(
        (s) => [getImportStatusLabelKey(s) ?? '', getImportStatusLabel(s)] as [string, string],
      ),
      ...['Connect first', 'Retry import', 'Re-import / refresh', 'Start import', 'Open import'].map(
        (label) => [getLegacyPrimaryActionLabelKey(label) ?? '', label] as [string, string],
      ),
    ]
    expect(pairs.length).toBeGreaterThan(50)
    const problems: string[] = []
    for (const [key, english] of pairs) {
      if (!key) problems.push(`no key for "${english}"`)
      else if (translations.en![key] !== english) problems.push(`en ${key} = ${translations.en![key]} ≠ ${english}`)
      if (key && !(key in translations.es!)) problems.push(`es missing ${key}`)
    }
    expect(problems).toEqual([])
  })

  it('the connect error names the provider in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      expect(translations[lang]!['settings.connected.connectError']).toContain('{{provider}}')
    }
  })
})
