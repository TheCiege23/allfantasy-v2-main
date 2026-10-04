'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/** Partial history must not look like proof that the manager has never played. */
export function WeekHistoryNotice({ retryHref }: { retryHref: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  return (
    <div className="af-card" role="status" style={{ padding: 16, marginBottom: 16 }}>
      <p style={{ margin: 0, lineHeight: 1.5 }}>
        {es ? 'Parte del historial o del período de tus ligas no se pudo cargar. Los datos disponibles aparecen abajo; las proyecciones y rivalidades pueden estar incompletas.' : 'Some league history or scoring-period data could not load. Available data is shown below; projections and rivalries may be incomplete.'}
      </p>
      <a className="af-btn" href={retryHref} style={{ display: 'inline-flex', marginTop: 12, minHeight: 44, alignItems: 'center' }}>
        {es ? 'Intentar de nuevo' : 'Try again'}
      </a>
    </div>
  )
}
