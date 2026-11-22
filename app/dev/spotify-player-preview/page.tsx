/**
 * Dev-only preview of the Spotify mini player's playlist picker, in every state.
 *
 * Renders the REAL SpotifyPlayerBar and SpotifyPlaylistPicker with fixture data, because
 * the live player needs a signed-in Spotify Premium account and the Web Playback SDK.
 *
 * ⚠ PRODUCTION-SAFE: 404s outside development, and nothing links to it. Same guard as
 * /dev/handoff-preview.
 */
import { notFound } from 'next/navigation'
import { SpotifyPlayerPreviewClient } from './SpotifyPlayerPreviewClient'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Spotify player preview', robots: { index: false } }

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <SpotifyPlayerPreviewClient />
}
