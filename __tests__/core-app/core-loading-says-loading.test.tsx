import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * 🛑 The /core loading screen must SAY it is loading. Reported 2026-11-20 from the iOS app: reopening
 * it sat on "an empty blue screen" — this skeleton, shown for 10-18s on a large account, read as frozen.
 */
const jar = vi.hoisted(() => ({ lang: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (k: string) => (k === 'af_lang' && jar.lang ? { value: jar.lang } : undefined) }),
}))

import AfCoreLoading from '@/app/core/loading'

afterEach(() => { cleanup(); jar.lang = undefined })

async function show() {
  return render(await AfCoreLoading())
}

describe('the /core loading screen', () => {
  it('shows the crest, a spinner and words that say it is loading', async () => {
    const { container, getByRole } = await show()
    const status = getByRole('status')
    expect(status.textContent).toContain('Loading your leagues…')
    expect(status.querySelector('svg')).not.toBeNull()
    expect(status.querySelector('.af-sk-spinner')).not.toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('speaks Spanish when the reader chose it', async () => {
    jar.lang = 'es'
    const { getByRole } = await show()
    expect(getByRole('status').textContent).toContain('Cargando tus ligas…')
  })
})
