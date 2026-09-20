import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LeagueConceptIntroGate } from '@/components/league/LeagueConceptIntroGate'

describe('LeagueConceptIntroGate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('does not fetch or render when shouldPlayIntro is false', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ seen: false }),
    } as Response)

    render(
      <LeagueConceptIntroGate
        leagueId="league-1"
        shouldPlayIntro={false}
        leagueType="redraft"
        settings={{}}
      />,
    )

    expect(screen.queryByTestId('concept-intro-overlay')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  it('renders overlay when handoff is true and intro is unseen', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ seen: false }),
    } as Response)

    render(
      <LeagueConceptIntroGate
        leagueId="league-1"
        shouldPlayIntro={true}
        leagueType="redraft"
        settings={{}}
      />,
    )

    await screen.findByTestId('concept-intro-overlay')
    expect(fetchSpy).toHaveBeenCalledWith('/api/leagues/league-1/intro-status', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
  })

  it('marks intro seen when dismissed', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ seen: false }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      } as Response)

    render(
      <LeagueConceptIntroGate
        leagueId="league-1"
        shouldPlayIntro={true}
        leagueType="redraft"
        settings={{}}
      />,
    )

    const closeButton = await screen.findByTestId('concept-intro-close')
    fireEvent.click(closeButton)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/leagues/league-1/intro-seen', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    })
  })

  describe('sport intro tier', () => {
    function mockUnseen() {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ seen: false }),
      } as Response)
    }

    async function videoSrc(): Promise<string> {
      const video = await screen.findByTestId('concept-intro-video')
      return video.getAttribute('src') ?? ''
    }

    it('a generic format plays the sport-native intro', async () => {
      mockUnseen()
      render(
        <LeagueConceptIntroGate
          leagueId="league-1"
          shouldPlayIntro
          leagueType="redraft"
          sport="MLB"
          settings={{}}
        />,
      )
      expect(await videoSrc()).toBe('/media/league-intros/sports/Baseball.mp4')
      expect(screen.getByText(/Welcome to Baseball/)).toBeInTheDocument()
    })

    it('a themed concept keeps its own intro on the same sport', async () => {
      mockUnseen()
      render(
        <LeagueConceptIntroGate
          leagueId="league-2"
          shouldPlayIntro
          leagueType="zombie"
          sport="MLB"
          settings={{}}
        />,
      )
      const src = await videoSrc()
      expect(src).toBe('/league-type-zombie-intro.mp4')
      expect(src).not.toContain('/sports/')
    })

    it('a sport with no shipped clip falls through to the concept intro', async () => {
      mockUnseen()
      render(
        <LeagueConceptIntroGate
          leagueId="league-3"
          shouldPlayIntro
          leagueType="redraft"
          sport="NBA"
          settings={{}}
        />,
      )
      expect(await videoSrc()).toBe('/media/league-intros/redraft-league-intro.mp4')
    })

    it('omitting sport preserves the previous behaviour exactly', async () => {
      mockUnseen()
      render(
        <LeagueConceptIntroGate
          leagueId="league-4"
          shouldPlayIntro
          leagueType="redraft"
          settings={{}}
        />,
      )
      expect(await videoSrc()).toBe('/media/league-intros/redraft-league-intro.mp4')
    })

    it('a commissioner-set custom intro still outranks the sport clip', async () => {
      mockUnseen()
      render(
        <LeagueConceptIntroGate
          leagueId="league-5"
          shouldPlayIntro
          leagueType="dynasty"
          sport="NHL"
          settings={{ intro_video: { url: 'https://cdn.example.com/custom.mp4' } }}
        />,
      )
      expect(await videoSrc()).toBe('https://cdn.example.com/custom.mp4')
    })

    it('a stored poster applies without a stored video, as it did before the sport tier', async () => {
      mockUnseen()
      render(
        <LeagueConceptIntroGate
          leagueId="league-6"
          shouldPlayIntro
          leagueType="dynasty"
          sport="NHL"
          settings={{ intro_video: { posterUrl: 'https://cdn.example.com/custom.png' } }}
        />,
      )
      const video = await screen.findByTestId('concept-intro-video')
      expect(video.getAttribute('src')).toBe('/media/league-intros/sports/Hockey.mp4')
      expect(video.getAttribute('poster')).toBe('https://cdn.example.com/custom.png')
    })
  })
})
