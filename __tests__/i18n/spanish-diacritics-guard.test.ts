/**
 * Spanish copy must keep its accents. The create-league wizard, the invite card and the welcome card
 * shipped with every Spanish string written unaccented («alineacion», «puntuacion», «invitacion»,
 * «despues», «Proximamente»…), and nothing failed. This sweep forbids a short list of forms that are
 * misspellings in every context — none of them is a different valid word without its accent — in
 * every Spanish value the app can render. Context-dependent words (esta/está, aun/aún, como/cómo,
 * cambio/cambió…) are deliberately NOT here: a word list cannot rule on them.
 */
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'

const UNACCENTED = [
  'alineacion',
  'puntuacion',
  'eliminacion',
  'invitacion',
  'configuracion',
  'importacion',
  'aprobacion',
  'recepcion',
  'despues',
  'tambien',
  'ultimas',
  'seran',
  'proximamente',
  'automaticamente',
  'telefono',
  'codigo',
  'atencion',
]

/** {{placeholders}} and {single} tokens are code, not Spanish; they are blanked before matching. */
const PLACEHOLDER = /\{\{[^}]*\}\}|\{[A-Za-z0-9_.]+\}/g
const FORBIDDEN = new RegExp(`(?<![\\p{L}\\p{N}_])(${UNACCENTED.join('|')})(?![\\p{L}\\p{N}_])`, 'iu')

function hitsIn(table: Record<string, string>, label: string): string[] {
  const hits: string[] = []
  for (const [key, value] of Object.entries(table)) {
    const m = String(value).replace(PLACEHOLDER, ' ').match(FORBIDDEN)
    if (m) hits.push(`${label} ${key}: «${m[0]}» in “${String(value).slice(0, 120)}”`)
  }
  return hits
}

describe('Spanish values keep their accents', () => {
  it('the matcher catches an unaccented form and spares the accented one, a placeholder and a longer word', () => {
    expect(FORBIDDEN.test('Plantilla de puntuacion')).toBe(true)
    expect(FORBIDDEN.test('Enlace de Invitacion')).toBe(true)
    expect(FORBIDDEN.test('Plantilla de puntuación')).toBe(false)
    expect(FORBIDDEN.test('{{despues}} listo'.replace(PLACEHOLDER, ' '))).toBe(false)
    expect(FORBIDDEN.test('Alineaciones óptimas')).toBe(false)
  })

  it('the sweep reaches the tables it exists for', () => {
    expect(Object.keys(translations.es).length).toBeGreaterThan(1000)
    expect(Object.keys(translationsEsParity).length).toBeGreaterThan(1000)
    expect(translations.es['createLeague.g30.scoring.label']).toBe('Plantilla de puntuación')
  })

  it('no Spanish value uses an unaccented form', () => {
    const hits = [...hitsIn(translations.es, 'es'), ...hitsIn(translationsEsParity, 'es-parity')]
    expect(hits, hits.join('\n')).toEqual([])
  })
})
