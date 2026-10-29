import { describe, expect, it } from 'vitest'
import { defineMessages, messagesFor, missingMessages } from '@/lib/i18n/messages'
import { gamePlanMessages } from '@/lib/core-app/messages/gamePlan'

const sample = defineMessages({
  en: { title: 'Game plan', count: (n: number) => `${n} ${n === 1 ? 'league' : 'leagues'}` },
  es: { title: 'Plan de juego' },
})

describe('message catalogs', () => {
  it('returns English for en, an unknown language, or no language', () => {
    expect(messagesFor(sample, 'en').title).toBe('Game plan')
    expect(messagesFor(sample, 'zh').title).toBe('Game plan')
    expect(messagesFor(sample, null).title).toBe('Game plan')
  })

  it('overlays a language per key and falls back to English for the rest', () => {
    const es = messagesFor(sample, 'es')
    expect(es.title).toBe('Plan de juego')
    expect(es.count(2)).toBe('2 leagues')
    expect(missingMessages(sample, 'es')).toEqual(['count'])
  })

  it('returns the same merged object on repeat calls', () => {
    expect(messagesFor(sample, 'es')).toBe(messagesFor(sample, 'es'))
  })

  it('Game Plan is fully translated to Spanish', () => {
    expect(missingMessages(gamePlanMessages, 'es')).toEqual([])
    const es = messagesFor(gamePlanMessages, 'es')
    expect(es.title).toBe('Plan de juego')
    expect(es.waiversLink).toBe('Agentes libres')
    expect(es.leagues(1)).toBe('liga')
    expect(es.alreadyLocked(2)).toBe('ya bloqueados y al final')
  })

  it('a language with no Game Plan block reads English, never blank', () => {
    const zh = messagesFor(gamePlanMessages, 'zh')
    expect(zh.title).toBe('Game plan')
    expect(zh.daysAgo(3)).toBe('3d ago')
  })
})
