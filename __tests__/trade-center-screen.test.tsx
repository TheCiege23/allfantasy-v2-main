import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import React from 'react'

import { TradeCenter } from '@/components/core-app/screens/TradeCenter'

const SRC = readFileSync(
  resolve(process.cwd(), 'components/core-app/screens/TradeCenter.tsx'),
  'utf8',
)
const PAGE = readFileSync(resolve(process.cwd(), 'app/core/[[...screen]]/page.tsx'), 'utf8')

const LEAGUE = { id: 'l1', name: 'Last League Left', format: 'Dynasty · PPR', teamCount: 12 }

function text(ui: React.ReactElement): string {
  return (render(ui).container.textContent ?? '').replace(/\s+/g, ' ')
}

describe('Trade Center renders and is reachable', () => {
  it('shows the league context and the full asset vocabulary', () => {
    const t = text(<TradeCenter league={LEAGUE} />)
    expect(t).toContain('Trade Center')
    expect(t).toContain('Last League Left')
    /* The legend documents every asset class regardless of this deal's contents. */
    expect(t).toContain('Idol · Survivor')
    expect(t).toContain('Weapon · Zombie')
    expect(t).toContain('Serum · Zombie')
  })

  it('⚠ is wired into /core/trades and does not replace the history', () => {
    /*
     * Additive rather than a swap — nothing that already works is lost while the
     * new surface settles.
     */
    expect(PAGE).toContain('<TradeCenter')
    expect(PAGE).toContain('<Trades data={trades} />')
  })

  it('⚠ posts to the EXISTING analyze route, not a new one', () => {
    // The repo sits at the platform's route ceiling and a page is not worth one.
    expect(SRC).toContain("'/api/trade-value/analyze'")
    expect(SRC).toContain('NO NEW API ROUTE')
  })

  it('says the deadline when the league has one', () => {
    expect(text(<TradeCenter league={LEAGUE} deadlineLabel="Deadline · week 11" />)).toContain(
      'Deadline · week 11',
    )
  })
})

describe('⚠ the honesty rules the design called load-bearing', () => {
  it('renders an unpriced asset as an em dash, never a zero', () => {
    /*
     * A defender the market feed cannot price is not worthless. money() returns
     * an em dash for null and totalOf skips unpriced lines rather than counting
     * them as zero.
     */
    expect(SRC).toContain('AN UNPRICED ASSET IS AN EM DASH, NEVER A ZERO')
    expect(SRC).toContain('Sum that ignores unpriced lines')
  })

  it('⚠ suppresses the verdict when the format blocks the deal', () => {
    /*
     * A score beneath a "this cannot happen" banner still gets read as a score.
     * The blocked banner leads and the verdict does not render at all.
     */
    expect(SRC).toContain('THE VERDICT IS SUPPRESSED WHEN THE FORMAT BLOCKS')
    expect(SRC).toContain('result && !blocked')
  })

  it('⚠ never lets a score stand alone when there is no signal', () => {
    /*
     * gradeScale.ts warns that C spans a wide band, so a trade we know nothing
     * about lands mid-C and looks identical to a genuinely even one.
     */
    expect(SRC).toContain('no signal, not that the trade is fair')
  })

  it('⚠ keeps the note groups visually separate from the verdict', () => {
    // That separation is product logic, not decoration — the design brief said
    // so and so does the engine.
    expect(SRC).toContain('Additive context. Never merged with the verdict')
  })
})

describe('⚠ what was deliberately NOT built', () => {
  it('does not fake multi-team or cross-platform', () => {
    /*
     * Neither has backing schema. 3+ teams needs the two-sided input shape
     * replaced AND a real answer for how fairness generalises past two sides; a
     * linked deal needs a LinkedTradeProposal with a status machine, because no
     * platform can enforce the other leg. Rendering either would be a UI
     * promising a transaction the system cannot make.
     */
    expect(SRC).toContain('MULTI-TEAM AND CROSS-PLATFORM ARE NOT BUILT')
    /*
     * Checked by IMPLEMENTATION, not vocabulary — the header names what those
     * states would require, which is the point of documenting the gap. What must
     * be absent is the machinery: no leg grouping, no third team.
     */
    expect(SRC).not.toContain('legId')
    expect(SRC).not.toContain('legGroups')
  })

  it('does not reimplement the preview-state switcher', () => {
    /*
     * The design ships a five-way toggle so a reviewer can see every layout. In
     * production those are situations the page falls into on its own.
     */
    expect(SRC).toContain('THE THREE STATES ARE ORGANIC, NOT A PREVIEW SWITCHER')
  })
})

