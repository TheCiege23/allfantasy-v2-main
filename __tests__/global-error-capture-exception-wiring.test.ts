import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Phase 39: audit found the root `global-error.tsx` boundary only does
// `console.error`, unlike `components/error-handling/ErrorBoundary.tsx`
// (the segment-level boundary), which routes through `captureException` —
// the shared sink that both logs via `logError` and forwards to the
// registered Sentry reporter when configured. Root-level crashes (the most
// severe class — they replace the whole layout) were silently excluded from
// that pipeline. This is a pure wiring gap, not a logging-stack rewrite.
const source = readFileSync(resolve(__dirname, '..', 'app', 'global-error.tsx'), 'utf8')

describe('app/global-error.tsx — error-tracking wiring (Phase 39)', () => {
  it('imports captureException from the shared error-tracking sink', () => {
    expect(source).toMatch(/from ['"]@\/lib\/error-tracking['"]/)
    expect(source).toContain('captureException')
  })

  it('calls captureException with the caught error inside its effect', () => {
    const effectBlock = source.slice(source.indexOf('useEffect'), source.indexOf('}, [error])'))
    expect(effectBlock).toContain('captureException(error')
  })

  it('still logs to console for local/Railway log visibility (does not remove the existing behavior)', () => {
    expect(source).toContain('console.error')
  })
})
