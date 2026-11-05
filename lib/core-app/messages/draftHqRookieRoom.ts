import { defineMessages } from '@/lib/i18n/messages'

/** Draft HQ's dynasty draft room (components/core-app/screens/DraftHqRookieRoom.tsx). */
export const draftHqRookieRoomMessages = defineMessages({
  en: {
    roomLabel: 'Rookie draft room',
    dynasty: 'Dynasty',
    title: (kind: 'rookie' | 'startup' | 'dispersal', season: number | null): string => {
      const name = kind === 'startup' ? 'Startup draft' : kind === 'dispersal' ? 'Dispersal draft' : 'Rookie draft'
      return season != null ? `${season} ${name}` : name
    },
    tagline: (kind: 'rookie' | 'startup' | 'dispersal'): string =>
      kind === 'startup'
        ? 'Every roster in this dynasty starts here.'
        : kind === 'dispersal'
          ? 'Rosters without a manager, drafted back into the league.'
          : 'A new class arrives. The picks you traded for are on the clock.',
    rounds: 'Rounds',
    teams: 'Teams',
    status: (status: string): string =>
      ({ pre_draft: 'Not started', in_progress: 'Live now', paused: 'Paused' } as Record<string, string>)[status] ??
      status.replace(/_/g, ' '),
    statusLabel: 'Status',
    starts: (when: string) => `Starts ${when}`,
    opens: (when: string) => `Opens ${when}`,
    daysUnit: (n: number) => (n === 1 ? 'day' : 'days'),
    picksTitle: 'Your picks',
    picksHeld: (n: number) => (n === 1 ? 'pick in this draft' : 'picks in this draft'),
    firstRounders: (n: number) => (n === 1 ? '1 first-rounder' : `${n} first-rounders`),
    via: (team: string) => `via ${team}`,
    tradedAway: 'Traded away',
    tradedTo: (label: string, team: string) => `${label} to ${team}`,
    noPicks: 'You hold no picks in this draft.',
    roundLevel: 'Exact slots are set once the draft order is.',
    partial: 'Only picks that changed hands are on file for this draft.',
    boardTitle: 'Draft order',
    round: (n: number) => `Round ${n}`,
    you: 'You',
    yourPickAria: (label: string) => `${label}, your pick`,
    taxiTitle: 'Taxi squad',
    taxiUsed: (count: number, slots: number) => `${count} of ${slots} slots used`,
    taxiCount: (count: number) => (count === 1 ? '1 stashed player' : `${count} stashed players`),
    taxiRoom: (n: number) => (n === 1 ? 'Room to stash 1 rookie.' : `Room to stash ${n} rookies.`),
    taxiFull: 'Taxi squad is full — open a slot to stash a rookie.',
    slotFilled: 'Filled taxi slot',
    slotOpen: 'Open taxi slot',
    myTeam: 'My team →',
  },
  es: {
    roomLabel: 'Sala del draft de novatos',
    dynasty: 'Dinastía',
    title: (kind, season) => {
      const name = kind === 'startup' ? 'Draft inicial' : kind === 'dispersal' ? 'Draft de dispersión' : 'Draft de novatos'
      return season != null ? `${name} ${season}` : name
    },
    tagline: (kind) =>
      kind === 'startup'
        ? 'Cada plantilla de esta dinastía empieza aquí.'
        : kind === 'dispersal'
          ? 'Plantillas sin mánager, repartidas de nuevo en la liga.'
          : 'Llega una nueva generación. Las selecciones que conseguiste ya están en el reloj.',
    rounds: 'Rondas',
    teams: 'Equipos',
    status: (status) =>
      ({ pre_draft: 'Sin empezar', in_progress: 'En vivo', paused: 'En pausa' } as Record<string, string>)[status] ??
      status.replace(/_/g, ' '),
    statusLabel: 'Estado',
    starts: (when) => `Empieza ${when}`,
    opens: (when) => `Abre ${when}`,
    daysUnit: (n) => (n === 1 ? 'día' : 'días'),
    picksTitle: 'Tus selecciones',
    picksHeld: (n) => (n === 1 ? 'selección en este draft' : 'selecciones en este draft'),
    firstRounders: (n) => (n === 1 ? '1 de primera ronda' : `${n} de primera ronda`),
    via: (team) => `vía ${team}`,
    tradedAway: 'Traspasadas',
    tradedTo: (label, team) => `${label} a ${team}`,
    noPicks: 'No tienes selecciones en este draft.',
    roundLevel: 'Las posiciones exactas se fijan cuando se define el orden del draft.',
    partial: 'Solo constan las selecciones que cambiaron de manos en este draft.',
    boardTitle: 'Orden del draft',
    round: (n) => `Ronda ${n}`,
    you: 'Tú',
    yourPickAria: (label) => `${label}, tu selección`,
    taxiTitle: 'Escuadra taxi',
    taxiUsed: (count, slots) => `${count} de ${slots} plazas ocupadas`,
    taxiCount: (count) => (count === 1 ? '1 jugador reservado' : `${count} jugadores reservados`),
    taxiRoom: (n) => (n === 1 ? 'Espacio para reservar 1 novato.' : `Espacio para reservar ${n} novatos.`),
    taxiFull: 'La escuadra taxi está llena: libera una plaza para reservar un novato.',
    slotFilled: 'Plaza del taxi ocupada',
    slotOpen: 'Plaza del taxi libre',
    myTeam: 'Mi equipo →',
  },
})
