/**
 * Decision OS — Phase 7.17 JS Embed Adapter: container validation.
 *
 * The partner's DOM container is not guaranteed by TypeScript at runtime —
 * a plain-JS caller can pass anything. `validateContainer` checks it is a
 * real `Element` and is not already owned by another AllFantasy widget
 * instance (double-mounting into the same container would silently clobber
 * one widget with another). Tracked via a module-private `WeakSet` so the
 * "already mounted" marker never becomes a DOM attribute or otherwise
 * observable/serializable state on the element itself.
 */

export interface ContainerValidationResult {
  valid: boolean
  errors: string[]
}

const MOUNTED_CONTAINERS = new WeakSet<Element>()

export function validateContainer(container: unknown): ContainerValidationResult {
  const errors: string[] = []

  if (container === null || container === undefined) {
    errors.push('container is required')
    return { valid: false, errors }
  }
  if (!(container instanceof Element)) {
    errors.push('container must be a DOM Element')
    return { valid: false, errors }
  }
  if (MOUNTED_CONTAINERS.has(container)) {
    errors.push('container already has an AllFantasy widget mounted — unmount it first')
  }

  return { valid: errors.length === 0, errors }
}

export function markContainerMounted(container: Element): void {
  MOUNTED_CONTAINERS.add(container)
}

export function markContainerUnmounted(container: Element): void {
  MOUNTED_CONTAINERS.delete(container)
}
