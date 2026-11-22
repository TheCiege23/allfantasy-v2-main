/**
 * `fn` over `items`, at most `limit` running at once, starting the next item as soon as any running
 * one settles. Results come back in input order. A rejection rejects the whole run, as
 * `Promise.all` over batches did.
 *
 * ⚠ A POOL, NOT LOCKSTEP BATCHES. `for (i += n) await Promise.all(slice)` waits for the SLOWEST item
 * of every batch before starting the next one, so a run costs the sum of each batch's worst case.
 * Measured on /core (2026-11-22): the home summary's live Sleeper check went 6.6s → 2.6s on this
 * change alone, at the same bound. First written in lib/core-app/dash34.ts; moved here when the rail's
 * projection boards needed it too.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker))
  return results
}
