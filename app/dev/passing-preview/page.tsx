/**
 * Dev-only preview of the CFBD passing profile card.
 *
 * The component otherwise only renders inside an authenticated devy surface against a
 * database whose college coverage is partial and rotating, so the states that matter —
 * thin coverage, attempts with no location tagged, a school not yet swept — are hard to
 * see side by side and nearly impossible to produce on demand. This mounts all four with
 * synthetic data, one of them the real measured Gunner Stockton row.
 *
 * ⚠ PRODUCTION-SAFE: 404s outside development, and nothing links to it. Same guard and
 * same purpose as /dev/states-preview and /dev/d6-preview.
 */

import { notFound } from 'next/navigation'
import { PassingPreviewClient } from './PassingPreviewClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'CFBD passing profile preview',
  robots: { index: false, follow: false },
}

export default function PassingPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <PassingPreviewClient />
}
