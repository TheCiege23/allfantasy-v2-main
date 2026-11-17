import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeagueFormatFaqLink } from '@/components/league/LeagueFormatFaqLink'
import { leagueFormatFaqHref } from '@/lib/league/leagueFormatFaq'
import { LEAGUE_TYPE_GUIDES } from '@/lib/league/league-type-guide'

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => lang }))
afterEach(() => { cleanup(); lang.language = 'en' })
const faq = '/league-types/faq'

describe('member format FAQ links', () => {
  it.each(Object.keys(LEAGUE_TYPE_GUIDES))('links %s to its own rules without commissioner privileges', (leagueType) => {
    render(<LeagueFormatFaqLink league={{ leagueType }} />)
    const link = screen.getByRole('link', { name: 'Format rules FAQ' })
    expect(link.getAttribute('href')).toBe(faq + '#' + leagueType)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('title')).toContain('Check your league settings')
  })
  it('uses persisted format before modifiers, legacy labels and mode flags', () => {
    expect(leagueFormatFaqHref({ leagueType: 'redraft', leagueVariant: 'guillotine', isDynasty: true })).toBe(faq + '#redraft')
    expect(leagueFormatFaqHref({ leagueType: 'keeper', settings: { league_type: 'dynasty' }, bestBallMode: true })).toBe(faq + '#keeper')
    expect(leagueFormatFaqHref({ settings: { leagueType: 'SALARY_CAP' }, leagueVariant: 'superflex' })).toBe(faq + '#salary_cap')
    expect(leagueFormatFaqHref({ leagueType: 'future_format', isDynasty: false })).toBe(faq)
  })
  it.each([
    ['bestball', 'best_ball'], ['Best Ball', 'best_ball'], ['devy_dynasty', 'devy'],
    ['merged_devy_c2c', 'c2c'], ['tournament_mode', 'tournament'], ['dynasty_idp', 'dynasty'],
    ['idp', 'modifier-idp'], ['survivor_guillotine', 'survivor-guillotine'],
  ])('recognizes the legacy identity %s', (value, anchor) => {
    expect(leagueFormatFaqHref({ leagueVariant: value })).toBe(faq + '#' + anchor)
  })
  it('recognizes the Survivor Guilly redraft shell without replacing another canonical format', () => {
    expect(leagueFormatFaqHref({ leagueType: 'redraft', leagueVariant: 'survivor_guillotine' })).toBe(faq + '#survivor-guillotine')
    expect(leagueFormatFaqHref({ leagueType: 'dynasty', leagueVariant: 'survivor_guillotine' })).toBe(faq + '#dynasty')
  })
  it('handles imported mode flags, format labels and missing metadata', () => {
    expect(leagueFormatFaqHref({ guillotineMode: true })).toBe(faq + '#guillotine')
    expect(leagueFormatFaqHref({ settings: { best_ball_mode: true } })).toBe(faq + '#best_ball')
    expect(leagueFormatFaqHref({ format: 'Dynasty' })).toBe(faq + '#dynasty')
    expect(leagueFormatFaqHref({ format: 'PPR', isDynasty: true })).toBe(faq + '#dynasty')
    expect(leagueFormatFaqHref({ isDynasty: false })).toBe(faq + '#redraft')
    expect(leagueFormatFaqHref({ settings: [], format: 'PPR' })).toBe(faq)
  })
  it('uses Spanish copy and server-resolved links', () => {
    lang.language = 'es'
    render(<LeagueFormatFaqLink href={faq + '#dynasty'} />)
    expect(screen.getByRole('link', { name: 'Reglas del formato' }).getAttribute('href')).toBe(faq + '#dynasty')
  })
})
