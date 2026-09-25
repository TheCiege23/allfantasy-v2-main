'use client'

import '@/components/launch/af-launch.css'

import Link from 'next/link'
import type { FoundingOfferView } from '@/lib/monetization/foundingMember'
import { landingBannerCopy } from '@/components/launch/launchCopy'
import { LaunchCountdownView } from '@/components/launch/LaunchCountdown'
import { formatLaunchDay, type LaunchLang } from '@/components/launch/launchTime'
import { useLaunchClock } from '@/components/launch/useLaunchClock'

/*
 * The landing banner: "Everything's free until Oct 15" with the countdown and one CTA.
 *
 * Rendered by LandingV4 only while the server says the paywall has not started. It ALSO hides
 * itself when its own clock runs out, so a landing page left open across midnight Eastern on launch
 * day stops telling people everything is free the moment that stops being true.
 *
 * A client component because of that clock; every string still ships in the server HTML (the
 * static state renders the full banner, with the launch moment in place of the digits).
 */
export function LaunchBanner({
  startsAt,
  lang = 'en',
  signedIn,
  founding,
}: {
  startsAt: string
  lang?: LaunchLang
  signedIn: boolean
  founding: FoundingOfferView | null
}) {
  const clock = useLaunchClock(startsAt)
  if (clock.phase === 'ended') return null
  const copy = landingBannerCopy({ startsAt, lang, signedIn, founding })
  const day = formatLaunchDay(startsAt, lang)

  return (
    <section className="af-launch-banner" aria-labelledby="af-launch-banner-title" data-testid="launch-banner">
      <div className="af-launch-banner-copy">
        <span className="af-launch-kicker">
          <span className="af-launch-dot" aria-hidden="true" />
          {copy.kicker}
        </span>
        <h2 className="af-launch-banner-title" id="af-launch-banner-title">
          {copy.title}
        </h2>
        <p className="af-launch-banner-body">{copy.body}</p>
      </div>
      <div className="af-launch-banner-clock">
        <LaunchCountdownView
          clock={clock}
          startsAt={startsAt}
          lang={lang}
          size="lg"
          staticText={lang === 'es' ? `Los planes de pago empiezan el ${day}` : `Paid plans start ${day}`}
        />
      </div>
      <Link href={copy.cta.href} className="af-btn af-launch-cta" data-testid="launch-banner-cta">
        {copy.cta.label}
      </Link>
    </section>
  )
}

export default LaunchBanner
