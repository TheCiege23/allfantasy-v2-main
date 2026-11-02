'use client'

import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'
import { getZombieCreationProfile, ZOMBIE_MAX_UNIVERSE_LEAGUES } from '@/lib/zombie/creationPolicy'

export const zombieCreationMessages = defineMessages({
  en: {
    title: 'Build your Zombie universe',
    count: 'Leagues to create',
    single: 'One league',
    multiple: (n: number): string => `${n} leagues · shared rules and settings`,
    seats: (leagues: number, managers: number): string => `${managers} managers per league · ${leagues * managers} roster seats in total`,
    shared: 'Every league starts with the same sport, scoring, roster, draft, free agency, privacy and automation settings. Each gets its own invite link. Your Zombie commissioner hub opens after creation.',
    solo: 'Create one league now, or choose up to six together in a commissioner universe. Drafts remain unstarted.',
    calendar: (periods: number, suggested: number): string => `Current season profile: ${periods} scoring periods. Default: 20 managers. Periods + 2, rounded up to an even number, suggests ${suggested} managers as a planning reference.`,
    caution: 'Manager count cannot guarantee Survivors last the whole season: infections and revivals vary. Larger fields spread the player pool across more rosters; review roster depth before drafting.',
    soccer: 'Soccer periods depend on the selected competition. Review its calendar and player pool before choosing a large field.',
    imported: 'Imported rosters carry into one league. Create a separate universe to build several new leagues.',
  },
  es: {
    title: 'Crea tu universo Zombie',
    count: 'Ligas a crear',
    single: 'Una liga',
    multiple: (n: number): string => `${n} ligas · mismas reglas y ajustes`,
    seats: (leagues: number, managers: number): string => `${managers} managers por liga · ${leagues * managers} plazas en total`,
    shared: 'Todas las ligas empiezan con el mismo deporte, puntuación, plantilla, draft, agencia libre, privacidad y automatización. Cada una recibe su enlace de invitación. Al terminar se abre tu centro de comisionado Zombie.',
    solo: 'Crea una liga o hasta seis juntas en un universo. Los drafts quedan sin iniciar.',
    calendar: (periods: number, suggested: number): string => `Perfil actual: ${periods} periodos de puntuación. Predeterminado: 20 managers. Periodos + 2, redondeado al siguiente número par, sugiere ${suggested} managers como referencia.`,
    caution: 'El número de managers no garantiza Supervivientes durante toda la temporada: las infecciones y reanimaciones varían. Más equipos comparten los jugadores disponibles; revisa la profundidad de plantilla antes del draft.',
    soccer: 'Los periodos de fútbol dependen de la competición. Revisa su calendario y jugadores antes de elegir muchos equipos.',
    imported: 'Las plantillas importadas pasan a una sola liga. Crea un universo separado para generar varias ligas nuevas.',
  },
})

export function ZombieCreationOptions({ state, onChange, importCarryover }: {
  state: CreateLeagueV2State
  onChange: (patch: Partial<CreateLeagueV2State>) => void
  importCarryover?: boolean
}) {
  const m = useMessages(zombieCreationMessages)
  const profile = getZombieCreationProfile(state.sport)
  const count = importCarryover ? 1 : state.zombieLeagueCount ?? 1
  return (
    <fieldset className="space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4" data-testid="g30-zombie-universe">
      <legend className="px-2 text-sm font-bold">{m.title}</legend>
      <label className="block space-y-2 text-sm font-semibold" htmlFor="zombie-league-count">
        <span>{m.count}</span>
        <select id="zombie-league-count" data-testid="g30-zombie-league-count" value={count}
          disabled={importCarryover} onChange={(event) => onChange({ zombieLeagueCount: Number(event.target.value) })}
          className="min-h-12 w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] px-3 text-[color:var(--text-primary)]">
          {Array.from({ length: ZOMBIE_MAX_UNIVERSE_LEAGUES }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n === 1 ? m.single : m.multiple(n)}</option>
          ))}
        </select>
      </label>
      <p className="text-sm font-semibold" aria-live="polite">{m.seats(count, state.teamCount)}</p>
      <p className="text-xs leading-5 text-[color:var(--text-secondary)]">{importCarryover ? m.imported : count > 1 ? m.shared : m.solo}</p>
      <p className="text-xs leading-5 text-[color:var(--text-secondary)]">{m.calendar(profile.scoringPeriods, profile.suggestedManagers)}</p>
      <p className="text-xs leading-5 text-[color:var(--text-secondary)]">{m.caution}</p>
      {state.sport === 'SOCCER' ? <p className="text-xs leading-5 text-[color:var(--text-secondary)]">{m.soccer}</p> : null}
    </fieldset>
  )
}
