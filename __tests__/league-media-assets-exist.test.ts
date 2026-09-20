import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DRAFT_SELECTION_VIDEO_BY_STEM,
  resolveDraftIntroPosterUrl,
  resolveDraftIntroVideoUrl,
} from '@/lib/draft/draft-intro-video'
import { resolveSportLeagueIntro } from '@/lib/league-media/sportLeagueIntros'
import { getLeagueTypeMedia } from '@/lib/league-media/leagueTypeMedia'
import { LEAGUE_TYPE_MEDIA, SPORT_MEDIA } from '@/lib/create-league-v2/theme'
import type { SupportedSport } from '@/lib/create-league-v2/state'

const PUBLIC_DIR = path.join(process.cwd(), 'public')

/** `/media/create-league/concept/videos/Salary%20Cap.mp4` -> the real file on disk. */
function publicPathFor(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? url
  return path.join(PUBLIC_DIR, decodeURIComponent(withoutQuery))
}

function shipped(url: string | null | undefined): boolean {
  if (!url || !url.startsWith('/')) return false
  return existsSync(publicPathFor(url))
}

const ALL_SPORTS: SupportedSport[] = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER']

describe('media registries point at files that actually ship', () => {
  // Positive control: the helper must report a file that is genuinely absent as absent,
  // or every assertion below is a check that cannot fail.
  it('control — the existence helper reports a missing file as missing', () => {
    expect(shipped('/media/create-league/drafts/videos/Does Not Exist.mp4')).toBe(false)
    expect(shipped('/media/create-league/drafts/videos/Snake Draft.mp4')).toBe(true)
    // URL-encoded names must resolve too; this one only exists as "Salary Cap.mp4".
    expect(shipped('/media/create-league/concept/videos/Salary%20Cap.mp4')).toBe(true)
  })

  it('every draft selection clip exists', () => {
    const missing: string[] = []
    for (const [stem, urls] of Object.entries(DRAFT_SELECTION_VIDEO_BY_STEM)) {
      for (const url of urls) {
        if (!shipped(url)) missing.push(`${stem}: ${url}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every draft-start intro and poster exists', () => {
    const missing: string[] = []
    for (const stem of Object.keys(DRAFT_SELECTION_VIDEO_BY_STEM)) {
      const video = resolveDraftIntroVideoUrl(stem)
      if (video && !shipped(video)) missing.push(`intro ${stem}: ${video}`)
      const poster = resolveDraftIntroPosterUrl(stem)
      if (poster && !shipped(poster)) missing.push(`poster ${stem}: ${poster}`)
    }
    expect(missing).toEqual([])
  })

  it('every sport league intro and its poster exists', () => {
    const missing: string[] = []
    for (const sport of ALL_SPORTS) {
      const intro = resolveSportLeagueIntro({ sport, conceptKey: 'redraft' })
      if (!intro) continue
      if (!shipped(intro.video)) missing.push(`${sport} video: ${intro.video}`)
      if (!shipped(intro.poster)) missing.push(`${sport} poster: ${intro.poster}`)
    }
    expect(missing).toEqual([])
  })

  it('every concept intro, selection clip and thumbnail exists', () => {
    const missing: string[] = []
    for (const key of Object.keys(LEAGUE_TYPE_MEDIA)) {
      const bundle = getLeagueTypeMedia(key)
      for (const [label, url] of [
        ['introVideo', bundle.introVideo],
        ['selectionVideo', bundle.selectionVideo],
        ['thumbnail', bundle.thumbnail],
      ] as const) {
        if (url && !shipped(url)) missing.push(`${key} ${label}: ${url}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every create-league sport clip and poster exists', () => {
    const missing: string[] = []
    for (const [sport, asset] of Object.entries(SPORT_MEDIA)) {
      if (!shipped(asset.video)) missing.push(`${sport} video: ${asset.video}`)
      if (asset.poster && !shipped(asset.poster)) missing.push(`${sport} poster: ${asset.poster}`)
      if (asset.fallback && !shipped(asset.fallback)) {
        missing.push(`${sport} fallback: ${asset.fallback}`)
      }
    }
    expect(missing).toEqual([])
  })
})
