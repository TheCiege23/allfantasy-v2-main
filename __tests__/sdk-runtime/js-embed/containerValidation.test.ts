import { afterEach, describe, expect, it } from 'vitest'
import {
  markContainerMounted,
  markContainerUnmounted,
  validateContainer,
} from '../../../sdk-runtime/js-embed/src/containerValidation'

const mounted: HTMLElement[] = []
function makeContainer(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
})

describe('validateContainer', () => {
  it('is valid for a real, unmounted Element', () => {
    const result = validateContainer(makeContainer())
    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('rejects null', () => {
    const result = validateContainer(null)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('required')
  })

  it('rejects undefined', () => {
    const result = validateContainer(undefined)
    expect(result.valid).toBe(false)
  })

  it('rejects a plain object masquerading as a container', () => {
    const result = validateContainer({ nodeType: 1 })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('DOM Element')
  })

  it('rejects a string', () => {
    const result = validateContainer('#my-div')
    expect(result.valid).toBe(false)
  })

  it('rejects a container already marked as mounted', () => {
    const el = makeContainer()
    markContainerMounted(el)
    const result = validateContainer(el)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('already has an AllFantasy widget mounted')
  })

  it('accepts a container again after it is marked unmounted', () => {
    const el = makeContainer()
    markContainerMounted(el)
    markContainerUnmounted(el)
    const result = validateContainer(el)
    expect(result.valid).toBe(true)
  })

  it('tracks mounted state independently per container instance', () => {
    const a = makeContainer()
    const b = makeContainer()
    markContainerMounted(a)
    expect(validateContainer(a).valid).toBe(false)
    expect(validateContainer(b).valid).toBe(true)
  })
})
