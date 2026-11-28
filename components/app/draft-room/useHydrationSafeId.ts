'use client'

import { useEffect, useId, useState } from 'react'

/**
 * An element id for `aria-controls` / `htmlFor` pairs that cannot cause a hydration mismatch.
 * It is `undefined` on the first render, on the server and on the client alike, and becomes a
 * `useId()` value once the component has mounted.
 *
 * 🛑 WHY NOT PLAIN `useId()`: IN THIS APP IT DOES NOT ALWAYS MATCH THE SERVER (measured
 * 2026-11-28). React marks a child that sits at an array position as "forked" and folds that
 * position into every `useId()` below it. When the child is a client component whose JS chunk has
 * not loaded yet, it suspends, and React's replay resets the fiber's flags with a mask that drops
 * the forked flag (`resetWorkInProgress`, react-dom 19.3). The fork bits are lost, so every id
 * underneath differs from the server's. Both draft routes put the room at such a position:
 * /drafts/[draftId] renders `<Suspense/>` then `<DraftBoard/>`, and /e2e/draft-room-fixture
 * renders `<script/>` then the harness. Whether the chunk is ready depends on load timing, so it
 * failed on roughly 1 load in 3 or 4, as "attributes of the server rendered HTML didn't match"
 * on PlayerPanel's filter `id` / `aria-controls`.
 *
 * The id only has to match its partner on the client, and nothing reads it before mount, so
 * leaving it off the server HTML costs nothing.
 */
export function useHydrationSafeId(): string | undefined {
  const reactId = useId()
  const [id, setId] = useState<string | undefined>(undefined)
  useEffect(() => {
    setId(reactId)
  }, [reactId])
  return id
}
