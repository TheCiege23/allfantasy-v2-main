import { Suspense } from 'react'
import { ConnectLeaguesClient } from './ConnectLeaguesClient'
import './connect-leagues.css'

export const metadata = {
  title: 'Connect two leagues — AllFantasy',
}

/**
 * ⚠ A STATIC SEGMENT UNDER AN OPTIONAL CATCH-ALL, DELIBERATELY. `/core` is
 * served by `[[...screen]]`, and Next.js gives a static segment precedence over
 * it — so this renders instead of the shell rather than alongside it.
 *
 * That is the intent: pairing is a one-off task flow, like `/import`, not a
 * dockable screen. Adding it to the catch-all would mean editing a 2178-line
 * page and the shell's nav key union for a screen nobody returns to, in a
 * checkout several sessions are working in.
 *
 * ⚠ `useSearchParams` NEEDS A SUSPENSE BOUNDARY or the whole route opts out of
 * static rendering and the build warns.
 */
export default function ConnectLeaguesPage() {
  return (
    <Suspense fallback={null}>
      <ConnectLeaguesClient />
    </Suspense>
  )
}
