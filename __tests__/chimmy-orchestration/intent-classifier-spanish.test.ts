import { describe, expect, it } from 'vitest'

import { classifyChimmyIntent, classifyChimmyTurn } from '@/lib/chimmy-orchestration/intent-classifier'
import { DECISION_CHECK_INTENTS } from '@/lib/chimmy/decisionAnswerCheck'

/**
 * Owner decision 2026-11-28: Spanish questions route like their English twins. Before this,
 * "¿acepto este intercambio?" was `general`, so the turn got no `pendingTrades` slice and no
 * second-model check. Every row is asked twice — with accents and with them stripped — because
 * people type both on a phone.
 */
const SPANISH: Array<[string, string]> = [
  // trade
  ['¿Acepto este intercambio?', 'trade'],
  ['¿Debo aceptar la oferta de Bob?', 'trade'],
  ['¿Cambio a Puka Nacua por Bijan Robinson?', 'trade'],
  ['¿Qué darías por Puka?', 'trade'],
  ['¿Rechazo esta contraoferta?', 'trade'],
  // waiver
  ['¿A quién recojo de agentes libres esta semana?', 'waiver'],
  ['¿Cuánto FAAB debo pujar por Bucky Irving?', 'waiver'],
  ['¿Qué jugador suelto para fichar a un receptor?', 'waiver'],
  ['¿Quién está en la lista de waivers?', 'waiver'],
  // start_sit
  ['¿Pongo de titular a Mahomes o a Allen?', 'start_sit'],
  ['¿Cuál es mi mejor alineación esta semana?', 'start_sit'],
  ['¿A quién mando a la banca?', 'start_sit'],
  ['¿Debo alinear a Kelce?', 'start_sit'],
  // draft
  ['¿A quién debo draftear en la 1.03?', 'draft'],
  ['¿Cuál es mi mejor selección en la primera ronda del draft?', 'draft'],
  ['¿En qué ronda debo elegir un pateador?', 'draft'],
  ['¿Qué novatos valen la pena?', 'draft'],
  // commissioner
  ['¿Como comisionado debo vetar este intercambio?', 'commissioner'],
  ['¿Cómo cambio las reglas de la liga?', 'commissioner'],
  ['¿Cuándo es la fecha límite de intercambios en mi liga?', 'commissioner'],
  ['¿Qué managers están inactivos en mi liga?', 'commissioner'],
  // injury
  ['¿Está lesionado Cooper Kupp?', 'injury'],
  ['¿Cómo va la lesión de Christian McCaffrey?', 'injury'],
  // weather
  ['¿Va a afectar la lluvia el partido de los Bills?', 'weather'],
  ['¿Cómo está el clima en Green Bay?', 'weather'],
  // matchup
  ['¿Contra quién juego esta semana?', 'matchup'],
  ['¿Cómo se ve mi enfrentamiento contra mi rival?', 'matchup'],
  // league_strength
  ['¿Cuáles son los equipos más fuertes de la liga?', 'league_strength'],
  ['Muéstrame el ranking de poder', 'league_strength'],
  // manager_psychology
  ['¿Qué tipo de mánager es Stavros?', 'manager_psychology'],
  ['¿Cuáles son las tendencias de Bob en los intercambios?', 'manager_psychology'],
  // story_recap
  ['Dame el resumen de la semana 5', 'story_recap'],
  ['Cuéntame la historia de mi temporada', 'story_recap'],
  // player_value
  ['¿Cuánto vale Bijan Robinson en dinastía?', 'player_value'],
  ['¿Es momento de vender alto a Jayden Daniels?', 'player_value'],
  // bracket
  ['¿Cómo va mi quiniela del Mundial?', 'bracket'],
  // general — must stay general
  ['¿Cómo funciona la puntuación en superflex?', 'general'],
  ['Hola Chimmy, ¿qué tal?', 'general'],
  ['¿A qué hora empieza el partido de los Chiefs?', 'general'],
]

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

describe('Spanish intent routing', () => {
  for (const [question, expected] of SPANISH) {
    it(`${question} → ${expected}`, () => {
      expect(classifyChimmyIntent(question).intent).toBe(expected)
    })
    it(`${stripAccents(question)} (no accents) → ${expected}`, () => {
      expect(classifyChimmyIntent(stripAccents(question)).intent).toBe(expected)
    })
  }

  it('the reported question now earns the second-model check', () => {
    const { intent } = classifyChimmyTurn('¿acepto este intercambio?')
    expect(intent).toBe('trade')
    expect(DECISION_CHECK_INTENTS.has(intent)).toBe(true)
  })

  it('a Spanish follow-up that names nothing inherits the previous Spanish turn', () => {
    expect(classifyChimmyTurn('¿y si añade una segunda ronda?', '¿Acepto este intercambio?').intent).toBe('trade')
  })

  it('a Spanish word inside an English question does not hijack an English route', () => {
    expect(classifyChimmyIntent('Should I start Mahomes or Allen? gracias').intent).toBe('start_sit')
  })
})

/**
 * CONTROL: the English classifications are unchanged. Each row was read off the classifier at the
 * base commit before the Spanish vocabulary existed, including the `general` ones — those are the
 * rows a Spanish fallback could steal from.
 */
const ENGLISH: Array<[string, string]> = [
  ['Should I accept this trade?', 'trade'],
  ['Who should I claim off waivers this week?', 'waiver'],
  ['Should I start Mahomes or Allen?', 'start_sit'],
  ['Who should I draft at 1.03?', 'draft'],
  ['Should I veto this trade as commissioner?', 'commissioner'],
  ['Which managers are inactive in my league?', 'commissioner'],
  ['Who is my opponent this week?', 'matchup'],
  ['Show me the power rankings', 'league_strength'],
  ['What kind of manager is Stavros?', 'manager_psychology'],
  ['Give me the week 5 recap', 'story_recap'],
  ['What is Bijan worth in dynasty?', 'player_value'],
  ['How does superflex scoring work?', 'general'],
  ['What time does the Chiefs game start tonight?', 'general'],
  ['Is Cooper Kupp injured?', 'general'],
  ['Will the weather affect the Bills game?', 'general'],
  ['How is my bracket doing?', 'general'],
  ['Where can I stream the Bills game?', 'general'],
  ['Is Travis Kelce in decline?', 'general'],
  ['Hello Chimmy', 'general'],
]

describe('English control — unchanged by the Spanish vocabulary', () => {
  for (const [question, expected] of ENGLISH) {
    it(`${question} → ${expected}`, () => {
      expect(classifyChimmyIntent(question).intent).toBe(expected)
    })
  }
})
