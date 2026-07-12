import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('G55 import UX hardening', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/unified-import-ui/LeagueImportFlow.tsx'),
    'utf8',
  )

  it('communicates preview and persistence progress accessibly', () => {
    expect(source).toContain('role="status"')
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('preparing a safe preview')
    expect(source).toContain('saving imported settings, members, and rosters')
  })

  it('gives failed previews a safe retry path and persistence boundary guidance', () => {
    expect(source).toContain('Retry preview')
    expect(source).toContain('No league is created until')
    expect(source).toContain('runPreview(failedPreview.provider, failedPreview.sourceInput)')
  })
})
