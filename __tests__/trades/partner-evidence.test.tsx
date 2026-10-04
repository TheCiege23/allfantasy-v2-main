// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TradePartnerEvidence } from '@/components/core-app/screens/TradePartnerEvidence'
describe('partner evidence at the trade verdict',()=>{
  it('shows returned roster reasons without presenting acceptance as known',()=>{
    render(<TradePartnerEvidence copy={s=>s} notes={['They have one healthy TE.','They have one healthy TE.',' ']} />)
    expect(screen.getAllByText('They have one healthy TE.')).toHaveLength(1)
    expect(screen.getByText(/not the manager’s preferences or an acceptance forecast/)).toBeTruthy()
  })
  it('discloses missing partner evidence rather than inventing a need',()=>{
    render(<TradePartnerEvidence copy={s=>s} notes={[]} />)
    expect(screen.getByText(/No partner roster evidence was returned/)).toBeTruthy()
    expect(screen.queryByText('Partner roster evidence')).toBeNull()
  })
})