describe('the asset picker', () => {
  const PICKER = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeAssetPicker.tsx'),
    'utf8',
  )

  it('⚠ uses the EXISTING player-search route', () => {
    // It was already built for exactly this and returns name/position/team/value.
    expect(PICKER).toContain('/api/trade-value/player-search')
    expect(PICKER).toContain('NO NEW API ROUTE')
  })

  it('offers only the three asset kinds the engine accepts', () => {
    expect(PICKER).toContain("'player' | 'pick' | 'faab'")
  })

  it('⚠ NAMES idols, weapons and serums rather than offering them', () => {
    /*
     * They are real assets in Survivor and Zombie leagues and they appear in the
     * legend — but TradeConsoleAnalyzeInput accepts player, pick and faab only.
     * A control that built one would produce an asset the engine rejects.
     */
    expect(PICKER).toContain('THE FORMAT-SPECIFIC CLASSES ARE NAMED, NOT OFFERED')
    expect(PICKER).toContain('cannot be added')
  })

  it('⚠ does not ask the manager to guess a pick slot', () => {
    /*
     * The slot is projected from the sending team's record. A field here would
     * let a hunch override a computed answer.
     */
    expect(PICKER).toContain('NO SLOT FIELD ON PURPOSE')
  })

  it('⚠ shows an em dash for an unpriced search result here too', () => {
    // The picker must not imply zero any more than the deal rows do.
    expect(PICKER).toContain("r.value == null ? '—'")
  })

  it('debounces rather than firing a request per keystroke', () => {
    expect(PICKER).toContain('DEBOUNCE_MS')
  })
})

describe('the builder holds the deal, not the engine echo', () => {
  it('⚠ a line the manager added survives the feed failing to price it', () => {
    /*
     * The engine's echo is used only for the prices it resolved. Rendering FROM
     * that echo would make an unpriced player vanish from the deal he is part of.
     */
    expect(SRC).toContain('a line the manager added must not disappear because')
    expect(SRC).toContain('const give = toLines(giveAssets)')
  })

  it('sends the real deal to the analyzer', () => {
    expect(SRC).toContain('sideGive: giveAssets.map(toInput)')
    expect(SRC).toContain('sideGet: getAssets.map(toInput)')
  })

  it('⚠ allows a player with no id, by name', () => {
    // The FantasyCalc search path returns no id, so requiring one would make the
    // most common search result unusable.
    expect(SRC).toContain('A PLAYER WITHOUT AN ID GOES BY NAME')
  })

  it('updates immutably, which the design brief called out by name', () => {
    expect(SRC).toContain('Immutable update')
    expect(SRC).toContain('prev.filter((_, i) => i !== index)')
  })
})

