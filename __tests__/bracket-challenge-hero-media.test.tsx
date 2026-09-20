import React from 'react'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  bracketChallengeHeroSports,
  resolveBracketChallengeHero,
} from '@/lib/brackets/bracketChallengeMedia'
import { BracketChallengeHeroMedia } from '@/components/brackets/BracketChallengeHeroMedia'

const PUBLIC_DIR = path.join(process.cwd(), 'public')

function shipped(url: string): boolean {
  if (!url.startsWith('/')) return false
  return existsSync(path.join(PUBLIC_DIR, decodeURIComponent(url.split(/[?#]/)[0] ?? url)))
}

describe('bracket challenge hero media', () => {
  it('control — the existence helper reports a missing file as missing', () => {
    expect(shipped('/videos/brackets/nba-playoffs/not-real.mp4')).toBe(false)
    expect(shipped(resolveBracketChallengeHero('NBA')!.video)).toBe(true)
  })

  it('every registered hero clip and poster ships', () => {
    const missing: string[] = []
    for (const sport of bracketChallengeHeroSports()) {
      const hero = resolveBracketChallengeHero(sport)!
      if (!shipped(hero.video)) missing.push(`${sport} video: ${hero.video}`)
      if (!shipped(hero.poster)) missing.push(`${sport} poster: ${hero.poster}`)
    }
    expect(missing).toEqual([])
  })

  it('resolves NBA and NHL, and nothing else', () => {
    expect(resolveBracketChallengeHero('NBA')?.video).toContain('nba-playoffs')
    expect(resolveBracketChallengeHero('NHL')?.video).toContain('nhl-playoffs')
    expect(resolveBracketChallengeHero('nba')?.video).toContain('nba-playoffs') // case-insensitive
    expect(resolveBracketChallengeHero(' nhl ')?.video).toContain('nhl-playoffs')
  })

  it('fails closed for a live sport with no art, rather than guessing a path', () => {
    // MLB is a LIVE playoff sport. Until its artwork ships this must stay null — a guessed
    // path would put a broken <video> on a working create flow.
    expect(resolveBracketChallengeHero('MLB')).toBeNull()
    expect(resolveBracketChallengeHero('NFL')).toBeNull()
    expect(resolveBracketChallengeHero('NCAAB')).toBeNull()
    expect(resolveBracketChallengeHero('SOCCER')).toBeNull()
    expect(resolveBracketChallengeHero(null)).toBeNull()
    expect(resolveBracketChallengeHero('')).toBeNull()
    expect(resolveBracketChallengeHero('QUIDDITCH')).toBeNull()
  })

  it('renders a hero for NBA', () => {
    render(<BracketChallengeHeroMedia sport="NBA" />)
    const video = screen.getByTestId('bracket-challenge-hero-video')
    expect(video.getAttribute('src')).toBe(
      '/videos/brackets/nba-playoffs/af-nba-playoffs-hero.mp4',
    )
    expect(video.getAttribute('poster')).toBe(
      '/images/brackets/nba-playoffs/af-nba-playoffs-hero-poster.png',
    )
  })

  it('renders NOTHING for a sport with no art, so the page is unchanged', () => {
    const { container } = render(<BracketChallengeHeroMedia sport="MLB" />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('bracket-challenge-hero')).not.toBeInTheDocument()
  })

  it('renders nothing when sport is absent', () => {
    const { container } = render(<BracketChallengeHeroMedia sport={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
