/**
 * Dev-only preview of the two devy screens, built from `design-refs/devy-handoff/`.
 *
 * Both screens have three view states that replace the entire section stack, and the
 * real ones are driven by fetch status — so on a production surface a reviewer can only
 * ever see whichever state the data happens to be in. This mounts both screens against
 * the handoff's own placeholder set with a switcher for all three, which is what the
 * mock's own (QA-only) state pills existed to provide.
 *
 * ⚠ PRODUCTION-SAFE: 404s outside development, and nothing links to it. Same guard as
 * /dev/states-preview, /dev/d6-preview and /dev/passing-preview.
 */

import { notFound } from 'next/navigation'
import { DevyPreviewClient } from './DevyPreviewClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Devy screens preview',
  robots: { index: false, follow: false },
}

export default function DevyPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <DevyPreviewClient />
}