describe('phase 1 — the seams', () => {
  const FINDER = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeFinderPanel.tsx'),
    'utf8',
  )

  it('⚠ Ask Chimmy PREFILLS, it never sends', () => {
    /*
     * The comms contract is explicit: a screen that fires a question off on the
     * user's behalf has spent their request allowance on something they never
     * typed and cannot take back.
     */
    expect(SRC).toContain('PREFILL, NEVER SEND')
    expect(SRC).toContain('COMMS_OPEN_EVENT')
    expect(SRC).toContain("tab: 'chimmy'")
  })

  it('names the actual assets in the question', () => {
    // The drawer does not carry the builder's state, so "explain this trade"
    // would produce a vague answer to a vague question.
    expect(SRC).toContain("side('I give', give)")
    expect(SRC).toContain("side('I get', get)")
  })

  it('⚠ Trade Finder keeps its four refusals apart', () => {
    /*
     * Unsupported platform, unlinked account, outage, and genuinely nothing to
     * suggest are different answers. Collapsing them would tell a Yahoo manager
     * there are no trades available when the truth is we never looked.
     */
    expect(FINDER).toContain('FOUR REFUSALS, AND THEY ARE DIFFERENT ANSWERS')
    expect(FINDER).toContain('supported === false')
    expect(FINDER).toContain('linked === false')
    expect(FINDER).toContain('proposals.length === 0')
  })

  it('says an empty result is a real answer, not a gap', () => {
    expect(FINDER).toContain('That is a real answer')
  })

  it('⚠ renders rationale verbatim rather than summarising it', () => {
    // The service types it as checkable facts only; a paraphrase would turn a
    // fact into an opinion.
    expect(FINDER).toContain('would turn a fact into an opinion')
  })

  it('surfaces what the finder was missing', () => {
    expect(FINDER).toContain('Working without:')
  })

  it('uses the existing finder route', () => {
    expect(FINDER).toContain('/api/league/trade-finder')
  })
})

describe('phase 2 — mobile and drafts', () => {
  /*
   * ⚠ NORMALISED, BECAUSE THIS REPO CHECKS OUT CRLF. `core.autocrlf=true` means
   * the same file is LF in CI and CRLF on a Windows working tree, so an
   * assertion spanning a line break passes in one place and fails in the other
   * — it did, immediately after a rebase re-checked the file out. The rule is
   * the same one that bit the migration checksums: never let a test depend on
   * which machine wrote the newline.
   */
  const CSS = readFileSync(
    resolve(process.cwd(), 'components/core-app/af-trade-center.css'),
    'utf8',
  ).replace(/\r\n/g, '\n')

  it('⚠ does NOT add a bottom tab bar to one screen', () => {
    /*
     * The design shows one, but /core has no bottom nav anywhere else. Adding it
     * here alone would make the Trade Center look like a different app the
     * moment a user navigated away. That belongs to core chrome.
     */
    expect(CSS).toContain('NO BOTTOM TAB BAR HERE, DELIBERATELY')
  })

  it('scrolls chip rows on mobile rather than wrapping into a wall', () => {
    // Six asset pills wrapping on a 390px screen is four lines of legend above
    // the thing the page is for.
    expect(CSS).toContain('overflow-x: auto')
    expect(CSS).toContain('.af-tc-context .af-tc-spacer')
  })

  it('sticks the action row and drops the caption first', () => {
    expect(CSS).toContain('position: sticky')
    // The caption is context, not a control.
    expect(CSS).toContain('.af-tc-caption {\n    display: none;')
  })

  it('respects the 44px touch minimum used elsewhere in /core', () => {
    expect(CSS).toContain('min-height: 44px')
    expect(CSS).toContain('env(safe-area-inset-bottom')
  })

  it('⚠ a draft says which copy it got', () => {
    /*
     * Phase 2 shipped this device-local, with the banner saying so, because no
     * table existed. `TradeDraft` exists now and the account copy is preferred
     * — but the rule that made the original honest is the one that survives:
     * "Saved" with no qualifier implies it will be on their phone later, and
     * when the account is unreachable it will not be.
     */
    expect(SRC).toContain('THE ACCOUNT FIRST, THE BROWSER AS A FALLBACK')
    expect(SRC).toContain('Saved to your account')
    expect(SRC).toContain('Saved on this device only')
  })

  it('⚠ says when the browser refused, rather than failing silently', () => {
    // Private browsing and full quotas both throw, and silence reads as success.
    // Private browsing and full quotas both throw, and so does being offline.
    // Neither may report a save that did not happen.
    expect(SRC).toContain('Nothing could store this draft')
  })

  it('⚠ clears the verdict when a draft is restored', () => {
    // A restored deal is not an analysed one — leaving the old verdict up would
    // attach a score to a trade it was never computed for.
    expect(SRC).toContain('A restored deal is not an analysed one')
    expect(SRC).toContain('analyse it again to get a verdict')
  })

  it('scopes the draft key per league', () => {
    // One draft per league, not one global draft that leaks across them.
    expect(SRC).toContain('`af-trade-draft:${props.league.id}`')
  })
})

