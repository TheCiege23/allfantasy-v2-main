import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { blobTokenSource, getBlobReadWriteToken } from '@/lib/blob/readWriteToken'

/**
 * The Blob token resolver — deliberate, documented debt.
 *
 * 🛑 WHY THIS EXISTS. A Vercel Blob connection names its variables after a prefix chosen
 * in the connect dialog: `<PREFIX>_READ_WRITE_TOKEN`. The `BLOB` prefix was already taken
 * by a dead connection's leftover `BLOB_STORE_ID` / `BLOB_WEBHOOK_PUBLIC_KEY`, so the live
 * store had to connect as `BLOB1` — producing a correct, integration-managed token under a
 * name no code reads. Hand-copying it into `BLOB_READ_WRITE_TOKEN` failed three times
 * (quotes captured in the paste, a store id pasted instead of a token, and one value that
 * tested clean locally yet still returned "Access denied" in production).
 *
 * ⚠ THE ORDERING TEST IS THE ONE THAT MATTERS. Primary must win, so that fixing the config
 * properly retires this fallback silently. If the fallback won instead, tidying the Vercel
 * variables later would appear to change nothing and the debt would become permanent.
 */

const KEYS = ['BLOB_READ_WRITE_TOKEN', 'BLOB1_READ_WRITE_TOKEN'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('blob token resolution', () => {
  it('returns undefined when neither variable is set', () => {
    expect(getBlobReadWriteToken()).toBeUndefined()
    expect(blobTokenSource()).toBe('none')
  })

  it('reads the canonical name when it is present', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_PRIMARY'
    expect(getBlobReadWriteToken()).toBe('vercel_blob_rw_PRIMARY')
    expect(blobTokenSource()).toBe('BLOB_READ_WRITE_TOKEN')
  })

  it('falls back to the BLOB1 name the connection actually created', () => {
    process.env.BLOB1_READ_WRITE_TOKEN = 'vercel_blob_rw_FALLBACK'
    expect(getBlobReadWriteToken()).toBe('vercel_blob_rw_FALLBACK')
    expect(blobTokenSource()).toBe('BLOB1_READ_WRITE_TOKEN')
  })

  it('PRIMARY WINS when both are set, so fixing the config retires the fallback', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_PRIMARY'
    process.env.BLOB1_READ_WRITE_TOKEN = 'vercel_blob_rw_FALLBACK'
    expect(getBlobReadWriteToken()).toBe('vercel_blob_rw_PRIMARY')
    expect(blobTokenSource()).toBe('BLOB_READ_WRITE_TOKEN')
  })

  /*
   * ⚠ AN EMPTY OR WHITESPACE VALUE MUST NOT COUNT AS SET. `.env` in this repo carries a
   * bare `BLOB_READ_WRITE_TOKEN=` with no value; a truthiness check on the raw string
   * would treat "" as present and return it, producing "Access denied" rather than falling
   * through to the working one.
   */
  it('treats empty and whitespace-only as unset', () => {
    process.env.BLOB_READ_WRITE_TOKEN = ''
    process.env.BLOB1_READ_WRITE_TOKEN = 'vercel_blob_rw_FALLBACK'
    expect(getBlobReadWriteToken()).toBe('vercel_blob_rw_FALLBACK')

    process.env.BLOB_READ_WRITE_TOKEN = '   '
    expect(getBlobReadWriteToken()).toBe('vercel_blob_rw_FALLBACK')
    expect(blobTokenSource()).toBe('BLOB1_READ_WRITE_TOKEN')
  })

  it('trims a value that arrived with surrounding whitespace', () => {
    // A paste that captured a trailing newline is one of the ways this went wrong.
    process.env.BLOB_READ_WRITE_TOKEN = '  vercel_blob_rw_PRIMARY\n'
    expect(getBlobReadWriteToken()).toBe('vercel_blob_rw_PRIMARY')
  })

  it('reports a source name only, never a value', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_SECRET'
    expect(blobTokenSource()).not.toContain('SECRET')
  })

  /*
   * ⚠ THE WARNING IS THE REMOVAL SIGNAL, so it has to actually fire. Silent debt is
   * permanent debt: without a line in the log, the day someone tidies the Vercel variables
   * looks like every other day, and the only evidence this module is still load-bearing
   * would be someone happening to read it.
   */
  it('warns once when the fallback is carrying production, and never leaks the token', async () => {
    vi.resetModules()
    const { getBlobReadWriteToken: fresh } = await import("@/lib/blob/readWriteToken")
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      process.env.BLOB1_READ_WRITE_TOKEN = 'vercel_blob_rw_FALLBACK_SECRET'
      fresh()
      fresh()
      fresh()
      expect(warn).toHaveBeenCalledTimes(1) // once per process, not per upload
      const msg = String(warn.mock.calls[0]?.[0] ?? '')
      expect(msg).toContain('BLOB1_READ_WRITE_TOKEN')
      expect(msg).not.toContain('FALLBACK_SECRET')
    } finally {
      warn.mockRestore()
    }
  })

  it('stays quiet when the canonical variable is doing the work', async () => {
    vi.resetModules()
    const { getBlobReadWriteToken: fresh } = await import("@/lib/blob/readWriteToken")
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_PRIMARY'
      process.env.BLOB1_READ_WRITE_TOKEN = 'vercel_blob_rw_FALLBACK'
      fresh()
      // Nothing to report: the config is correct and the debt is retired.
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('every upload path uses the resolver', () => {
  /*
   * The resolver is worthless if a call site still reads process.env directly — that site
   * would keep failing while the others worked, which is the hardest kind of bug to see.
   */
  it.each([
    'lib/avatar/ProfileImageUploadStorageService.ts',
    'app/api/user/profile/avatar/route.ts',
    'app/api/chat/upload/route.ts',
    'app/api/shared/chat/upload/route.ts',
    'app/api/bracket/chat-upload/route.ts',
  ])('%s reads the token through getBlobReadWriteToken', async (file) => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), file), 'utf8')
    expect(src).toContain('getBlobReadWriteToken')
    expect(src).not.toContain('process.env.BLOB_READ_WRITE_TOKEN')
  })
})
