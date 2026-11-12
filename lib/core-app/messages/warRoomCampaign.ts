import { defineMessages } from '@/lib/i18n/messages'
import type { WarCampaign } from '@/lib/core-app/warRoomCampaign'

type NoneWhy = Extract<WarCampaign, { kind: 'none' }>['why']

/**
 * War Room phase 5 — the road ahead (components/core-app/screens/WarCampaign.tsx).
 *
 * ⚠ OPPONENTS ARE DESCRIBED BY FACTS ONLY — a record and their own playoff odds. Never "a must-beat
 * rival" or "an easy win": Scout's "facts, never labels" rule covers every screen in the War Room.
 * "Biggest game left" describes YOUR game, which is the user's own business.
 */
export const warRoomCampaignMessages = defineMessages({
  en: {
    heading: 'The road ahead',
    lead: (pct: string) =>
      `Your playoff odds today: ${pct}%. Every game you have left, priced both ways — the wider the gap between winning and losing it, the more that week decides your season.`,
    basis: 'From Season Outlook’s simulation, run once with each result fixed.',
    week: (n: number) => `Week ${n}`,
    vs: (name: string | null) => (name ? `vs ${name}` : 'vs an unnamed team'),
    oppFact: (record: string, pct: string | null) => (pct == null ? record : `${record} · ${pct}% playoff odds`),
    win: (pct: string) => `Win: ${pct}%`,
    lose: (pct: string) => `Lose: ${pct}%`,
    swing: (pts: string) => `${pts}-point swing`,
    biggest: 'Biggest game left',
    small: 'Barely moves your odds',
    inProgress: (week: number) => `Week ${week} is under way, so it isn’t ranked here.`,
    unpriced: (n: number) => `${n} later ${n === 1 ? 'game isn’t' : 'games aren’t'} priced here.`,
    median: 'This league also plays the week’s median score; these odds fix only the head-to-head result.',
    none: (why: NoneWhy): string =>
      ({
        clinched: 'Your playoff spot is clinched, so no game left can change that.',
        eliminated: 'You’re out of the playoff race, so no game left changes that.',
        unplaced: 'Your odds can’t be modelled yet, so your games aren’t priced.',
        no_games: 'No regular-season games left.',
      })[why],
    tiebreakHeading: 'If records tie',
    tiebreakLead: (n: number) => `Ties are broken by points for. You and every team within a win of you; the top ${n} make the playoffs.`,
    you: 'You',
    inField: 'in the field',
    pointsFor: (pts: string) => `${pts} pts`,
    gap: (signed: string) => `${signed} vs you`,
  },
  es: {
    heading: 'El camino por delante',
    lead: (pct) =>
      `Tus probabilidades de playoffs hoy: ${pct}%. Cada partido que te queda, con los dos resultados posibles — cuanto mayor la diferencia entre ganarlo y perderlo, más decide esa semana tu temporada.`,
    basis: 'De la simulación de Perspectiva de temporada, con cada resultado fijado.',
    week: (n) => `Semana ${n}`,
    vs: (name) => (name ? `contra ${name}` : 'contra un equipo sin nombre'),
    oppFact: (record, pct) => (pct == null ? record : `${record} · ${pct}% de prob. de playoffs`),
    win: (pct) => `Si ganas: ${pct}%`,
    lose: (pct) => `Si pierdes: ${pct}%`,
    swing: (pts) => `${pts} puntos de diferencia`,
    biggest: 'El partido más importante que queda',
    small: 'Apenas cambia tus probabilidades',
    inProgress: (week) => `La semana ${week} está en juego, así que no se ordena aquí.`,
    unpriced: (n) => (n === 1 ? 'Un partido posterior no se calcula aquí.' : `${n} partidos posteriores no se calculan aquí.`),
    median: 'Esta liga también juega contra la mediana de la semana; estas probabilidades fijan solo el resultado directo.',
    none: (why) =>
      ({
        clinched: 'Tu lugar en playoffs está asegurado, así que ningún partido restante puede cambiarlo.',
        eliminated: 'Estás fuera de la carrera por playoffs, así que ningún partido restante lo cambia.',
        unplaced: 'Todavía no se pueden modelar tus probabilidades, así que tus partidos no se calculan.',
        no_games: 'No quedan partidos de temporada regular.',
      })[why as NoneWhy],
    tiebreakHeading: 'Si hay empate de récord',
    tiebreakLead: (n) => `Los empates se rompen por puntos a favor. Tú y cada equipo a una victoria o menos de ti; los ${n} primeros llegan a playoffs.`,
    you: 'Tú',
    inField: 'dentro',
    pointsFor: (pts) => `${pts} pts`,
    gap: (signed) => `${signed} frente a ti`,
  },
})
