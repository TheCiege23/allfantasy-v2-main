// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'

/**
 * Disconnecting a platform deletes the SAVED CREDENTIAL and nothing else — imported leagues stay.
 * The confirm dialog was corrected once for promising otherwise; on 2026-10-03 the info tooltip
 * beside it still said disconnecting "removes that platform's leagues and our read-only copy of
 * their data". This pins every disconnect string to what the route actually does, in both languages.
 */

const route = readFileSync(path.join(process.cwd(), 'app/api/league/auth/route.ts'), 'utf8')
const del = route.slice(route.indexOf('export async function DELETE'))

const KEYS = ['import.platforms.hintBody', 'import.platforms.confirmBody'] as const

describe('platform disconnect copy matches what disconnect does', () => {
  it('CONTROL: the DELETE handler removes only leagueAuth rows', () => {
    expect(del).toMatch(/leagueAuth\.deleteMany\(/)
    // No league, team or roster deletion anywhere in the handler.
    expect(del).not.toMatch(/\b(league|leagueTeam|roster|sleeperLeague)\.(delete|deleteMany)\(/)
  })

  for (const lang of ['en', 'es'] as const) {
    for (const key of KEYS) {
      it(`${lang} ${key} does not promise to remove leagues`, () => {
        const text = translations[lang]?.[key]
        expect(text, `${lang} ${key} missing`).toBeTruthy()
        expect(text).not.toMatch(/removes? (that platform.s |the )?leagues|read-only copy/i)
        // "elimina … las ligas" is the false claim; "elimina el acceso … ligas nuevas" is the true one.
        expect(text).not.toMatch(/(elimina|borra)[^.;]{0,30}\blas ligas|copia de solo lectura/i)
      })
    }
  }
})
