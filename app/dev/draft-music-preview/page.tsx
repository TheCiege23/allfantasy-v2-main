/**
 * Dev-only preview of the draft room music panel (YouTube + Apple Music).
 *
 * The real surface is the draft board inside Draft HQ, which needs a league and
 * a database. This renders the same component with no data at all.
 *
 * ⚠ PRODUCTION-SAFE: 404s outside development, and nothing links to it.
 * `?mode=light|dark|af` picks the theme.
 */

import { notFound } from 'next/navigation'
import { DraftMusicPreviewClient } from './DraftMusicPreviewClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Draft music preview',
  robots: { index: false, follow: false },
}

export default function DraftMusicPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <DraftMusicPreviewClient />
}
