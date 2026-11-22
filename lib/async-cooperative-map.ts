import { setImmediate } from 'node:timers/promises'

/** Keep large synchronous transforms from monopolizing a shared worker thread. */
export async function cooperativeMap<T, R>(
  items: readonly T[],
  transform: (item: T, index: number) => R,
): Promise<R[]> {
  const result: R[] = []
  let sliceStarted = performance.now()
  for (let index = 0; index < items.length; index++) {
    result.push(transform(items[index], index))
    if (index + 1 < items.length && ((index + 1) % 32 === 0 || performance.now() - sliceStarted >= 8)) {
      await setImmediate()
      sliceStarted = performance.now()
    }
  }
  return result
}
