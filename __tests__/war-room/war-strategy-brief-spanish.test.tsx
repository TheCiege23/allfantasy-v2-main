/**
 * The next-season plan in Spanish — the dynasty engine's reasons included (dynastyFactsSpanish.ts).
 *
 * Before this, Spanish mode translated every label around the dynasty plan and left the engine's
 * reasons in English (2026-11-12).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const lang = vi.hoisted(() => ({ language: 'es' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { WarStrategyBrief } from '@/components/core-app/screens/WarStrategyBrief'
import type { NextSeasonView } from '@/lib/core-app/warRoomNextSeason'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

const plan: NextSeasonView = {
  kind: 'dynasty',
  window: 'rebuild',
  posture: 'sell_for_youth',
  contendScore: 31,
  avgStarterAge: 28.4,
  earlyPickCount: 2,
  facts: [
    'Record 3-6-1 (win% 0.35).',
    'Young-asset value share 22% (sustainability signal).',
    'Average starter age 28.4.',
    'Pick capital: 3 future pick(s), 2 early, tier total 95.',
  ],
  missing: [],
}

describe('WarStrategyBrief — next season in Spanish', () => {
  it('the dynasty reasons are Spanish, with no English sentence left', () => {
    lang.language = 'es'
    const t = text(renderToStaticMarkup(<WarStrategyBrief format={null} nextSeason={plan} />))
    expect(t).toContain('Próxima temporada')
    expect(t).toContain('Reconstrucción')
    expect(t).toContain('Récord 3-6-1 (porcentaje de victorias 0.35).')
    expect(t).toContain('El 22% del valor está en activos jóvenes (señal de sostenibilidad).')
    expect(t).toContain('Edad promedio de los titulares: 28.4.')
    expect(t).toContain('Capital de selecciones: 3 selecciones futuras, 2 tempranas, valor total por niveles 95.')
    expect(t).not.toMatch(/Record |Young-asset|Average starter age|Pick capital/)
  })

  it('English mode still shows the engine’s own English', () => {
    lang.language = 'en'
    const t = text(renderToStaticMarkup(<WarStrategyBrief format={null} nextSeason={plan} />))
    expect(t).toContain('Record 3-6-1 (win% 0.35).')
    expect(t).toContain('Average starter age 28.4.')
  })
})
