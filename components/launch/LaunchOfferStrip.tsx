'use client'

import '@/components/launch/af-launch.css'

import Link from 'next/link'
import type { LaunchOfferView } from '@/lib/monetization/foundingMember'
import { offerStripCopy, type OfferStripSurface } from '@/components/launch/launchCopy'
import { LaunchCountdownView } from '@/components/launch/LaunchCountdown'
import { useLaunchClock } from '@/components/launch/useLaunchClock'

/*
 * The launch strip that sits beside the plans on /pricing and /upgrade, across the top of /signup,
 * and on the /core home for viewers without a plan.
 *
 * Two independent halves:
 *   - the countdown + "Everything's free until Oct 15" — only BEFORE launch, and it disappears on
 *     its own when the clock runs out;
 *   - the founding-member line — whenever the offer applies to this viewer, including after launch
 *     for a founding member (their discount does not expire with the countdown).
 * With neither, it renders nothing.
 */
export function LaunchOfferStrip({
  offer,
  surface,
  className,
}: {
  offer: LaunchOfferView | null
  surface: OfferStripSurface
  className?: string
}) {
  const clock = useLaunchClock(offer?.startsAt ?? '')
  if (!offer) return null

  // `prelaunch` is the server's reading; the clock is the browser's. Either one saying "over" ends it.
  const counting = offer.prelaunch && clock.phase !== 'ended'
  const copy = offerStripCopy({ startsAt: offer.startsAt, surface, founding: offer.founding })
  if (!counting && !copy.founding) return null

  const cls = ['af-launch-strip', className].filter(Boolean).join(' ')
  return (
    <section
      className={cls}
      data-surface={surface}
      data-counting={counting ? 'true' : 'false'}
      aria-label={counting ? copy.title : 'Founding-member pricing'}
      data-testid={`launch-strip-${surface}`}
    >
      {counting ? (
        <div className="af-launch-strip-main">
          <div className="af-launch-strip-copy">
            <p className="af-launch-strip-title">{copy.title}</p>
            {copy.body ? <p className="af-launch-strip-body">{copy.body}</p> : null}
          </div>
          {/* Inline on /signup and the /core home, where the strip must not push the page down. */}
          <LaunchCountdownView
            clock={clock}
            startsAt={offer.startsAt}
            size={surface === 'signup' || surface === 'core' ? 'sm' : 'md'}
          />
        </div>
      ) : null}
      {copy.founding ? (
        <p className="af-launch-strip-founding" data-testid={`launch-founding-${offer.founding?.audience ?? 'none'}`}>
          <svg className="af-launch-star" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M8 1.5l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.2 4 13.5l1-4.4-3.4-3 4.5-.5L8 1.5Z"
              fill="currentColor"
            />
          </svg>
          <span>
            {copy.founding}
            {copy.foundingLink ? (
              <>
                {' '}
                <Link href={copy.foundingLink.href} className="af-launch-link">
                  {copy.foundingLink.label}
                </Link>
              </>
            ) : null}
          </span>
        </p>
      ) : null}
      {counting && copy.cta ? (
        <Link href={copy.cta.href} className="af-btn af-launch-strip-cta">
          {copy.cta.label}
        </Link>
      ) : null}
    </section>
  )
}

export default LaunchOfferStrip
