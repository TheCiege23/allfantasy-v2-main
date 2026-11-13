/**
 * Audit 2026-11-06, "Settings saved and never read": the Best Ball advanced settings offered a
 * "Draft Date (UTC)" and a "Slow Draft Clock (min)" that wrote `bestBall.draftDateUtc` /
 * `bestBall.slowDraftClockMinutes`, which nothing ever read — the draft runs on the league's own draft
 * schedule and pick clock. A commissioner must not see a control that does nothing, so they are gone.
 */
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { BestBallAdvancedSettings } from '@/components/create-league/BestBallAdvancedSettings'
import { DEFAULT_V2_STATE, getDefaultBestBallSetup, type CreateLeagueV2State } from '@/lib/create-league-v2/state'

const accent = {
  name: 'cyan',
  hex: '#22d3ee',
  hexSoft: '#67e8f9',
  ring: 'ring-cyan-400/40',
  glow: 'shadow-[0_0_20px_-8px_rgba(34,211,238,0.8)]',
  text: 'text-cyan-300',
  border: 'border-cyan-400/30',
  from: 'from-cyan-400/20',
  to: 'to-cyan-200/10',
} as never

function state(): CreateLeagueV2State {
  return { ...DEFAULT_V2_STATE, leagueType: 'best_ball', sport: 'NFL', bestBall: getDefaultBestBallSetup('NFL') }
}

describe('BestBallAdvancedSettings', () => {
  it('offers no best ball draft date or slow draft clock', () => {
    render(<BestBallAdvancedSettings state={state()} accent={accent} onChange={() => undefined} />)
    expect(screen.getByText('Best Ball Setup')).toBeInTheDocument()
    expect(screen.getByText('Timezone')).toBeInTheDocument()
    expect(screen.queryByText('Draft Date (UTC)')).toBeNull()
    expect(screen.queryByText('Slow Draft Clock (min)')).toBeNull()
  })
})
