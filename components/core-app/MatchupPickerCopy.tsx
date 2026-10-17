'use client'

/**
 * The matchup picker's own words, in the reader's language (2026-10-03).
 *
 * `page.tsx` is a server component and reads no language, and switching language re-renders only
 * client components — so text it writes inline stays English for a Spanish reader. These pieces are
 * client components for that reason: they follow the language switch at once.
 */
import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

export function MatchupPickerBlurb() {
  const { language } = useOptionalLanguage()
  return <>{language === 'es' ? 'Elige una liga para ver su marcador completo.' : 'Pick a league for its full box score.'}</>
}

/**
 * Above the picker: a failed all-leagues read says it failed (it must not read like a quiet week),
 * and the explicit all-leagues view links back to the board.
 */
export function MatchupPickerNotice({ failed }: { failed: boolean }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  if (failed) {
    return (
      <div className="af-card" role="alert" style={{ padding: 16, marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          {es ? 'El tablero de todas las ligas no se cargó.' : 'The all-leagues board did not load.'}
        </p>
        <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
          {es
            ? 'Algo falló de nuestro lado; tus ligas no se vieron afectadas. Abre una abajo o '
            : 'Something failed on our side — your leagues are untouched. Open one below, or '}
          <a href="/core/matchup">{es ? 'inténtalo de nuevo' : 'try again'}</a>.
        </p>
      </div>
    )
  }
  return (
    <p>
      <Link href="/core/matchup">{es ? 'Volver a tu posición' : 'Back to where you stand'}</Link>
    </p>
  )
}
