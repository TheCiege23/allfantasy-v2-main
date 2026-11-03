'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { SurvivorEmblem } from '@/components/core-app/survivor/SurvivorIslandBanner'
import { sportBall, type IslandScene } from '@/lib/core-app/survivorIsland'

/**
 * The island scene banner at the top of the standalone Survivor hub: the same scene art, gradient
 * and crest as the /core Survivor banner (components/core-app/survivor/SurvivorIslandBanner.tsx),
 * fed from the hub's own season data so it adds no request. Styles: app/survivor/survivor-island.css.
 */
export function SurvivorHubBanner({
  scene,
  leagueName,
  sport,
  week,
  phase,
  headline,
  description,
  primaryAction,
  secondaryAction,
}: {
  scene: IslandScene
  leagueName: string
  sport?: string | null
  week?: number | null
  phase: string
  headline: string
  description: string
  primaryAction: { href: string; label: string }
  secondaryAction: { href: string; label: string }
}) {
  return (
    <section
      className="sv-banner"
      data-scene={scene}
      data-testid="survivor-hub-banner"
      style={{ backgroundImage: `url('/survivor/scenes/${scene}.svg')` }}
    >
      <div className="sv-banner-in">
        <SurvivorEmblem ball={sportBall(sport)} />
        <div className="min-w-0">
          <div className="sv-chips">
            <span>{sport ?? 'Fantasy'} island</span>
            <span>{phase.replace(/_/g, ' ')}</span>
            {week && week > 0 ? <span>Week {week}</span> : null}
          </div>
          <h1 className="sv-banner-league">{leagueName}</h1>
          <p className="sv-banner-headline">{headline}</p>
          <p className="sv-banner-desc">{description}</p>
          <div className="sv-banner-actions">
            <Link href={primaryAction.href} className="sv-btn sv-btn-primary">
              {primaryAction.label}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href={secondaryAction.href} className="sv-btn">
              {secondaryAction.label}
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
