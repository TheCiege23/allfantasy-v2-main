import type { Metadata } from 'next'
import { LandingRoute, buildLandingMetadata } from '@/components/landing/landing-route'

/**
 * `/es` — the Spanish landing page.
 *
 * The page itself lives in components/landing/landing-route.tsx, shared with
 * `/`. Read the header comment there: it explains why Spanish is a route rather
 * than `/?lang=es`, which is the address this replaced.
 *
 * ⚠ THIS ROUTE IGNORES `?lang=` ENTIRELY, ON PURPOSE. The path states the
 * language, and honouring a parameter that contradicted it (`/es?lang=en`) would
 * recreate the exact defect this route exists to fix: a document whose content
 * and whose declared canonical disagree about what language it is. Legacy
 * `?lang=` links are consolidated by the 308 in app/page.tsx.
 */

export const metadata: Metadata = buildLandingMetadata('es')

export default async function SpanishHomePage() {
  return <LandingRoute lang="es" />
}
