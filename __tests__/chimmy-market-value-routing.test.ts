import { describe, expect, it } from 'vitest'
import { classifyPecrIntent, requiresLeagueGrounding } from '@/lib/chimmy-chat/question-routing'

const needsLeague = (message: string, extra = {}) => requiresLeagueGrounding({ message, intent: classifyPecrIntent(message), ...extra })

describe('market facts versus personal trade decisions', () => {
  it.each([
    "What's Bijan Robinson's dynasty trade value?",
    'What is Rashee Rice trade value in superflex?',
    'Show me FantasyCalc market values',
  ])('answers %s without silently selecting a league', message => {
    expect(needsLeague(message)).toBe(false)
  })
  it.each([
    'What is Bijan trade value in my league?',
    'Should I trade for Bijan at his dynasty value?',
    'What is Bijan trade value in the Draft Junkies league?',
    'Bijan is on the trade block, is he worth trading for?',
  ])('requires league evidence for %s', message => {
    expect(needsLeague(message)).toBe(true)
  })
  it('keeps explicit team and trade-tool context grounded', () => {
    expect(needsLeague('What is Bijan trade value?', { teamId: 'team' })).toBe(true)
    expect(needsLeague('What is Bijan trade value?', { source: 'trade-evaluator' })).toBe(true)
  })
})
