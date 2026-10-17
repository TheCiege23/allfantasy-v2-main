import { describe, expect, it } from 'vitest'
import { isScopedRosterReviewQuestion } from '@/lib/chimmy/rosterReviewIntent'

describe('selected-league roster evidence intent', () => {
  const reportedQuestion = 'Count my complete roster by position and explain injury risks using current Decision OS evidence. Respect Best Ball rules and disclose missing data or unverified swap eligibility.'

  it('keeps the reported complete-roster question in the selected league', () => {
    expect(isScopedRosterReviewQuestion(reportedQuestion, true)).toBe(true)
  })

  it.each([
    'How many quarterbacks are on my team?',
    'Summarize my selected-league roster injuries.',
    'Break down our roster depth.',
    'Compare my roster depth at RB and TE.',
    'Review my BB Dynasty League 26! Best Ball roster using Decision OS.',
  ])('keeps a personal roster analysis selected: %s', (question) => {
    expect(isScopedRosterReviewQuestion(question, true)).toBe(true)
  })

  it.each([
    'Review my roster injuries across all my leagues.',
    'Count my injured roster players in all my current NFL leagues.',
    'Explain injury risks for my rosters across leagues.',
    'Check my rosters across multiple leagues.',
    'Count all our rosters by position.',
    'Review my team injuries in all of my current NFL leagues.',
  ])('preserves an explicit cross-league request: %s', (question) => {
    expect(isScopedRosterReviewQuestion(question, true)).toBe(false)
  })

  it('does not invent selected scope when there is no selected league', () => {
    expect(isScopedRosterReviewQuestion(reportedQuestion, false)).toBe(false)
  })

  it('does not turn a direct athlete lookup into a roster review', () => {
    expect(isScopedRosterReviewQuestion('Patrick Mahomes injury update', true)).toBe(false)
  })
})
