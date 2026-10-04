// @vitest-environment jsdom
/**
 * The Sync button's progress and result lines follow the language switch (2026-10-04).
 *
 * `syncRunLoop.ts` and `clientSyncJob.ts` build them in English and the button printed them raw, so
 * every press showed English to a Spanish reader — and the auth guard's error CODES
 * ("UNAUTHENTICATED") were printed raw in English too. The button now translates at render. This
 * suite scans the producing modules so a new English line without Spanish fails here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { syncMessageText } from '@/lib/core-app/syncMessageText'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es', message: null as string | null, phase: 'done' }))

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/core-app/clientSyncJob', () => {
  // useSyncExternalStore needs a STABLE snapshot: a new object per call loops forever.
  let cached: { phase: string; message: string | null; completion: number } | null = null
  const snap = () => {
    if (!cached || cached.phase !== h.phase || cached.message !== h.message) cached = { phase: h.phase, message: h.message, completion: 0 }
    return cached
  }
  return {
    claimClientSyncRefresh: () => false,
    getClientSyncSnapshot: snap,
    getServerSyncSnapshot: snap,
    resumeClientSync: () => null,
    startClientSync: async () => undefined,
    subscribeClientSync: () => () => {},
  }
})

import { SyncNowButton } from '@/components/core-app/SyncNowButton'

afterEach(() => {
  cleanup()
  h.language = 'en'
  h.message = null
  h.phase = 'done'
})

/** Lines a reader can see, from a module's string literals (comments stripped, `${…}` filled). */
function displayedLines(path: string): Array<{ at: string; text: string }> {
  const src = readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '')
  const out: Array<{ at: string; text: string }> = []
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g)) {
    const text = m[2]!.replace(/\$\{([^}]*)\}/g, (_, expr: string) => (expr.includes('?') ? '' : '7'))
    const words = text.match(/[A-Za-z][a-z’']+/g) ?? []
    if (words.length < 2 || !text.includes(' ')) continue
    const line = code.slice(0, m.index).split('\n').length
    // A thrown Error's message is never displayed — the catch publishes its own line.
    if (/throw new Error\(/.test(code.split('\n')[line - 1] ?? '')) continue
    out.push({ at: `${path}:${line}`, text })
  }
  return out
}

describe('syncMessageText', () => {
  it('🛑 every line the sync modules can display has Spanish', () => {
    const lines = ['lib/core-app/syncRunLoop.ts', 'lib/core-app/clientSyncJob.ts'].flatMap(displayedLines)
    expect(lines.length).toBeGreaterThan(12) // the scan must see real lines
    expect(lines.some((l) => l.text.startsWith('Checked 7 of 7'))).toBe(true) // ...templates included
    const untranslated = lines.filter((l) => syncMessageText(l.text, 'es') === l.text).map((l) => `${l.at}  ${l.text}`)
    expect(untranslated).toEqual([])
  })

  it('the sync endpoint’s top-level error has Spanish', () => {
    const src = readFileSync(resolve(process.cwd(), 'app/api/core/sync/route.ts'), 'utf8')
    const top = [...src.matchAll(/\{ ok: false, error: '([^']+)' \}/g)].map((m) => m[1]!)
    expect(top.length).toBeGreaterThan(0)
    for (const e of top) expect(syncMessageText(e, 'es'), e).not.toBe(e)
  })

  it('counted lines, singular and plural', () => {
    expect(syncMessageText('Synced 5', 'es')).toBe('5 ligas sincronizadas')
    expect(syncMessageText('Synced 1', 'es')).toBe('1 liga sincronizada')
    expect(syncMessageText('Checked 4 of 12 · synced 3…', 'es')).toBe('Revisadas 4 de 12 · sincronizadas 3…')
    expect(syncMessageText('Synced 9 of 12 · 2 failed · 1 already syncing', 'es')).toBe(
      'Sincronizadas 9 de 12 · 2 con error · 1 ya en curso',
    )
    expect(syncMessageText('Synced 9 of 12 · 2 failed · 1 already syncing', 'en')).toBe('Synced 9 of 12 · 2 failed · 1 already syncing')
  })

  it('🛑 the auth guard’s codes become sentences — in English as well', () => {
    for (const code of ['UNAUTHENTICATED', 'INTERNAL_ERROR', 'AGE_REQUIRED', 'VERIFICATION_REQUIRED']) {
      expect(syncMessageText(code, 'en')).not.toBe(code)
      expect(syncMessageText(code, 'en')).toMatch(/ /)
      expect(syncMessageText(code, 'es')).not.toMatch(/[A-Z]{4,}_?/)
    }
    // Every code the guard can return is covered.
    const guard = readFileSync(resolve(process.cwd(), 'lib/auth-guard.ts'), 'utf8')
    const codes = [...guard.matchAll(/error: "([A-Z_]+)"/g)].map((m) => m[1]!)
    expect(codes.length).toBeGreaterThan(0)
    for (const c of codes) expect(syncMessageText(c, 'en'), c).not.toBe(c)
  })

  it('unknown text passes through, never blank', () => {
    expect(syncMessageText('something new', 'es')).toBe('something new')
    expect(syncMessageText(null, 'es')).toBe('')
  })
})

describe('SyncNowButton status line follows en → es → en', () => {
  it('a finished sync, then a raw auth code', () => {
    h.message = 'Synced 9 of 12 · 2 failed · 1 already syncing'
    const status = () => document.querySelector('.af-syncnow-msg')?.textContent
    const { rerender } = render(<SyncNowButton eligibleCount={12} />)
    expect(status()).toBe('Synced 9 of 12 · 2 failed · 1 already syncing')

    h.language = 'es'
    rerender(<SyncNowButton eligibleCount={12} />)
    expect(status()).toBe('Sincronizadas 9 de 12 · 2 con error · 1 ya en curso')

    h.language = 'en'
    h.message = 'UNAUTHENTICATED'
    rerender(<SyncNowButton eligibleCount={12} />)
    expect(status()).toBe('Sign in again to sync your leagues.')
  })

  it('a sync in progress', () => {
    h.phase = 'busy'
    h.message = 'Checked 4 of 12 · synced 3…'
    h.language = 'es'
    render(<SyncNowButton eligibleCount={12} />)
    expect(document.querySelector('.af-syncnow-msg')?.textContent).toBe('Revisadas 4 de 12 · sincronizadas 3…')
  })
})
