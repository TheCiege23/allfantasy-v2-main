import { defineMessages } from '@/lib/i18n/messages'

/**
 * Team workspace lineup checks (lib/core-app/teamWorkspace.ts, `teamHealth`) — the label and detail
 * of each check the workspace raises about a lineup, the taxi squad and injured reserve.
 * Every string is the one `teamHealth` wrote before the move, byte for byte, in both languages — this
 * is a relocation, not a rewrite. Player names, slot labels and positions are data and stay.
 */
export const teamWorkspaceMessages = defineMessages({
  en: {
    lineupUnavailable: 'Lineup unavailable',

    slotEmpty: (slot: string): string => `${slot} is empty`,
    slotEmptyDetail: 'Review an eligible player and the provider deadline.',

    positionMismatch: (name: string): string => `${name}: position mismatch`,
    positionMismatchDetail: (position: string | null | undefined, slot: string): string =>
      `${position ?? 'Unknown position'} does not match ${slot}; verify the provider’s eligibility.`,

    bye: 'bye',
    unavailable: 'unavailable',
    unavailableDetailAutomatic: 'Review depth; scoring selects players automatically.',
    unavailableDetailManual: 'Review eligibility and individual game locks.',

    identityUnavailable: 'Player identity unavailable',
    identityDetail: (slot: string): string => `${slot}: this player could not be resolved.`,

    taxiTenureReached: (name: string): string => `${name}: taxi tenure reached`,
    taxiTenureDetail: 'Review the league’s promotion rules before moving this player.',

    irReview: (name: string): string => `${name}: review IR eligibility`,
    irReviewDetail:
      'The saved injury designation does not match this league’s allowed IR statuses. Verify current status before moving.',
    irGeneral: 'Review injured reserve eligibility',
    irGeneralDetail:
      'Injury labels alone do not establish your provider’s IR eligibility. Verify before adding or moving a player.',

    taxiOverCapacity: 'Taxi squad exceeds capacity',
    taxiOverCapacityDetail: (players: number, slots: number): string => `${players} players for ${slots} saved slots.`,
  },
  es: {
    lineupUnavailable: 'Alineación no disponible',

    slotEmpty: (slot) => `${slot} está vacía`,
    slotEmptyDetail: 'Revisa un jugador elegible y el plazo de la plataforma.',

    positionMismatch: (name) => `${name}: posición incompatible`,
    positionMismatchDetail: (position, slot) =>
      `${position ?? 'Posición desconocida'} no coincide con ${slot}; verifica la elegibilidad en la plataforma.`,

    bye: 'descanso',
    unavailable: 'no disponible',
    unavailableDetailAutomatic: 'Revisa la profundidad; la puntuación selecciona jugadores automáticamente.',
    unavailableDetailManual: 'Revisa la elegibilidad y los bloqueos de cada partido.',

    identityUnavailable: 'Identidad de jugador no disponible',
    identityDetail: (slot) => `${slot}: no se pudo identificar a este jugador.`,

    taxiTenureReached: (name) => `${name}: límite de permanencia en taxi alcanzado`,
    taxiTenureDetail: 'Revisa las reglas de promoción de la liga antes de mover a este jugador.',

    irReview: (name) => `${name}: revisar elegibilidad para IR`,
    irReviewDetail:
      'El estado de lesión guardado no coincide con los estados permitidos en IR en esta liga. Verifica el estado actual antes de mover al jugador.',
    irGeneral: 'Revisar elegibilidad para reserva por lesión',
    irGeneralDetail:
      'El estado de lesión por sí solo no determina la elegibilidad para IR en tu plataforma. Verifica antes de añadir o mover a un jugador.',

    taxiOverCapacity: 'La plantilla taxi supera la capacidad',
    taxiOverCapacityDetail: (players, slots) => `${players} jugadores para ${slots} plazas guardadas.`,
  },
})
