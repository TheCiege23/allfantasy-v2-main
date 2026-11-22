/**
 * The rulebook (Rules page, first-visit intro, pinned FAQ) is built from the league's settings, the
 * same source as Chimmy's answers, so changing a setting changes what every surface says.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildSurvivorRulebook } from '@/lib/survivor/survivorRulesAnswers'
import { SURVIVOR_DEFAULT_FOUNDATION_SETTINGS } from '@/lib/survivor/survivorSettings'
import { buildMainIslandFaq } from '@/lib/survivor/faqGenerator'
import { SurvivorFirstEntryModal } from '@/components/survivor/SurvivorFirstEntryModal'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const ctx = { sport: 'NHL', settings: { ...SURVIVOR_DEFAULT_FOUNDATION_SETTINGS, idolCount: 4, tieRule: 'rocks_immediately' as const }, plan: null }

describe('buildSurvivorRulebook', () => {
  it('lists every section in order, as plain lines, from the settings', () => {
    const book = buildSurvivorRulebook(ctx)
    expect(book.map(s => s.topic)).toEqual(['overview', 'immunity', 'voting', 'ties', 'idols', 'challenges', 'merge', 'exile', 'jury', 'schedule'])
    expect(book.find(s => s.topic === 'idols')!.lines[0]).toContain('4 idols')
    expect(book.find(s => s.topic === 'ties')!.lines).toEqual(['A tie goes straight to rocks: a random draw among the tied managers decides who goes home.'])
    expect(book.every(s => s.title && !s.title.includes('**') && s.lines.every(l => !l.startsWith('•')))).toBe(true)
  })

  it('the pinned FAQ uses the same rulebook, the real vote command, and links the live rules page', () => {
    const faq = buildMainIslandFaq('L1', ctx)
    expect(faq).toContain('/survivor/L1/rules')
    expect(faq).toContain('4 idols')
    expect(faq).toContain('@Chimmy vote @manager')
    expect(faq).not.toContain('I vote for [')
  })
})

describe('SurvivorFirstEntryModal', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sections: buildSurvivorRulebook(ctx) }) })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('walks tribe, council, idols and Exile with this league’s rules, then points at Rules and Chimmy', async () => {
    const onClose = vi.fn()
    render(<SurvivorFirstEntryModal leagueId="L9" userId="u1" enabled onClose={onClose} />)
    expect(screen.getByText('Your tribe')).toBeTruthy()
    fireEvent.click(screen.getByTestId('survivor-intro-next'))
    expect(screen.getByText('Tribal Council')).toBeTruthy()
    fireEvent.click(screen.getByTestId('survivor-intro-next'))
    await waitFor(() => expect(screen.getByTestId('survivor-intro-step').textContent).toContain('4 idols'))
    fireEvent.click(screen.getByTestId('survivor-intro-next'))
    fireEvent.click(screen.getByTestId('survivor-intro-next'))
    expect(screen.getByText('Rules page').getAttribute('href')).toBe('/survivor/L9/rules')
    fireEvent.click(screen.getByTestId('survivor-intro-continue'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem('survivor_intro_seen_L9_u1')).toBe('1')
  })

  it('still teaches the basics when the rules cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    render(<SurvivorFirstEntryModal leagueId="L8" userId="u1" enabled onClose={vi.fn()} />)
    expect(screen.getByTestId('survivor-intro-step').textContent).toContain('lowest-scoring tribe goes to Tribal Council')
  })
})
