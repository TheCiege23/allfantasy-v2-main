/**
 * Owner follow-up 2026-11-28: the devy and C2C settings AI panels greyed out EVERY button without AF
 * Commissioner, including the player-level actions the server now opens on Chimmy Intelligence
 * (`af_intelligence`: AF Pro, AF Commissioner, AF Supreme). The player buttons now follow `hasPlayerAi`;
 * the league tools stay on `hasAfSub` (AF Commissioner).
 */
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { DevyAIPanel } from '@/app/devy/components/settings/DevyAIPanel'
import { C2CAIPanel } from '@/app/c2c/components/settings/C2CAIPanel'

afterEach(() => cleanup())

const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('DevyAIPanel', () => {
  it('AF Pro (Chimmy Intelligence, no AF Commissioner): player tools on, league tools off', () => {
    render(<DevyAIPanel leagueId="L1" hasAfSub={false} hasPlayerAi isCommissioner />)
    expect(button(/^Breakout alerts$/).disabled).toBe(false)
    expect(button(/^Draft advice/).disabled).toBe(false)
    expect(button(/^Setup recommendation$/).disabled).toBe(true)
    expect(button(/^League constitution$/).disabled).toBe(true)
    expect(button(/^Annual report$/).disabled).toBe(true)
    expect(screen.getByText(/player tools below are included with your plan/)).toBeTruthy()
  })

  it('Free: everything off', () => {
    render(<DevyAIPanel leagueId="L1" hasAfSub={false} hasPlayerAi={false} isCommissioner />)
    for (const name of [/^Breakout alerts$/, /^Draft advice/, /^Setup recommendation$/, /^League constitution$/]) {
      expect(button(name).disabled).toBe(true)
    }
  })

  it('AF Commissioner: everything on', () => {
    render(<DevyAIPanel leagueId="L1" hasAfSub hasPlayerAi isCommissioner />)
    for (const name of [/^Breakout alerts$/, /^Draft advice/, /^Setup recommendation$/, /^League constitution$/]) {
      expect(button(name).disabled).toBe(false)
    }
  })
})

describe('C2CAIPanel', () => {
  it('AF Pro: breakout, rankings and draft advice on; setup, constitution and weekly recap off', () => {
    render(<C2CAIPanel leagueId="L1" hasAfSub={false} hasPlayerAi c2cConfig={null} isCommissioner />)
    expect(button(/^Breakout alerts$/).disabled).toBe(false)
    expect(button(/rankings/i).disabled).toBe(false)
    expect(button(/draft advice/i).disabled).toBe(false)
    expect(button(/^Setup advisor$/).disabled).toBe(true)
    expect(button(/constitution/i).disabled).toBe(true)
    expect(button(/weekly recap/i).disabled).toBe(true)
  })

  it('Free: the player tools stay off', () => {
    render(<C2CAIPanel leagueId="L1" hasAfSub={false} hasPlayerAi={false} c2cConfig={null} isCommissioner />)
    expect(button(/^Breakout alerts$/).disabled).toBe(true)
    expect(button(/rankings/i).disabled).toBe(true)
  })
})
