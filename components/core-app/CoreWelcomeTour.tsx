'use client'

import Link from 'next/link'
import { availableImportPlatformsPhrase } from '@/lib/league-import/provider-ui-config'
import { useEffect, useState } from 'react'
import { useHomePromptTurn } from '@/components/core-app/HomePromptSlot'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import '@/components/core-app/core-welcome-tour.css'

const STORAGE_KEY = 'af-core-welcome-v1'

/*
 * ⚠ THE LAST STEP USED TO SEND EVERY NEW USER TO /core/hubs — the multi-format commissioner hubs
 * (Zombie, Guillotine, C2C…), a screen most managers never need. It now goes where the step's own
 * copy points: the lineup check when there are leagues, the import when there are none. Step 1 told
 * people to "Open Leagues", a label nothing on screen carries; it names the league switcher instead,
 * and the finish button no longer says "Core", which is our name for the app, not theirs.
 *
 * Shown on the home screen only (AfCoreShell) — opening it over a lineup or a trade interrupted the
 * very task it was introducing.
 */

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
        ? 'Usa el selector de ligas de arriba para cambiar entre ellas. AllFantasy muestra tus datos sin modificar tu plataforma original.'
        : `Importa desde ${availableImportPlatformsPhrase()}. AllFantasy lee tu liga sin modificar la plataforma original.`,
      action: leagueCount > 0 ? undefined : { label: 'Importar una liga', href: '/import' },
    },
    {
      kicker: '2 · Elige',
      title: 'Una liga o todas',
      body: 'Elige una liga para mantenerla seleccionada al cambiar de sección, o «Todas las ligas» para verlas juntas.',
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
      action: leagueCount > 0
        ? { label: 'Revisar mis alineaciones', href: '/core/my-team' }
        : { label: 'Importar una liga', href: '/import' },
    },
  ] : [
    {
      kicker: '1 · Connect',
      title: leagueCount > 0 ? `${leagueCount} ${leagueCount === 1 ? 'league ready' : 'leagues ready'}` : 'Bring your leagues together',
      body: leagueCount > 0
        ? 'Use the league switcher at the top to move between them. AllFantasy shows your data without changing the original platform.'
        : `Import from ${availableImportPlatformsPhrase()}. AllFantasy reads the league and leaves the original platform unchanged.`,
      action: leagueCount > 0 ? undefined : { label: 'Import a league', href: '/import' },
    },
    {
      kicker: '2 · Choose',
      title: 'One league or all leagues',
      body: 'Choose a league and it stays selected as you move between tabs, or pick “All leagues” to see them together.',
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
      action: leagueCount > 0
        ? { label: 'Check my lineups', href: '/core/my-team' }
        : { label: 'Import a league', href: '/import' },
    },
  ]

  // One optional prompt at a time on the /core home (HomePromptSlot).
  const turn = useHomePromptTurn('welcome-tour', open)
  if (!turn) return null
  const current = steps[step]

  function finish() {
    try { window.localStorage.setItem(STORAGE_KEY, 'done') } catch {}
    setOpen(false)
  }

  return (
    <section className="af-welcome" aria-labelledby="af-welcome-title">
      <div
        className="af-welcome-progress"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={step + 1}
        aria-label={spanish ? `Paso ${step + 1} de ${steps.length}` : `Step ${step + 1} of ${steps.length}`}
      >
        {steps.map((_, index) => <i key={index} data-active={index <= step} />)}
      </div>
      <button type="button" className="af-welcome-close" aria-label={spanish ? 'Cerrar guía de bienvenida' : 'Dismiss welcome guide'} onClick={finish}>×</button>
      <span className="af-welcome-kicker">{current.kicker}</span>
      <h2 id="af-welcome-title">{current.title}</h2>
      <p>{current.body}</p>
      <div className="af-welcome-actions">
        {current.action ? <Link href={current.action.href} onClick={finish}>{current.action.label}</Link> : null}
        {step > 0 ? <button type="button" onClick={() => setStep((value) => value - 1)}>{spanish ? 'Atrás' : 'Back'}</button> : null}
        {step < steps.length - 1 ? (
          <button type="button" className="af-welcome-next" onClick={() => setStep((value) => value + 1)}>{spanish ? 'Siguiente' : 'Next'}</button>
        ) : (
          <button type="button" className="af-welcome-next" onClick={finish}>{spanish ? 'Empezar' : 'Get started'}</button>
        )}
      </div>
    </section>
  )
}