describe('⚠ naming the other side is what turns the counterparty layer on', () => {
  const ROSTERS = readFileSync(
    resolve(process.cwd(), 'app/api/leagues/[leagueId]/trades/rosters/route.ts'),
    'utf8',
  ).replace(/\r\n/g, '\n')
  const PICKER = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeAssetPicker.tsx'),
    'utf8',
  ).replace(/\r\n/g, '\n')

  it('sends the opponent id, without which buildTradeContextNotes returns no leverage at all', () => {
    /*
     * `buildLeverageNotes` bails on `if (!opponentTeamExternalId) return []`.
     * Their roster holes, the waiver wire they would replace from, and how they
     * have historically paid for the position all sit behind that one id — so
     * an anonymous "Their team" column silently discards half the ledger.
     */
    expect(SRC).toContain('opponentTeamExternalId: partnerRoster?.teamExternalId ?? null')
  })

  it('⚠ uses LeagueTeam.externalId, not a roster id and not a user id', () => {
    // An id from the wrong space returns no opponent rather than an error: the
    // notes simply never appear and nothing says why.
    expect(ROSTERS).toContain('externalIdByPlatformId')
    expect(SRC).toContain('NOT A ROSTER ID AND NOT A USER')
  })

  it('clears the verdict when the counterparty changes', () => {
    // The score on screen was computed against the previous manager's roster.
    expect(SRC).toContain('The verdict belonged to the previous counterparty.')
  })

  it('gives each column the picks its OWN roster holds', () => {
    // Passing the wrong side's would offer a manager a pick they do not hold,
    // and the engine would refuse it on send.
    expect(SRC).toContain("side.side === 'give' ? myRoster?.picks ?? [] : partnerRoster?.picks ?? []")
  })

  it('offers real picks above the hand-typed fallback, and labels which is which', () => {
    expect(PICKER).toContain('On the roster — can be proposed')
    expect(PICKER).toContain('priced but not proposable')
  })

  it('never claims a roster holds no picks when we do not know whose roster it is', () => {
    // "No picks on this roster" and "we do not know which roster" are different
    // facts, and only the first is safe to print.
    expect(PICKER).toContain('props.rosterKnown ? (')
  })
})

describe('⚠ two questions about the viewer, and one field cannot answer both', () => {
  const ROSTERS = readFileSync(
    resolve(process.cwd(), 'app/api/leagues/[leagueId]/trades/rosters/route.ts'),
    'utf8',
  ).replace(/\r\n/g, '\n')
  const PANEL = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeProposePanel.tsx'),
    'utf8',
  ).replace(/\r\n/g, '\n')

  it('returns them as separate fields', () => {
    /*
     * `viewerRosterId` answers "can I propose from this roster" and is the
     * engine's exact equality. `viewerTeamRosterId` answers "which team is mine
     * on screen" and resolves the way every other league surface does.
     */
    expect(ROSTERS).toContain('viewerRosterId: viewerRosterId?.id ?? null')
    expect(ROSTERS).toContain('viewerTeamRosterId,')
  })

  it('⚠ the strict predicate is null on every imported league, so identity cannot use it', () => {
    /*
     * On an import `Roster.platformUserId` holds the SLEEPER user id, so
     * `platformUserId === userId` never holds. Filtering "everyone but me" by
     * it filtered NOTHING and offered the manager their own team to trade with.
     */
    expect(SRC).toContain('r.rosterId !== rosterData?.viewerTeamRosterId')
    expect(SRC).not.toContain('r.rosterId !== rosterData?.viewerRosterId')
  })

  it('resolves identity the way the rest of the league surfaces do', () => {
    expect(ROSTERS).toContain('claimedByUserId: userId')
    expect(ROSTERS).toContain('sleeperUserId: true')
  })

  it('keeps the propose gate on the strict one', () => {
    // Anything looser lights up a Propose button createAfLeagueTrade refuses.
    expect(PANEL).toContain('const myRosterId = props.viewerRosterId')
  })
})
