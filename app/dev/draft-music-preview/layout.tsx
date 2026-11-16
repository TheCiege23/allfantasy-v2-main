/**
 * Dev-only preview of app-wide music. Three fake screens (draft, lineup,
 * trades) share THIS layout, the same way every real screen shares the root
 * layout — so moving between them with the links proves the music keeps
 * playing across navigation.
 *
 * ⚠ PRODUCTION-SAFE: 404s outside development, and nothing links to it.
 * `?mode=light|dark` picks the theme.
 */

import { Suspense, type ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { MusicPreviewShell } from './MusicPreviewShell'

export const metadata = {
  title: 'Music preview',
  robots: { index: false, follow: false },
}

export default function MusicPreviewLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()
  // useSearchParams() in the shell needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <MusicPreviewShell>{children}</MusicPreviewShell>
    </Suspense>
  )
}
