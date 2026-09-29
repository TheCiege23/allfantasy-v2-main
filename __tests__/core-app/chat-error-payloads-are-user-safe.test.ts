/**
 * A chat route's `error` string is rendered VERBATIM in the chat UI, so it must be copy we wrote.
 *
 * `ThreadPanel` does `throw new Error(data.error ?? '…')` and then `setError(e.message)`
 * (components/core-app/comms/ThreadPanel.tsx:174, 200, 355) — whatever the route puts in `error`
 * appears in the panel. Today every payload under `app/api/shared/chat` is hand-written and safe
 * ("Message too long", "Forbidden", "File type not allowed"); a census on 2026-09-28 found ZERO
 * raw-exception interpolations. This test is what keeps that true.
 *
 * ⚠ THE LEAK IT PREVENTS IS ONE LINE WIDE. `error: String(e)` or `error: (e as Error).message` in
 * any of these routes puts a Prisma message, a connection string fragment or a stack line into a
 * message bubble — and it would look completely ordinary in review, because the shape
 * (`return NextResponse.json({ error: … }, { status: 500 })`) is the shape every other route uses.
 *
 * ⚠ IT CHECKS THE ROUTES, NOT THE PANEL, and that is deliberate: sanitising in the panel would
 * hide the leak rather than stop it, and the panel cannot tell a safe message from an unsafe one.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd(), 'app/api/shared/chat')

function routeFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, found)
    else if (entry === 'route.ts' || entry === 'route.tsx') found.push(full)
  }
  return found
}

/** `error:` values built from a caught exception rather than written as copy. */
const RAW_EXCEPTION_PAYLOAD =
  /error:\s*(?:String\(\s*(?:e|err|error)\b|(?:\(\s*)?(?:e|err|error)\s+as\s+Error\s*\)?\s*\.message|(?:e|err|error)\.message|(?:e|err|error)\s*\?\?|`[^`]*\$\{\s*(?:String\()?\s*(?:e|err|error)\b)/

describe('chat route error payloads are copy we wrote', () => {
  const files = routeFiles(ROOT)

  it('found the routes at all — an empty scan would pass every assertion below', () => {
    // The control this file would otherwise lack: a wrong ROOT makes the whole suite vacuously green.
    expect(files.length).toBeGreaterThan(5)
  })

  for (const file of files) {
    const rel = file.slice(file.indexOf('app')).replace(/\\/g, '/')
    it(`${rel} never returns a caught exception as its error string`, () => {
      const src = readFileSync(file, 'utf8')
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      const offending = code
        .split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => RAW_EXCEPTION_PAYLOAD.test(line))
      expect(
        offending,
        `${rel} puts a caught exception into a user-visible error string:\n` +
          offending.map(({ n, line }) => `  ${n}: ${line}`).join('\n'),
      ).toEqual([])
    })
  }
})
