# Fantasy OS — Known Capability Boundary Matrix (Phase V6.0)

**Purpose:** an honest, single-page statement of what the executive layer intentionally **defers today**,
*why*, and *how each one integrates later without redesigning the executive layer*. Share this with a
customer's technical reviewer during a pilot — it is the "what's next / what's not here yet" contract.

> Every deferral below is **gated on a future Decision OS enhancement**, not on presentation work. Each has
> an in-code `*_DEFERRED` marker and a truthfulness flag (`has*Data/Series/History === false`) that is
> test-enforced, so the UI shows an honest "not available" state instead of fabricating the capability. The
> executive layer already reserves the seam; when the contract arrives, the capability is a **new builder +
> card + one render line** — no redesign of any existing workspace.

---

## The matrix

| Capability (deferred) | Operating System | Why deferred (missing today) | In-code marker | How it integrates later | Redesign? |
| --- | --- | --- | --- | --- | --- |
| **Waiver FAAB / resource strategy** (budget-optimized claims) | Waiver OS | No route exposes a waiver resource/FAAB contract (`WaiverResourceIntel`) | `WAIVER_RESOURCE_STRATEGY_DEFERRED` | Add a builder + card to `waiverDecisionViewModel` / `WaiverSupportingViz` consuming the new contract | No |
| **Draft value curve / ADP / tiers** | Draft OS | No route exposes draft runtime value (`DraftRuntimeIntelligenceResult`) | `DRAFT_VALUE_ANALYTICS_DEFERRED` | Add a builder + card; introduce an `ExecutiveSparkline` primitive *iff* a real value series arrives | No |
| **Platform Pulse (historical momentum/trend)** | Platform OS | No platform historical snapshots exist (current-state only) | `PLATFORM_TREND_ANALYTICS_DEFERRED` | The `has*History === false` flag flips true and a trend card is added | No |
| **Expanded trade market intelligence** (position supply/demand) | Trade OS | Gated behind a flag (`CommissionerTradeReviewV1` / `COMMISSIONER_TRADE_REVIEW_ENABLED`) | `TRADE_POSITION_ANALYTICS_DEFERRED` | Consume `CommissionerTradeReviewV1` in a new card when the flag is enabled | No |
| **Manager playoff outlook / positional strength** | Manager OS | No playoff-probability / roster-position contract on the manager command-center path (lives only in the AI-sim subsystem, out of scope) | documented in `ManagerSupportingViz` header | Add a card once a playoff-probability / position contract is exposed | No |

## Why the layer doesn't need redesigning

The executive layer is built as `Decision OS contract → provider-agnostic view model → visualization`, and
every workspace composes the same shared engine (`ExecutiveVisualizationShell` + the shared chart
primitives). A new capability therefore slots into an existing composition:

1. **New builder** in the relevant `*ViewModel.ts` that reshapes the newly-available contract.
2. **New supporting card** that composes the shared shell + an existing (or one new) shared primitive.
3. **One render line** in the workspace's hub grid.

No existing workspace, primitive, contract boundary, or hub layout changes. This was verified in the
Architecture Review (V4.0, "deferred capability audit — extension points confirmed").

## What "deferred" does *not* mean

- It is **not** a bug or an incomplete workspace — each affected workspace is complete and truthful for the
  data it has today (e.g. Waiver OS shows an impact-ordered sequence; it simply doesn't yet optimize a FAAB
  budget).
- It is **not** presentation debt — the presentation seam already exists.
- It is **not** a customer configuration option — these depend on Decision OS (frozen, shared) gaining the
  contract, which is a platform-roadmap item, not a per-tenant setting.

## Reviewer summary

Fantasy OS ships seven complete, truthful Operating Systems today. Five specific analytical capabilities
are intentionally deferred, each waiting on a future Decision OS contract rather than on any UI work, and
each integrates by *adding* to the existing structure — so a customer can adopt now and receive these
enhancements without a re-implementation or a dashboard redesign.
