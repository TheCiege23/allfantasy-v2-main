'use client'

import { ScopeResetLink } from '@/components/core-app/ScopeSwitcher'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { scopeLabelText } from '@/lib/core-app/shellCopy'

/**
 * HomeCards' own words, in the reader's language (2026-10-04): the filtered home's note, the panel for
 * a filter that matches nothing, and the "could not read your leagues" panel. HomeCards is a SERVER
 * component and the language is client state, so it decides which panel to show and these say it. The
 * scope label ("NFL leagues") goes through shellCopy's `scopeLabelText`, as it does in the switcher.
 */

const ALL_LEAGUES = (es: boolean) => (es ? 'Mostrar todas las ligas' : 'Show all leagues')

/** A filtered home says so above everything, with the way back to every league. */
export function HomeScopeNote({ label, count, total }: { label: string; count: number; total: number }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  return (
    <p className="af-home-scope" role="status">
      {es ? (
        <span>
          Mostrando <b>{scopeLabelText(label, language)}</b>: {count} de {total} {total === 1 ? 'liga' : 'ligas'}. Todo lo de
          abajo cubre solo estas.
        </span>
      ) : (
        <span>
          Showing <b>{label}</b> — {count} of {total} {total === 1 ? 'league' : 'leagues'}.
          Everything below covers only these.
        </span>
      )}
      <ScopeResetLink>{ALL_LEAGUES(es)}</ScopeResetLink>
    </p>
  )
}

/**
 * A scope that matches nothing — a sport or platform you no longer play, favorites on a new device.
 * Said plainly, rather than rendering a home of cards that each claim "nothing here" about leagues
 * that were simply filtered out.
 */
export function HomeScopeEmpty({ label, scopeKey }: { label: string; scopeKey: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  return (
    <div className="af-frame af-home-scope-empty">
      <h2>{es ? 'No hay ligas en esta vista' : 'No leagues in this view'}</h2>
      {es ? (
        <p>
          Ninguna de tus ligas coincide con «{scopeLabelText(label, language)}»
          {scopeKey === 'fav' ? ': marca una liga con una estrella en el selector de ligas de arriba para añadirla aquí' : ''}.{' '}
          <ScopeResetLink>{ALL_LEAGUES(es)}</ScopeResetLink>
        </p>
      ) : (
        <p>
          None of your leagues match &ldquo;{label}&rdquo;
          {scopeKey === 'fav' ? ' — star a league in the league picker at the top to add it here' : ''}.{' '}
          <ScopeResetLink>{ALL_LEAGUES(es)}</ScopeResetLink>
        </p>
      )}
    </div>
  )
}

/**
 * The panel that used to replace the whole home when the summary read failed — see HomeCards' header.
 * It says the read failed, never that there are no leagues.
 */
export function HomeReadFailure() {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  return (
    <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
      <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
        {es ? 'Tus ligas' : 'Your leagues'}
      </h1>
      <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
        {es
          ? 'No pudimos leer tus ligas en este momento. Es un fallo de lectura de nuestra parte, no una señal de que no tengas ninguna.'
          : 'We could not read your leagues just now. This is a read failure on our side, not a sign that you have none.'}
      </p>
    </div>
  )
}

/**
 * The foot of the home: the way to switch sections off (Settings → Home page, 2026-10-24). When some
 * are already off it says how many, so a missing card reads as the reader's own choice rather than
 * as something broken — and the same link brings it back.
 */
export function HomeCustomizeLink({ hiddenCount }: { hiddenCount: number }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const text =
    hiddenCount > 0
      ? es
        ? `${hiddenCount} ${hiddenCount === 1 ? 'sección oculta' : 'secciones ocultas'} · Elegir qué se muestra aquí →`
        : `${hiddenCount} ${hiddenCount === 1 ? 'section' : 'sections'} hidden · Choose what shows here →`
      : es
        ? '¿Demasiado? Elige qué se muestra aquí →'
        : 'Too much? Choose what shows here →'
  return (
    <p className="af-home-customize">
      <a href="/settings?tab=home" data-testid="home-customize-link">
        {text}
      </a>
    </p>
  )
}
