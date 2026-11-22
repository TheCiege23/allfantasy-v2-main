/**
 * News player links open the player's page (2026-11-12). They opened /af-rankings?q= — a rankings
 * list filtered by text. A name the feed attached opens /player/<name>?sport=; a name only guessed
 * from the headline opens the Player Finder search, never a profile of nobody.
 */
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  getPlayerPageHref,
  isFeedNamedPlayer,
  newsPlayerHref,
} from '@/lib/fantasy-news-aggregator/playerLinkResolver'
import { PlayerNewsPanel } from '@/components/fantasy-news/PlayerNewsPanel'
import type { EnrichedNewsItem } from '@/lib/fantasy-news-aggregator/types'

const item = (over: Partial<EnrichedNewsItem> = {}): EnrichedNewsItem => ({
  id: 'n1',
  title: 'Josh Allen limited; New England Patriots rest starters',
  description: null,
  source: 'Wire',
  sourceUrl: null,
  author: null,
  imageUrl: null,
  team: 'BUF',
  teams: ['BUF'],
  playerName: 'Josh Allen',
  playerNames: [],
  category: null,
  sentiment: null,
  publishedAt: null,
  headline: 'Josh Allen limited',
  summary: null,
  fantasyImpact: null,
  confidenceLevel: 'medium',
  importanceScore: 50,
  newsType: null,
  playersMentioned: ['Josh Allen', 'New England Patriots'],
  ...over,
})

describe('news player links', () => {
  it('a feed-named player opens their page, in the item’s sport, else the feed’s', () => {
    expect(newsPlayerHref(item(), 'Josh Allen', 'NFL')).toBe('/player/josh-allen?sport=NFL')
    expect(newsPlayerHref(item({ sport: 'NBA', playerName: 'Jalen Williams' }), 'Jalen Williams', 'NFL')).toBe(
      '/player/jalen-williams?sport=NBA',
    )
  })

  it('a name only guessed from the headline opens the Player Finder search', () => {
    expect(isFeedNamedPlayer(item(), 'New England Patriots')).toBe(false)
    expect(newsPlayerHref(item(), 'New England Patriots', 'NFL')).toBe('/core/players?q=New%20England%20Patriots')
  })

  it('playerNames count as feed-named, case-insensitively', () => {
    expect(isFeedNamedPlayer(item({ playerName: null, playerNames: ['Amon-Ra St. Brown'] }), 'amon-ra st. brown')).toBe(true)
    expect(getPlayerPageHref('Amon-Ra St. Brown', { sport: 'nfl' })).toBe('/player/amon-ra-st-brown?sport=NFL')
  })

  it('the panel renders those links, never the old rankings search', () => {
    render(<PlayerNewsPanel items={[item()]} sport="NFL" />)
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toContain('/player/josh-allen?sport=NFL')
    expect(links).toContain('/core/players?q=New%20England%20Patriots')
    expect(links.some((h) => h?.startsWith('/af-rankings'))).toBe(false)
  })
})
