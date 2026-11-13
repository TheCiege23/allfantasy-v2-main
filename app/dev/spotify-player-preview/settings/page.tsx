/**
 * Dev-only: the REAL Connected Accounts settings section, rendered with fixture
 * profiles so the Spotify card can be checked for a tester and a non-tester without
 * a signed-in session or a database. Add `?spotify=not-available` to see the message
 * /api/auth/spotify sends a non-tester back with.
 *
 * ⚠ PRODUCTION-SAFE: 404s outside development, and nothing links to it.
 */
import { notFound } from 'next/navigation'
import { SettingsCardPreviewClient } from './SettingsCardPreviewClient'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Spotify settings preview', robots: { index: false } }

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <SettingsCardPreviewClient />
}
