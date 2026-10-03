'use client'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { verificationAge, type LineupVerification as Verification } from '@/lib/core-app/lineupVerification'

export function LineupVerification({ verification }: { verification: Verification | null | undefined }) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [now, setNow] = useState<number | null>(null)
  /* Every sentence here was English under a Spanish screen (language audit, 2026-10-03). */
  const es = useOptionalLanguage().language === 'es'
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [verification?.checkedAt])
  const stale = verification && now != null && now - Date.parse(verification.checkedAt) >= 300000
  const t = es
    ? {
        section: 'Verificación de la alineación', week: 'Semana', checked: 'Alineación revisada',
        stale: ' · Actualiza antes de decidir la alineación.', fresh: ' · Titulares, banquillo, IR y taxi verificados.',
        none: 'No se pudo verificar la alineación. Los consejos de alineación quedan en pausa hasta una actualización correcta.',
        note: 'Esto revisa dónde está cada jugador en la alineación. Las noticias de lesiones y las proyecciones pueden actualizarse por separado.',
        checking: 'Revisando Sleeper…', refresh: 'Actualizar alineación',
      }
    : {
        section: 'Lineup verification', week: 'Week', checked: 'Lineup checked',
        stale: ' · Refresh before making a lineup decision.', fresh: ' · Starter, bench, IR and taxi placement verified.',
        none: 'Lineup could not be verified. Lineup advice is paused until a successful refresh.',
        note: 'This checks lineup placement. Injury news and projections may update separately.',
        checking: 'Checking Sleeper…', refresh: 'Refresh lineup',
      }
  return <section aria-label={t.section} className="af-frame af-lv">
    <strong className="af-lv-title">Sleeper{verification?.week != null ? ` · ${t.week} ${verification.week}` : ''}</strong>
    <p role="status" className="af-lv-status">{verification ? <><time dateTime={verification.checkedAt} title={verification.checkedAt}>{now == null ? t.checked : verificationAge(verification.checkedAt, now, es ? 'es' : 'en')}</time>{stale ? t.stale : t.fresh}</> : t.none}</p>
    <p className="af-lv-note">{t.note}</p>
    <button type="button" className="af-btn af-lv-refresh" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>{refreshing ? t.checking : t.refresh}</button>
  </section>
}
