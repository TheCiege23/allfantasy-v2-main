import { defineMessages } from '@/lib/i18n/messages'

/**
 * Room v2 header (2026-11): the one pick pill, Ask Chimmy, the ⋯ room menu's sound row, and the
 * board's on-the-clock tile. Spanish is complete: `__tests__/core-app/message-catalogs-complete.test.ts`
 * fails on a missing key.
 */
export const draftRoomHeaderMessages = defineMessages({
  en: {
    upIn: (n: number): string => (n === 1 ? 'You’re up next' : `You’re up in ${n}`),
    askChimmy: 'Ask Chimmy',
    roomMenu: 'Room menu',
    sound: 'Sound',
    soundOn: 'On',
    soundOff: 'Off',
    soundHint: 'Beeps in the last 10 seconds of a pick',
    onTheClock: 'On the clock',
    // League notes beside the league-type chip (room v2 league signatures).
    noteGuillotine: (week: number, n: number): string =>
      `Chops start Week ${week} · ${n} ${n === 1 ? 'team' : 'teams'} a week`,
    notePirate: (n: number): string => `Protect ${n} ${n === 1 ? 'player' : 'players'} a week`,
    noteCap: (cap: number): string => `$${cap} cap`,
    noteBestBall: 'Lineups set themselves',
    noteBigBrother: 'Head of Household and an eviction every week',
    /** A snake salary-cap slot: what the pick is signed to. */
    slotSalary: (salary: number, years: number): string =>
      `Salary $${salary} for ${years} ${years === 1 ? 'year' : 'years'}`,
    /** A stage 2/3 tournament seat's seed from the previous stage. */
    seed: (n: number): string => `Seed ${n} from the last stage`,
    /** A kept player's year as a keeper, on his tile (2+ only). */
    keeperYear: (n: number): string => `Yr ${n}`,
    keeperYearTitle: (n: number): string => `Year ${n} as a keeper`,
  },
  es: {
    upIn: (n: number): string => (n === 1 ? 'Te toca después' : `Te toca en ${n}`),
    askChimmy: 'Pregúntale a Chimmy',
    roomMenu: 'Menú de la sala',
    sound: 'Sonido',
    soundOn: 'Activado',
    soundOff: 'Desactivado',
    soundHint: 'Pitidos en los últimos 10 segundos de cada selección',
    onTheClock: 'En el reloj',
    noteGuillotine: (week: number, n: number): string =>
      `Eliminaciones desde la semana ${week} · ${n} ${n === 1 ? 'equipo' : 'equipos'} por semana`,
    notePirate: (n: number): string => `Protege ${n} ${n === 1 ? 'jugador' : 'jugadores'} por semana`,
    noteCap: (cap: number): string => `Tope de $${cap}`,
    noteBestBall: 'La alineación se arma sola',
    noteBigBrother: 'Jefe de Casa y una expulsión cada semana',
    slotSalary: (salary: number, years: number): string =>
      `Salario de $${salary} por ${years} ${years === 1 ? 'año' : 'años'}`,
    seed: (n: number): string => `Cabeza de serie ${n} de la etapa anterior`,
    keeperYear: (n: number): string => `Año ${n}`,
    keeperYearTitle: (n: number): string => `Año ${n} como keeper`,
  },
})
