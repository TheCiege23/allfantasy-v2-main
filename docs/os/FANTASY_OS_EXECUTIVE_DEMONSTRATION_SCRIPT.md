# Fantasy OS — Executive Demonstration Script (Phase V6.0)

**Audience:** sales engineers / solution architects running a live walkthrough. **Setup:** demo path B
from the Pilot Guide (a real authenticated demo account with connected leagues), branded via
`NEXT_PUBLIC_TENANT_ID`. Each Operating System answers **one executive question**, surfaces **one
recommended action**, and delivers **one reason it's valuable**.

> **Talk-track spine (repeat it):** "One question. One recommendation. One reason. Same calm executive
> language across all seven — the customer's brand, never the data provider's."

The order below is the recommended narrative arc: start at the executive summary (Platform), zoom into the
manager's own season, then rise to the operator/commissioner view and drill league → trade → waiver →
draft. Homes: **Manager Hub** (`/manager-hub`) hosts Platform / Manager / Waiver / Draft; **Commissioner
Hub** (`/commissioner-hub`) hosts Commissioner / League / Trade.

---

## 1. Platform OS — *Platform Focus* (Manager Hub)

- **Executive question:** "Across every league I manage, what needs my attention first?"
- **What you show:** the dominant Platform Focus summary at the top of the Manager Hub — ranked open work
  rolled up across all connected leagues and all Operating Systems.
- **Recommended action:** start where the ranking points — the single highest-priority item across the
  whole footprint.
- **Why valuable:** it is the executive layer *above* the others — one screen to triage a whole portfolio
  before drilling in. It summarizes the per-OS work without duplicating it.

## 2. Manager OS — *Championship Trajectory* (Manager Hub)

- **Executive question:** "How is my season tracking, and what should I do this week?"
- **What you show:** the Championship Trajectory flagship — current-state season read plus this week's
  prioritized manager actions.
- **Recommended action:** take the top lineup/roster decision for the week.
- **Why valuable:** a ~10-second read of "am I on track and what's my next move," without spreadsheets.
  (Playoff-probability / positional-strength are honestly deferred — see the Capability Matrix — so this is
  a decision snapshot, not a projection.)

## 3. Commissioner OS — *League Health Map* (Commissioner Hub)

- **Executive question:** "Which of my leagues need attention, and why?"
- **What you show:** the League Health Map — a worst-first ranked map of health dimensions across every
  managed league.
- **Recommended action:** fix the top-ranked at-risk dimension (e.g. a league missing a draft date, or an
  engagement risk).
- **Why valuable:** an operator running many leagues sees the whole portfolio's health in one ranked view
  and knows exactly where to intervene first.

## 4. League OS — *League Momentum* (Commissioner Hub → League Focus)

- **Executive question:** "How healthy and active is this specific league's ecosystem?"
- **What you show:** League Momentum for a selected league — the league's competitiveness and activity
  state.
- **Recommended action:** the indicated engagement/competitiveness step for that league.
- **Why valuable:** zooms from portfolio to a single league's vitality without changing visual language —
  the operator stays oriented.

## 5. Trade OS — *Trade Opportunity Matrix* (Commissioner Hub → League Focus)

- **Executive question:** "Where are the actionable trade opportunities in this league?"
- **What you show:** the Trade Opportunity Matrix — the market view of where trade activity/opportunity
  sits, framed by the league's own recommendations.
- **Recommended action:** pursue the highlighted trade conversation.
- **Why valuable:** it presents the *market*, not a player-value calculator — an executive read of where
  movement is likely, which is what an operator and an engaged manager both want first.

## 6. Waiver OS — *Waiver Impact Sequence* (Manager Hub)

- **Executive question:** "What waiver moves matter most, and in what order?"
- **What you show:** the Waiver Impact Sequence — an ordered, numbered sequence of the waiver actions that
  matter (priority-ranked, not a fabricated timeline).
- **Recommended action:** execute the top-ranked claim first.
- **Why valuable:** turns a noisy waiver wire into a prioritized action list. (FAAB/resource strategy is
  deferred pending a future contract — Capability Matrix — so this is impact-ordered, not budget-optimized.)

## 7. Draft OS — *Draft Decision Ladder* (Manager Hub)

- **Executive question:** "What draft-prep decisions need my attention before the draft?"
- **What you show:** the Draft Decision Ladder — an ordered ladder of draft-preparation actions from the
  engine's own priority.
- **Recommended action:** take the top draft-prep step.
- **Why valuable:** readiness before the clock starts. (Draft value curves / ADP / tiers are deferred
  pending a future contract — Capability Matrix — so this is a readiness ladder, not a value model.)

---

## Closing the demo

1. **Return to Platform OS** — show that everything just walked through rolls back up into the one
   executive summary. "Seven questions, one triage screen."
2. **Point at the brand** — the whole walkthrough was under the customer's name/theme; no provider string
   appeared anywhere on the executive surface.
3. **Set expectations honestly** — hand to the Known Capability Boundary Matrix: the deferred items each
   light up later by adding a card, not by redesigning any dashboard.

## Demo hygiene notes

- Use demo path B (real connected account) for a populated walkthrough; demo path A (Commissioner preview)
  is the no-login branding teaser only.
- If a workspace shows an honest "not available" state, that is truthfulness by design — frame it as a
  strength ("it never invents numbers"), and move on.
- Keep the talk-track to question → recommendation → reason; resist diving into underlying mechanics on the
  executive surface (that is the Onboarding/Security material, for the technical reviewer).
