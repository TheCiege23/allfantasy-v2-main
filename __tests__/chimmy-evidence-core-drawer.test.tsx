/**
 * The evidence block on the /core Chimmy drawer.
 *
 * ⚠ THE BUG THIS GUARDS AGAINST LEAVES NO TRACE. `/api/chat/chimmy` has always
 * returned confidence, sources, freshness and a missing-inputs list; the drawer
 * destructured four fields and dropped the rest at the `JSON.parse`. Nothing
 * threw, nothing was red, and the answer looked complete — it was simply
 * unaccompanied. So the assertions below are in two halves: the component
 * renders what it is given, AND the drawer actually reads those fields off the
 * envelope. A component test alone would pass with the wiring deleted.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChimmyEvidenceBlock, type ChimmyEvidence } from '@/components/core-app/comms/ChimmyEvidence'

function evidence(over: Partial<ChimmyEvidence> = {}): ChimmyEvidence {
  return {
    confidencePct: 78,
    level: 'medium',
    rationale: 'League context loaded; injury feed is two hours behind.',
    freshness: 'partial',
    leagueContext: 'available',
    basedOn: ['league_context', 'data_sources'],
    missing: ['fresh data sync'],
    dataSources: ['league_sports_grounding_packet', 'ai_memory'],
    sourceLinks: [{ label: 'League Home', href: '/league/abc' }],
    syncedAt: '2026-09-15T12:00:00.000Z',
    staleMinutes: 120,
    ...over,
  }
}

describe('what an answer was built from', () => {
  it('states confidence, freshness and source count without being asked', () => {
    render(<ChimmyEvidenceBlock evidence={evidence()} />)

    expect(screen.getByText(/medium confidence/i)).toBeTruthy()
    expect(screen.getByText(/78%/)).toBeTruthy()
    expect(screen.getByText(/2 sources/)).toBeTruthy()
    /* 120 minutes reads as hours, not as a raw minute count. */
    expect(screen.getByText(/2h behind/)).toBeTruthy()
  })

  /*
   * The half that changes what somebody DOES with the answer. A trust panel
   * that hides its caveats behind a click has made the reassuring half the
   * default reading, which is the opposite of the point.
   */
  it('shows the missing-input count before anything is expanded', () => {
    render(<ChimmyEvidenceBlock evidence={evidence()} />)
    expect(screen.getByTestId('chimmy-evidence-missing-count').textContent).toContain('1 missing')
    expect(screen.queryByTestId('chimmy-evidence-detail')).toBeNull()
  })

  it('names the sources in words, not in slugs', () => {
    render(<ChimmyEvidenceBlock evidence={evidence()} />)
    fireEvent.click(screen.getByRole('button', { name: /what is this based on/i }))

    const detail = screen.getByTestId('chimmy-evidence-detail')
    expect(detail.textContent).toContain('Your league settings and rosters')
    expect(detail.textContent).toContain('What Chimmy remembers about you')
    expect(detail.textContent).not.toContain('league_sports_grounding_packet')
    /* And what it could not read, verbatim from the rubric. */
    expect(detail.textContent).toContain('fresh data sync')
  })

  /*
   * ⚠ A SLUG NOBODY LABELLED IS STILL A SOURCE. Dropping unknown entries would
   * understate what an answer touched, and the set grows — `agent_prompt_*` and
   * `decision_os_grounding_*` are built by string concatenation at the route.
   */
  it('degrades an unlabelled source rather than hiding it', () => {
    render(<ChimmyEvidenceBlock evidence={evidence({ dataSources: ['agent_prompt_waiver'] })} />)
    fireEvent.click(screen.getByRole('button', { name: /what is this based on/i }))
    expect(screen.getByTestId('chimmy-evidence-detail').textContent).toContain('agent prompt waiver')
  })

  /*
   * The tool loop reports the lookups the model chose as its `dataSources`, so
   * on that path this list is the most precise sourcing the drawer can show.
   * It arrives with no contract at all — no level, no rationale — and must
   * still render.
   */
  it('renders a tool-loop answer, which carries sources and no contract', () => {
    render(
      <ChimmyEvidenceBlock
        evidence={evidence({
          level: null,
          rationale: null,
          freshness: null,
          leagueContext: null,
          basedOn: [],
          missing: [],
          confidencePct: null,
          sourceLinks: [],
          syncedAt: null,
          staleMinutes: null,
          dataSources: ['get_my_roster', 'get_player_value'],
        })}
      />,
    )
    expect(screen.getByText(/2 sources/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /what is this based on/i }))
    const detail = screen.getByTestId('chimmy-evidence-detail')
    expect(detail.textContent).toContain('Your roster, scoring and waiver budget')
    expect(detail.textContent).toContain('Player trade values')
  })

  /*
   * ⚠ NEGATIVE CONTROL, AND THE ONE CASE THAT MUST NOT RENDER. The off-topic
   * deflection sends `confidencePct: 0` because nothing was evaluated. A "0%"
   * badge under it would read as a confidence judgement about the answer rather
   * than as "no answer was attempted".
   */
  it('renders nothing when there is no evidence to show', () => {
    const { container } = render(
      <ChimmyEvidenceBlock
        evidence={evidence({
          confidencePct: 0,
          level: null,
          rationale: null,
          freshness: null,
          leagueContext: null,
          basedOn: [],
          missing: [],
          dataSources: [],
          sourceLinks: [],
          syncedAt: null,
          staleMinutes: null,
        })}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  /*
   * ⚠ THESE LINKS REACH THE DOM FROM A JSON PAYLOAD ON A PATH THAT ALSO CARRIES
   * MODEL OUTPUT. An external URL rendered as a clickable "source" is an open
   * redirect with a trust badge beside it. `//host` and `/\host` are
   * protocol-relative and defeat a bare startsWith('/').
   */
  it('renders only internal source links', () => {
    render(
      <ChimmyEvidenceBlock
        evidence={evidence({
          sourceLinks: [
            { label: 'League Home', href: '/league/abc' },
            { label: 'Free Money', href: 'https://evil.example/steal' },
            { label: 'Protocol Relative', href: '//evil.example/steal' },
            { label: 'Backslash', href: '/\\evil.example/steal' },
          ],
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /what is this based on/i }))
    expect(screen.getByRole('link', { name: 'League Home' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Free Money' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Protocol Relative' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Backslash' })).toBeNull()
  })
})

/*
 * The wiring half. Asserted against the source for the same reason
 * chimmy-tool-loop-route-wiring does it: driving this drawer end to end needs a
 * dozen mocks, and the property that matters is structural — that the fields
 * are READ off the envelope and handed to the block.
 */
describe('the drawer reads the evidence off the envelope', () => {
  const DRAWER = fs.readFileSync(
    path.join(process.cwd(), 'components', 'core-app', 'comms', 'CommsDrawer.tsx'),
    'utf8',
  )

  /*
   * ⚠ `contract` IS A SIBLING OF `meta`, NOT A FIELD INSIDE IT. The route
   * returns `{ response, sessionId, contract, meta }` — read only `meta` and
   * you get a percentage with no level, no rationale and, worst, no list of
   * what was missing.
   */
  it('reads BOTH the contract and the meta', () => {
    expect(DRAWER).toContain('payload.contract?.confidence')
    expect(DRAWER).toContain('meta?.dataSources')
    expect(DRAWER).toContain('meta?.confidencePct')
    expect(DRAWER).toContain('meta?.sourceLinks')
    expect(DRAWER).toContain('syncFreshness')
    expect(DRAWER).toContain('staleness')
  })

  it('attaches it to the turn and renders it', () => {
    expect(DRAWER).toContain('evidence: readEvidence(payload)')
    expect(DRAWER).toContain('<ChimmyEvidenceBlock evidence={t.evidence} />')
  })

  /*
   * Placement is a claim, not a detail: the caveats belong above "go make this
   * change on Sleeper", not underneath it.
   */
  it('puts the evidence above the platform hand-off', () => {
    expect(DRAWER.indexOf('<ChimmyEvidenceBlock')).toBeLessThan(DRAWER.indexOf('af-cm-handoff'))
  })
})
