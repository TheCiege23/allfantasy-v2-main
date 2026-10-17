import { describe, expect, it } from 'vitest'
import { validateObservedMarketAdpBoard } from '@/lib/adp/observedMarketAdpBoard'
const now = new Date('2026-09-27T15:00:00Z')
for (const sport of ['NFL','NBA','NHL','MLB','NCAAF','NCAAB','SOCCER']) {
  const expected = { sport, season:2026, format:'redraft' as const, scoring:'points' }
  const board = () => ({ ...expected, evidenceType:'observed_drafts',licensedForUse:true,source:'licensed-export',asOf:now.toISOString(),players:[{ canonicalPlayerId:'canonical-1',providerPlayerId:'vendor-1',playerName:'Player One',position:'P',team:null,adp:12.5,draftSampleSize:40 }] })
  describe(sport + ' observed ADP export', () => {
    it('accepts matching observed evidence', () => expect(validateObservedMarketAdpBoard(board(),expected,now).players[0].adp).toBe(12.5))
    it.each(['rankings','projection','ai_estimate'])('refuses %s as market ADP', evidenceType => expect(() => validateObservedMarketAdpBoard({...board(),evidenceType},expected,now)).toThrow())
    it('refuses wrong season', () => expect(() => validateObservedMarketAdpBoard({...board(),season:2025},expected,now)).toThrow('CONTEXT_MISMATCH'))
    it('refuses stale as-of date', () => expect(() => validateObservedMarketAdpBoard({...board(),asOf:'2026-09-01T15:00:00Z'},expected,now)).toThrow('AS_OF_OUT_OF_RANGE'))
    it('refuses ambiguous identities', () => expect(() => validateObservedMarketAdpBoard({...board(),players:[...board().players,...board().players]},expected,now)).toThrow('AMBIGUOUS_IDENTITY'))
    it('requires licensed use', () => expect(() => validateObservedMarketAdpBoard({...board(),licensedForUse:false},expected,now)).toThrow())
  })
}
