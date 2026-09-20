'use client'

import { useEffect, useState } from 'react'
import { resolveBracketChallengeHero } from '@/lib/brackets/bracketChallengeMedia'

/**
 * Sport hero for the bracket-challenge create flow.
 *
 * Renders nothing at all when the sport has no shipped clip, which is the common case — only
 * NBA and NHL have artwork today. That keeps the create page byte-identical for every other
 * sport rather than leaving a placeholder box.
 *
 * Also renders nothing if the clip fails to load, so a missing or corrupt asset degrades to the
 * page as it was instead of a broken player.
 */
export function BracketChallengeHeroMedia({ sport }: { sport: string | null | undefined }) {
  const hero = resolveBracketChallengeHero(sport)
  const [failed, setFailed] = useState(false)

  // A new sport gets a fresh chance to load; otherwise one failure would hide every later hero.
  useEffect(() => {
    setFailed(false)
  }, [hero?.video])

  if (!hero || failed) return null

  return (
    <div
      className="mb-6 overflow-hidden rounded-xl border"
      style={{ borderColor: 'var(--border)' }}
      data-testid="bracket-challenge-hero"
      data-hero-sport={String(sport ?? '').toUpperCase()}
    >
      <video
        key={hero.video}
        src={hero.video}
        poster={hero.poster}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={hero.label}
        onError={() => setFailed(true)}
        className="aspect-video w-full bg-black object-cover"
        data-testid="bracket-challenge-hero-video"
      />
    </div>
  )
}
