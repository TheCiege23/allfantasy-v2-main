import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ScreenUnavailable } from '@/components/core-app/ScreenUnavailable'
import { ScreenLoadError } from '@/components/core-app/ScreenLoadError'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'
import { applyLanguageToDocument } from '@/lib/preferences/HtmlPreferenceSync'

const PAGE = readFileSync(resolve(__dirname, '../../app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')

describe('server-rendered /core failure panels follow the reader’s language', () => {
  it('reads the language once per screen from the af_lang cookie', () => {
    expect(PAGE).toContain('const language = resolveLanguage((await cookies()).get(LANG_COOKIE_KEY)?.value)')
  })

  it('has no hand-written English-only "could not read" panel left in page.tsx', () => {
    // The one remaining inline panel (the league-scoped one, which carries a link) branches on language.
    const inlineReadFailures = PAGE.match(/^\s+We could not (read|load|run) /gm) ?? []
    expect(inlineReadFailures).toEqual([])
  })

  it('has a Spanish translation for every title and body passed to ScreenUnavailable', () => {
    const calls = [...PAGE.matchAll(/<ScreenUnavailable\s+language=\{language\}\s+title=("[^"]*")\s+body=("[^"]*")/g)]
    expect(calls.length).toBe(11)
    for (const [, title, body] of calls) {
      for (const english of [JSON.parse(title), JSON.parse(body)] as string[]) {
        expect(coreUiCopy(english, 'es'), english).not.toBe(english)
      }
    }
  })

  it('passes the language to every ScreenLoadError', () => {
    const all = PAGE.match(/<ScreenLoadError [^>]*\/>/g) ?? []
    expect(all.length).toBeGreaterThan(0)
    for (const call of all) expect(call).toContain('language={language}')
  })

  it('renders ScreenUnavailable in Spanish and English', () => {
    const title = 'Notifications'
    const body = 'We could not read your notifications just now. This is a read failure on our side, not an empty inbox.'
    const { unmount } = render(<ScreenUnavailable title={title} body={body} language="es" />)
    expect(screen.getByRole('heading').textContent).toBe(coreUiCopy(title, 'es'))
    expect(screen.getByText(/No pudimos leer tus notificaciones/)).toBeTruthy()
    unmount()
    render(<ScreenUnavailable title={title} body={body} language="en" />)
    expect(screen.getByText(body)).toBeTruthy()
  })

  it('renders ScreenLoadError in Spanish, including the retry link', () => {
    render(<ScreenLoadError screen="Waivers" retryHref="/core/waivers?league=L1" language="es" />)
    expect(screen.getByRole('heading').textContent).toBe('Agentes libres: no se pudo cargar')
    expect(screen.getByRole('link').textContent).toBe('Reintentar')
  })
})

describe('Spanish coverage of the shared dictionary', () => {
  it('has a Spanish value for every English key (sign-up and Tokens were 82 short)', () => {
    const en = translations.en ?? {}
    const es = { ...(translations.es ?? {}), ...translationsEsParity }
    expect(Object.keys(en).filter((k) => !(k in es))).toEqual([])
  })
})

describe('applyLanguageToDocument', () => {
  it('keeps <html dir> in step with the language on a live switch', () => {
    document.documentElement.setAttribute('dir', 'rtl')
    applyLanguageToDocument('es')
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')
    expect(document.documentElement.getAttribute('lang')).toBe('es')
  })
})
