import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

describe('G60 RC1 source freeze', () => {
  it('does not promote runtime-only capabilities or the dirty candidate to release truth', () => {
    const report = read('docs/redraft/G60_RELEASE_CANDIDATE_1.md')

    expect(report).toContain('DETERMINISTIC RC COMMIT CREATED: NO')
    expect(report).toContain('AUTHENTICATED RUNTIME CERTIFIED: NO')
    expect(report).toContain('LIVE PROVIDER CERTIFIED: NO')
    expect(report).toContain('RECOMMENDED FOR LAUNCH: NO')
  })

  it('keeps auction and reversal outside the invited MVP', () => {
    const report = read('docs/redraft/G60_RELEASE_CANDIDATE_1.md')
    const matrix = read('docs/redraft/NFL_NCAAF_INVITED_MVP_FEATURE_MATRIX.md')

    expect(matrix).toContain('| Auction draft | Deferred |')
    expect(report).toContain('Trade reversal, Renewal Gate C')
    expect(report).toContain('Auction cannot be promoted by source presence')
  })

  it('uses customer-safe intelligence and import copy in corrected RC surfaces', () => {
    const mockDraft = read('app/mock-draft/page.tsx')
    const autopick = read('components/app/draft-room/AutopickMeToggle.tsx')
    const quickCreate = read('components/league-creation/QuickCreateModal.tsx')
    const mode = read('components/league-creation/LeagueCreationModeSelector.tsx')
    const compactMode = read('components/league-creation/LeagueCreationImportSelector.tsx')

    expect(mockDraft).toContain('Draft Assist')
    expect(mockDraft).not.toContain('AI-powered insights')
    expect(mockDraft).not.toContain('Sleeper-style AI mock room')
    expect(autopick).toContain('Smart Queue')
    expect(autopick).not.toContain('AI Queue{')
    expect(quickCreate).toContain('Guided Quick Create')
    expect(quickCreate).toContain('Coach will prepare settings for your review')
    expect(mode).toContain('choose a supported provider')
    expect(compactMode).toContain('choose a supported provider')
  })

  it('ships all four RC package documents with explicit ownership and evidence fields', () => {
    const releaseNotes = read('docs/redraft/NFL_INVITED_MVP_RELEASE_NOTES.md')
    const risks = read('docs/redraft/NFL_INVITED_MVP_RISK_REGISTER.md')
    const checklist = read('docs/redraft/NFL_INVITED_MVP_RC_CHECKLIST.md')

    expect(releaseNotes).toContain('working-tree package, not yet a reproducible frozen commit')
    expect(risks).toContain('| Rank | Category | Risk | Severity | Likelihood | Impact | Mitigation | Certification step | Owner |')
    expect(checklist).toContain('| Item | Owner | Status | Evidence | Blocker / exit action |')
  })
})
