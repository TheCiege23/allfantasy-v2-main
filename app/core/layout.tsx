import type { ReactNode } from 'react'

import { CommsDockHost } from '@/components/core-app/comms/CommsDockHost'

/**
 * The one piece of /core that must outlive a screen change: the chat bubble.
 *
 * `app/core/[[...screen]]/loading.tsx` replaces the whole shell on every screen change, so a dock
 * rendered by the shell vanished while each screen loaded and lost anything held in its state. A
 * layout is kept mounted across every navigation beneath it, so the dock lives here and the shell
 * only tells it what to show. See `components/core-app/comms/CommsDockHost.tsx`.
 *
 * Deliberately nothing else: no data reads (the page still owns every read, so this adds no
 * request to any navigation) and no markup of its own around `children`.
 */
export default function CoreLayout({ children }: { children: ReactNode }) {
  return <CommsDockHost>{children}</CommsDockHost>
}
