'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConceptIntroVideoOverlay } from '@/components/league/ConceptIntroVideoOverlay'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import { getConceptIntroVideoUrl } from '@/lib/league-creation/concept-intro-videos'
import { getLeagueTypeMedia, resolveLeagueConceptIntroKey } from '@/lib/league-media/leagueTypeMedia'

type LeagueConceptIntroGateProps = {
  leagueId: string
  shouldPlayIntro: boolean
  blockedByModal?: boolean
  leagueType?: string | null
  /** Modifier ids should not override a true redraft intro. */
  leagueVariant?: string | null
  isDynasty?: boolean | null
  guillotineMode?: boolean | null
  bestBallMode?: boolean | null
  settings?: unknown
}

const REDRAFT_INTRO_VIDEO_URL = '/media/league-intros/redraft-league-intro.mp4'

const CONCEPT_SEED = new Map(
  LEAGUE_CREATE_OPTIONS_CATALOG_V1.concepts.map((concept) => [
    concept.id,
    {
      title: concept.title,
      introVideoUrl: concept.introVideoUrl,
      introPosterUrl: concept.introPosterUrl,
    },
  ]),
)

function readIntroSettingEnabled(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return true
  const root = settings as Record<string, unknown>

  const intro = root.intro_video ?? root.introVideo
  if (intro && typeof intro === 'object' && !Array.isArray(intro)) {
    const introObj = intro as Record<string, unknown>
    if (typeof introObj.enabled === 'boolean') return introObj.enabled
    if (typeof introObj.isEnabled === 'boolean') return introObj.isEnabled
    if (typeof introObj.disabled === 'boolean') return !introObj.disabled
  }

  if (typeof root.introVideoEnabled === 'boolean') return root.introVideoEnabled
  if (typeof root.disableIntroVideo === 'boolean') return !root.disableIntroVideo
  return true
}

function readStoredIntro(settings: unknown): { videoUrl: string | null; posterUrl: string | null } {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { videoUrl: null, posterUrl: null }
  }

  const root = settings as Record<string, unknown>
  const intro = root.intro_video ?? root.introVideo
  if (!intro || typeof intro !== 'object' || Array.isArray(intro)) {
    return { videoUrl: null, posterUrl: null }
  }

  const introObj = intro as Record<string, unknown>
  const url = typeof introObj.url === 'string' && introObj.url.trim().length > 0 ? introObj.url.trim() : null
  const poster =
    typeof introObj.posterUrl === 'string' && introObj.posterUrl.trim().length > 0
      ? introObj.posterUrl.trim()
      : null

  return { videoUrl: url, posterUrl: poster }
}

function isRedraftLeagueType(leagueType?: string | null, settings?: unknown): boolean {
  const raw = String(leagueType ?? '').trim().toLowerCase()
  if (raw === 'redraft') return true

  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
  const root = settings as Record<string, unknown>
  const settingsLeagueType = String(root.league_type ?? root.leagueType ?? '').trim().toLowerCase()
  return settingsLeagueType === 'redraft'
}

export function LeagueConceptIntroGate({
  leagueId,
  shouldPlayIntro,
  blockedByModal = false,
  leagueType,
  leagueVariant,
  isDynasty,
  guillotineMode,
  bestBallMode,
  settings,
}: LeagueConceptIntroGateProps) {
  const forceRedraftIntro = useMemo(
    () => isRedraftLeagueType(leagueType, settings) && !guillotineMode && !bestBallMode && !isDynasty,
    [leagueType, settings, guillotineMode, bestBallMode, isDynasty],
  )

  const conceptKey = useMemo(() => {
    if (forceRedraftIntro) return 'redraft'

    return resolveLeagueConceptIntroKey({
      leagueType,
      leagueVariant,
      settings,
      isDynasty,
      guillotineMode,
      bestBallMode,
    })
  }, [forceRedraftIntro, leagueType, leagueVariant, settings, isDynasty, guillotineMode, bestBallMode])

  const seed = useMemo(() => CONCEPT_SEED.get(conceptKey) ?? null, [conceptKey])
  const mediaBundle = useMemo(() => getLeagueTypeMedia(conceptKey), [conceptKey])
  const storedIntro = useMemo(() => readStoredIntro(settings), [settings])
  const introEnabled = useMemo(() => readIntroSettingEnabled(settings), [settings])

  const videoSrc = useMemo(() => {
    if (forceRedraftIntro || conceptKey === 'redraft') {
      return mediaBundle.introVideo || getConceptIntroVideoUrl('redraft') || REDRAFT_INTRO_VIDEO_URL
    }

    if (storedIntro.videoUrl) return storedIntro.videoUrl
    if (seed?.introVideoUrl) return seed.introVideoUrl
    return mediaBundle.introVideo || getConceptIntroVideoUrl(conceptKey) || null
  }, [conceptKey, forceRedraftIntro, mediaBundle.introVideo, seed, storedIntro.videoUrl])

  const posterSrc = useMemo(() => {
    if (forceRedraftIntro || conceptKey === 'redraft') {
      return mediaBundle.thumbnail
    }

    if (storedIntro.posterUrl) return storedIntro.posterUrl
    if (seed?.introPosterUrl) return seed.introPosterUrl
    return mediaBundle.thumbnail
  }, [conceptKey, forceRedraftIntro, mediaBundle.thumbnail, seed, storedIntro.posterUrl])

  const conceptLabel = forceRedraftIntro ? 'Redraft' : seed?.title ?? mediaBundle.label

  const [open, setOpen] = useState(false)
  const seenMarkedRef = useRef(false)

  const shouldCheck = shouldPlayIntro && !blockedByModal && introEnabled && Boolean(videoSrc)

  useEffect(() => {
    seenMarkedRef.current = false
  }, [leagueId])

  useEffect(() => {
    const onReplay = (event: Event) => {
      if (!introEnabled || !videoSrc) return
      const detail = (event as CustomEvent<{ leagueId?: string }>).detail
      if (detail?.leagueId && detail.leagueId !== leagueId) return
      setOpen(true)
    }

    window.addEventListener('af:replay-league-intro', onReplay)
    return () => {
      window.removeEventListener('af:replay-league-intro', onReplay)
    }
  }, [introEnabled, leagueId, videoSrc])

  useEffect(() => {
    if (!shouldCheck) {
      setOpen(false)
      return
    }

    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/intro-status`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
      .then((response) => {
        if (!response.ok) return null
        return response.json().catch(() => null)
      })
      .then((payload: { seen?: boolean } | null) => {
        if (cancelled) return
        if (payload?.seen === false) setOpen(true)
      })
      .catch(() => {
        // Fail closed: if status call fails, do not block the dashboard.
      })

    return () => {
      cancelled = true
    }
  }, [leagueId, shouldCheck])

  const markSeen = useCallback(() => {
    if (seenMarkedRef.current) return
    seenMarkedRef.current = true

    void fetch(`/api/leagues/${encodeURIComponent(leagueId)}/intro-seen`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    }).catch(() => {
      // Best-effort write; UI dismiss remains immediate.
    })
  }, [leagueId])

  const dismiss = useCallback(() => {
    setOpen(false)
    markSeen()
  }, [markSeen])

  if (!videoSrc) return null

  return (
    <ConceptIntroVideoOverlay
      open={open}
      conceptLabel={conceptLabel}
      videoSrc={videoSrc}
      posterSrc={posterSrc}
      onDismiss={dismiss}
    />
  )
}
