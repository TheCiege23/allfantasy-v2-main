/**
 * The draft room's element ids must not differ between the server HTML and the first client
 * render. Plain `useId()` did, intermittently, on /e2e/draft-room-fixture and /drafts/[draftId]:
 * React drops a "forked" flag when a lazily loaded client component suspends during hydration,
 * so the client's ids lose bits the server's have (components/app/draft-room/useHydrationSafeId.ts).
 *
 * The test fakes that drift with a tree whose fork shape differs while the DOM stays identical:
 * the server renders `[null, <Probe/>]` (Probe is a forked child), the client renders `<Probe/>`
 * alone. The positive control shows plain `useId()` mismatches under that drift, so the hook's
 * clean pass means something.
 */
import React, { useId } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { useHydrationSafeId } from '@/components/app/draft-room/useHydrationSafeId'

function SafeProbe() {
  const id = useHydrationSafeId()
  return (
    <>
      <button type="button" aria-controls={id} data-testid="toggle">Filters</button>
      <div id={id} data-testid="region" />
    </>
  )
}

function PlainProbe() {
  const id = useId()
  return <div id={id} data-testid="region" />
}

/** Same DOM, different fork shape: the server's Probe is child 1 of 2, the client's is the only child. */
function serverTree(Probe: React.ComponentType) {
  return <div>{[null, <Probe key="p" />]}</div>
}
function clientTree(Probe: React.ComponentType) {
  return <div><Probe /></div>
}

async function hydrate(Probe: React.ComponentType) {
  const html = renderToString(serverTree(Probe))
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)
  const errors: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  })
  let root: ReturnType<typeof hydrateRoot> | undefined
  await act(async () => {
    root = hydrateRoot(container, clientTree(Probe), { onRecoverableError: (e) => errors.push(String(e)) })
  })
  spy.mockRestore()
  return { html, container, errors, unmount: () => act(() => root?.unmount()) }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useHydrationSafeId', () => {
  it('positive control: plain useId() mismatches when the fork shape drifts', async () => {
    const { errors, unmount } = await hydrate(PlainProbe)
    expect(errors.some((e) => /hydrat|didn't match/i.test(e))).toBe(true)
    await unmount()
  })

  it('renders no id on the first render, so server and client agree', async () => {
    const html = renderToString(serverTree(SafeProbe))
    expect(html).not.toMatch(/\sid="/)
    expect(html).not.toMatch(/aria-controls="/)
  })

  it('hydrates without a mismatch under the same drift, then links the pair after mount', async () => {
    const { errors, container, unmount } = await hydrate(SafeProbe)
    expect(errors.filter((e) => /hydrat|didn't match/i.test(e))).toEqual([])
    const toggle = container.querySelector('[data-testid="toggle"]')!
    const region = container.querySelector('[data-testid="region"]')!
    expect(region.id).toMatch(/\S/)
    expect(toggle.getAttribute('aria-controls')).toBe(region.id)
    await unmount()
  })
})

describe('draft room components do not call useId() directly', () => {
  // A source check, anchored to code: comment lines may name `useId()` to explain why it is not used.
  const dir = resolve(__dirname, '../../components/app/draft-room')
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && f !== 'useHydrationSafeId.ts')
  it.each(files)('%s', (file) => {
    const code = readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect(code).not.toMatch(/\buseId\(\)/)
  })
})
