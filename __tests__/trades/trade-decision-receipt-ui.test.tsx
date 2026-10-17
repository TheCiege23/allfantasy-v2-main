import {afterEach,describe,it,expect} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {TradeOutcomeReceipt} from '@/components/core-app/screens/TradeOutcomeReceipt'
import {TradePackageCost} from '@/components/core-app/screens/TradePackageCost'
afterEach(cleanup)
describe('decision receipts and package disclosures',()=>{
  it('does not label a live grade as a frozen original or render missing outcomes as zero',()=>{
    render(<TradeOutcomeReceipt original={{graded:false,reason:'No original',basis:null}} current={{graded:false,reason:'No current quote',basis:null}} realized={null}/>)
    expect(screen.getByText('No frozen original assessment is available here.')).toBeTruthy()
    expect(screen.getByText('No current quote')).toBeTruthy()
    expect(screen.getByText(/No matching stored production ledger/)).toBeTruthy()
    expect(screen.queryByText('0.0')).toBeNull()
  })
  it('keeps negative credited production visible without a misleading positive-only graph',()=>{
    render(<TradeOutcomeReceipt current={null} realized={{asOf:'2026-10-03T12:00:00Z',stale:true,ongoing:true,receivedPoints:-2,sentPoints:25,assets:[],notes:[]}}/>)
    expect(screen.getByText(/Acquired assets: -2.0 credited points/)).toBeTruthy()
    expect(screen.getByText(/ledger is stale/)).toBeTruthy()
    expect(screen.queryByRole('heading',{name:'Credited production during recorded tenure'})).toBeNull()
  })
  it('discloses that the starting-lineup graph precedes required drops',()=>{
    render(<TradePackageCost cost={{capacity:16,activeBefore:16,activeAfter:18,requiredDrops:2,displacedStarters:[],candidates:[{playerId:'1',name:'Bench player',singleDropLineupCost:0}],note:'Zero cost does not mean no future value.'}}/>)
    expect(screen.getByText('2 drops needed before this package fits.')).toBeTruthy()
    expect(screen.getByText(/package before required drops/)).toBeTruthy()
    expect(screen.getByText('0.0')).toBeTruthy()
  })
})
