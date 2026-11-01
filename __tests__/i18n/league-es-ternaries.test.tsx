// @vitest-environment jsdom
/**
 * The league pages' inline English/Spanish switches moved into the message catalog (2026-10-31), and
 * scripts/i18n-ternary-ratchet.mjs now scans components/league and app/league so they cannot return.
 * This pins the keys that move added, and renders three of the converted components in Spanish.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'

const lang = vi.hoisted(() => ({ current: 'es' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const { interpolateTemplate } = await import('@/lib/i18n/interpolate')
  const t = (k: string) => dict[lang.current]?.[k] ?? dict.en[k] ?? k
  const value = () => ({
    language: lang.current,
    setLanguage: () => {},
    t,
    tInterpolate: (k: string, v: Record<string, string | number> = {}) => interpolateTemplate(t(k), v),
  })
  return { useOptionalLanguage: value, useLanguage: value }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ prefetch() {}, push() {}, refresh() {} }) }))

import { CustomizeLeagueLink } from '@/components/league/LeagueDisplayPreferences'
import { ImportedLeagueQuickActions } from '@/components/league/ImportedLeagueQuickActions'
import { LeagueWorkspaceNavigation } from '@/components/league/LeagueWorkspaceNavigation'

afterEach(() => {
  cleanup()
  lang.current = 'es'
})

const PREFIXES = [
  'league.common.',
  'league.workspaceNav.',
  'league.customizePage',
  'league.welcomeBack.',
  'league.myAutomations.',
  'league.importedActions.',
  'league.autoChanges.',
  'league.constitution.',
  'league.payouts.',
  'league.sideContests.',
]
const NEW_KEYS = Object.keys(translations.en).filter((k) => PREFIXES.some((p) => k.startsWith(p)))
/** Spanish that is legitimately the same word as the English. */
const SAME_IN_SPANISH = new Set(['league.payouts.final'])

describe('league catalog keys', () => {
  it('finds every key the migration added (the prefix filter is not silently empty)', () => {
    expect(NEW_KEYS).toHaveLength(82)
  })

  it.each(NEW_KEYS)('%s has English and natural Spanish', (key) => {
    const en = translations.en[key]
    const es = translations.es[key]
    expect(en, 'en').toBeTruthy()
    expect(translationsEsParity[key], 'es parity file').toBe(es)
    expect(es, 'es').toBeTruthy()
    if (!SAME_IN_SPANISH.has(key)) expect(es).not.toBe(en)
    expect(es).not.toMatch(/waiver/i)
  })
})

describe('converted components render Spanish from the catalog', () => {
  it('the workspace navigation', () => {
    render(<LeagueWorkspaceNavigation leagueId="native-one" leagueName="Sunday League" platform="allfantasy" />)
    expect(screen.getByRole('link', { name: '← Volver al panel' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inicio de la liga' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Navegación de la liga' })).toBeInTheDocument()
  })

  it('the imported-league strip and its delete dialog, with the platform interpolated', () => {
    render(<ImportedLeagueQuickActions leagueId="L1" leagueName="Liga Domingo" platform="Sleeper" canRemove />)
    expect(screen.getByText('Liga importada de Sleeper')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('delete-imported-league-open'))
    expect(screen.getByRole('heading', { name: '¿Eliminar esta liga importada?' })).toBeInTheDocument()
    expect(screen.getByText(/La liga original en Sleeper y las copias de otros miembros no cambiarán\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })

  it('the customize link, and English is unchanged (control)', () => {
    render(<CustomizeLeagueLink returnTo="/league/L1" />)
    expect(screen.getByRole('link', { name: 'Personalizar página' })).toBeInTheDocument()
    cleanup()
    lang.current = 'en'
    render(<CustomizeLeagueLink returnTo="/league/L1" />)
    expect(screen.getByRole('link', { name: 'Customize page' })).toBeInTheDocument()
  })
})
