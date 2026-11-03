/**
 * Questions asked in Spanish reach the right Survivor rules answer (jury, finale, closing speeches,
 * votes, and the other core topics), without changing how English questions route.
 */
import { describe, expect, it } from 'vitest'
import { answerSurvivorRules, isSurvivorChimmyAsk, survivorRulesTopic } from '@/lib/survivor/survivorRulesAnswers'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/normalizeSurvivorSettings'

describe('Spanish rules topics', () => {
  it.each([
    ['¿Cómo funciona el jurado?', 'jury'],
    ['¿Quiénes son los finalistas?', 'jury'],
    ['¿Cuándo es la final?', 'jury'],
    ['¿Cómo funciona el Consejo Tribal Final?', 'jury'],
    ['¿Cómo funcionan los discursos finales?', 'jury'],
    ['¿Puedo editar mi discurso final?', 'jury'],
    ['@Chimmy ¿se revela quién votó por quién?', 'jury'],
    ['¿Cómo funcionan los votos?', 'voting'],
    ['¿Cómo se vota en el consejo tribal?', 'voting'],
    ['¿qué pasa con mi votación?', 'voting'],
    ['¿Qué pasa si hay un empate?', 'ties'],
    ['¿Cómo funcionan los ídolos?', 'idols'],
    ['¿Cuándo es la fusión?', 'merge'],
    ['¿Cómo funciona la inmunidad?', 'immunity'],
    ['¿Cómo funciona la Isla del Exilio?', 'exile'],
    ['¿Cómo funcionan los retos?', 'challenges'],
  ])('%s → %s', (message, topic) => {
    expect(survivorRulesTopic(message)).toBe(topic)
  })

  it('keeps the English list’s priority: a Spanish side-game question mentioning votes stays a side game', () => {
    expect(survivorRulesTopic('¿Cómo funcionan los votos en el pozo de fichas?')).toBe('token_pool')
  })

  it('leaves English routing alone, and a bare "final" is not a finale question', () => {
    expect(survivorRulesTopic('How does the jury work?')).toBe('jury')
    expect(survivorRulesTopic('How does voting work?')).toBe('voting')
    expect(survivorRulesTopic('what was the final score?')).toBeNull()
    expect(survivorRulesTopic('Nos vemos el jueves')).toBeNull() // not a question, no topic
  })

  it('routes a Spanish @Chimmy ask to the Survivor host and answers it in Spanish', () => {
    expect(isSurvivorChimmyAsk('@Chimmy ¿cómo funciona el jurado?')).toBe(true)
    const answer = answerSurvivorRules(survivorRulesTopic('¿Cómo funciona el jurado?')!, { sport: 'NFL', settings: normalizeSurvivorFoundationSettings({}), plan: null, language: 'es' })
    expect(answer.split('\n')[0]).toBe('**Jurado y final**')
  })
})
