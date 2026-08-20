/**
 * Phase 5H — lightweight source locks for draft trust UX (mobile + reconnect + picks).
 * Complements RTL tests elsewhere; avoids mounting the full DraftRoomPageClient shell.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
const clientSrc = readFileSync(resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'), 'utf8')
const topBarSrc = readFileSync(resolve(root, 'components/app/draft-room/DraftTopBar.tsx'), 'utf8')
const syncSrc = readFileSync(resolve(root, 'hooks/useLiveDraftSync.ts'), 'utf8')

describe('Phase 5H — duplicate pick submit guard', () => {
  it('DraftRoomPageClient gates rapid picks with pickInflightRef', () => {
    expect(clientSrc).toMatch(/pickInflightRef/)
    expect(clientSrc).toMatch(/if \(pickInflightRef\.current\) return/)
  })

  it('POST pick body includes expectedOverall when available', () => {
    expect(clientSrc).toMatch(/expectedOverall:/)
    expect(clientSrc).toMatch(/draftCore\?\.currentOverall/)
  })
})

describe('Phase 5H — reconnect / resync affordances', () => {
  it('DraftTopBar exposes resync-in-flight chip for trust UX', () => {
    expect(topBarSrc).toMatch(/data-testid="draft-topbar-resync-active"/)
  })

  it('DraftRoomPageClient passes connection state into DraftTopBar', () => {
    expect(clientSrc).toMatch(/isReconnecting=\{connectionDegraded\}/)
    expect(clientSrc).toMatch(/resyncLoading=\{resyncLoading\}/)
  })

  it('useLiveDraftSync flips degraded UI after repeated poll failures', () => {
    expect(syncSrc).toMatch(/SESSION_POLL_FAILS_FOR_DEGRADED = 5/)
    expect(syncSrc).toMatch(/setConnectionDegraded\(true\)/)
  })
})

describe('Phase 5H — stale snapshot + authority errors', () => {
  it('imports draftTrustUi helpers', () => {
    expect(clientSrc).toMatch(/from '@\/lib\/draft-room\/draftTrustUi'/)
    expect(clientSrc).toMatch(/shouldWarnStaleSnapshot/)
    expect(clientSrc).toMatch(/friendlyPickAuthorityMessage/)
  })

  it('stale snapshot banner test id present', () => {
    expect(clientSrc).toMatch(/data-testid="draft-stale-snapshot-banner"/)
  })

  it('pick submitting banner explains duplicate taps', () => {
    expect(clientSrc).toMatch(/data-testid="draft-pick-submitting-banner"/)
  })
})
