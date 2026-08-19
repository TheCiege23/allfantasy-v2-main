import { describe, expect, it, afterEach } from 'vitest'
import {
  attachShadowMountRoot,
  mountShadowContainer,
  unmountShadowContainer,
} from '../../../sdk-runtime/web-component/src/shadowMount'

const mounted: HTMLElement[] = []

function makeHost(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  mounted.push(host)
  return host
}

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
})

describe('attachShadowMountRoot', () => {
  it('attaches an open shadow root visible via host.shadowRoot', () => {
    const host = makeHost()
    const shadowRoot = attachShadowMountRoot(host, 'open')
    expect(host.shadowRoot).toBe(shadowRoot)
  })

  it('attaches a closed shadow root NOT visible via host.shadowRoot', () => {
    const host = makeHost()
    const shadowRoot = attachShadowMountRoot(host, 'closed')
    expect(host.shadowRoot).toBeNull()
    expect(shadowRoot).not.toBeNull()
  })

  it('calling it twice on the same host throws (documents why the caller must attach at most once)', () => {
    const host = makeHost()
    attachShadowMountRoot(host, 'open')
    expect(() => attachShadowMountRoot(host, 'open')).toThrow()
  })
})

describe('mountShadowContainer / unmountShadowContainer', () => {
  it('creates a container element inside the shadow root, marked for identification', () => {
    const host = makeHost()
    const shadowRoot = attachShadowMountRoot(host, 'open')
    const container = mountShadowContainer(shadowRoot)
    expect(shadowRoot.contains(container)).toBe(true)
    expect(container.hasAttribute('data-allfantasy-widget-root')).toBe(true)
  })

  it('unmounting empties the shadow root', () => {
    const host = makeHost()
    const shadowRoot = attachShadowMountRoot(host, 'open')
    mountShadowContainer(shadowRoot)
    expect(shadowRoot.childNodes.length).toBeGreaterThan(0)
    unmountShadowContainer(shadowRoot)
    expect(shadowRoot.childNodes.length).toBe(0)
  })

  it('unmounting an already-empty shadow root is a safe no-op', () => {
    const host = makeHost()
    const shadowRoot = attachShadowMountRoot(host, 'open')
    expect(() => unmountShadowContainer(shadowRoot)).not.toThrow()
  })

  it('mounting again replaces the previous container without re-attaching the shadow root', () => {
    const host = makeHost()
    const shadowRoot = attachShadowMountRoot(host, 'open')
    const first = mountShadowContainer(shadowRoot)
    const second = mountShadowContainer(shadowRoot)
    expect(shadowRoot.contains(first)).toBe(false)
    expect(shadowRoot.contains(second)).toBe(true)
    expect(shadowRoot.childNodes.length).toBe(1)
  })
})
