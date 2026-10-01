'use client'

import Link from 'next/link'
import { availableImportPlatformsPhrase } from '@/lib/league-import/provider-ui-config'
import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import '@/components/core-app/core-welcome-tour.css'

const STORAGE_KEY = 'af-core-welcome-v1'

type Step = {
  kicker: string
  title: string
  body: string
  action?: { label: string; href: string }
}

export function CoreWelcomeTour({ leagueCount }: { leagueCount: number }) {
  const { language } = useOptionalLanguage()
  const spanish = language === 'es'
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(STORAGE_KEY) !== 'done')
    } catch {
      // Private browsing can deny storage. Showing the guide once in this mount
      // is still more useful than withholding it completely.
      setOpen(true)
    }
  }, [])

  const steps: Step[] = spanish ? [
    {
      kicker: '1 · Conecta',
      title: leagueCount > 0 ? `${leagueCount} ${leagueCount === 1 ? 'liga lista' : 'ligas listas'}` : 'Reúne tus ligas',
      body: leagueCount > 0
        ? 'Abre Ligas para cambiar de liga. AllFantasy muestra tus datos sin modificar tu plataforma original.'
        : `Importa desde ${availableImportPlatformsPhrase()}. AllFantasy lee tu liga sin modificar la plataforma original.`,
      action: leagueCount > 0 ? { label: 'Revisar mi semana', href: '/core/week' } : { label: 'Importar una liga', href: '/import' },
    },
    {
      kicker: '2 · Elige',
      title: 'Una liga o todas',
      body: 'Elige una liga para mantenerla seleccionada al cambiar de sección. También puedes ver todas tus ligas juntas.',
    },
    {
      kicker: '3 · Consulta',
      title: 'Pregúntale a Chimmy',
      body: 'Dentro de una liga, Chimmy usa sus reglas, plantilla, calendario y movimientos. Desde Inicio compara tus ligas.',
    },
    {
      kicker: '4 · Juega',
      title: 'Organiza tu semana aquí',
      body: 'Sincroniza cambios, revisa tu alineación y agentes libres, analiza intercambios y usa las herramientas del comisionado.',
      action: { label: 'Abrir centro de ligas', href: '/core/hubs' },
    },
  ] : [
    {
      kicker: '1 · Connect',
      title: leagueCount > 0 ? `${leagueCount} ${leagueCount === 1 ? 'league ready' : 'leagues ready'}` : 'Bring your leagues together',
      body: leagueCount > 0
        ? 'Open Leagues to switch between them. AllFantasy shows your data without changing the original platform.'
        : `Import from ${availableImportPlatformsPhrase()}. AllFantasy reads the league and leaves the original platform unchanged.`,
      action: leagueCount > 0 ? { label: 'Review my week', href: '/core/week' } : { label: 'Import a league', href: '/import' },
    },
    {
      kicker: '2 · Choose',
      title: 'One league or all leagues',
      body: 'Choose a league and it stays selected as you move between tabs. You can also see all your leagues together.',
    },
    {
      kicker: '3 · Ask',
      title: 'Ask Chimmy about your league',
      body: 'Inside a league, Chimmy uses its rules, roster, schedule and moves. From Home, compare priorities across all your leagues.',
    },
    {
      kicker: '4 · Play',
      title: 'Run the week from one place',
      body: 'Sync changes, check your lineup and waivers, review trades, and use commissioner tools when you run the league.',
      action: { label: 'Open the league hub', href: '/core/hubs' },
    },
  ]

  if (!open) return null
  const current = steps[step]

  function finish() {
    try { window.localStorage.setItem(STORAGE_KEY, 'done') } catch {}
    setOpen(false)
  }

  return (
    <aside className="af-welcome" role="dialog" aria-modal="false" aria-labelledby="af-welcome-title">
      <div className="af-welcome-progress" aria-label={spanish ? `Paso ${step + 1} de ${steps.length}` : `Step ${step + 1} of ${steps.length}`}>
        {steps.map((_, index) => <i key={index} data-active={index <= step} />)}
      </div>
      <button type="button" className="af-welcome-close" aria-label={spanish ? 'Cerrar guía de bienvenida' : 'Dismiss welcome guide'} onClick={finish}>×</button>
      <span className="af-welcome-kicker">{current.kicker}</span>
      <h2 id="af-welcome-title">{current.title}</h2>
      <p>{current.body}</p>
      {step === 0 ? (
        <p className="af-welcome-first-win">
          {leagueCount > 0
            ? spanish ? 'Primer objetivo: abre un enfrentamiento y revisa la próxima decisión de tu equipo.' : 'First win: open a matchup and review your next team decision.'
            : spanish ? 'Primer objetivo: conecta una liga para recibir consejos según tu plantilla y reglas.' : 'First win: connect a league to see advice based on your roster and rules.'}
        </p>
      ) : null}
      <div className="af-welcome-actions">
        {current.action ? <Link href={current.action.href} onClick={finish}>{current.action.label}</Link> : null}
        {step > 0 ? <button type="button" onClick={() => setStep((value) => value - 1)}>{spanish ? 'Atrás' : 'Back'}</button> : null}
        {step < steps.length - 1 ? (
          <button type="button" className="af-welcome-next" onClick={() => setStep((value) => value + 1)}>{spanish ? 'Siguiente' : 'Next'}</button>
        ) : (
          <button type="button" className="af-welcome-next" onClick={finish}>{spanish ? 'Empezar' : 'Start using Core'}</button>
        )}
      </div>
    </aside>
  )
}
