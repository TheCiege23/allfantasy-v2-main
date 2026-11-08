'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { track } from '@/lib/analytics/dataLayer'

type Cta = 'import' | 'pricing'
type Placement = 'nav' | 'mobile_nav' | 'hero' | 'how_it_works' | 'bottom'

/**
 * A plain <Link> that also pushes `commissioner_page_cta` to the dataLayer.
 *
 * The only client code on /commissioners: everything else is server-rendered, so the page's copy
 * ships in the HTML for crawlers and link previews. Tracking fires on click and never blocks or
 * delays navigation — `track` is a synchronous dataLayer push and no-ops without a window.
 */
export function CommissionersCtaLink({
  href,
  cta,
  placement,
  className,
  children,
  testId,
}: {
  href: string
  cta: Cta
  placement: Placement
  className?: string
  children: ReactNode
  testId?: string
}) {
  return (
    <Link
      href={href}
      className={className}
      data-testid={testId}
      // Pricing links stay out of the iOS app, the same rule `/` applies to its pricing links.
      data-hide-in-ios-app={cta === 'pricing' ? '' : undefined}
      onClick={() => {
        track({ event: 'commissioner_page_cta', cta, placement })
      }}
    >
      {children}
    </Link>
  )
}
