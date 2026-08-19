# Fantasy OS — Demo Truth Model, Copy & Freshness Standard (Phase V8.5)

**Branch:** `g15-event-foundation` · **Scope:** customer-facing executive experience. No Decision OS
change, no backend tenancy.

> One shared, customer-facing vocabulary so the executive UI never confuses the viewer about **what data
> they are looking at** or **how fresh it is** — implemented in `lib/fantasy-os/demoTruthModel.ts` and
> rendered by `components/fantasy-os/DemoStateBadge.tsx`.

---

## 1. The state model (Part 2)

| State | Label (canonical) | isLive | Meaning |
| --- | --- | --- | --- |
| `live-connected` | **Live** | ✅ | The user's real, authorized, currently-synced data |
| `presentation-preview` | **Preview** | ❌ | Presentation-safe preview — not the user's leagues |
| `engineering-smoke` | **Sample (internal)** | ❌ | Internal validation sample — never shown as a user portfolio |
| `partial-evidence` | **Partial history** | ❌ | Real but incomplete (missing history/categories) |
| `stale-evidence` | **Needs sync** | ❌ | Real but not recently synchronized |
| `unavailable-evidence` | **Data unavailable** | ❌ | A contract the source doesn't expose — **not zero** |
| `empty-healthy` | **No action required** | ❌ | A real, complete, legitimately-empty result |
| `sync-failure` | **Sync failed** | ❌ | The last synchronization attempt did not complete |

### The three load-bearing invariants (test-enforced)

1. **Preview is never live** — `isLive` is `true` only for `live-connected` (verified for all 8 states).
2. **Unavailable ≠ zero** — `Data unavailable` is a distinct state with its own copy, never rendered as 0
   or as `No action required`.
3. **Engineering smoke is never a user portfolio** — its label is explicitly marked "internal".

## 2. Copy standard (Part 12)

Each state has exactly **one** canonical term (no synonyms; test-enforced uniqueness). The standardized
executive vocabulary: **Live · Preview · Partial history · Data unavailable · No action required · Needs
sync · Sync failed · Connect a league to activate**. Rules: provider-neutral, evidence-based, concise,
actionable only where action is justified, and free of internal architecture terminology (no "Decision
OS", "resolver", "evidence port", "corpus" on any customer surface — verified absent from rendered
`/fantasy-os`).

## 3. Freshness & coverage standard (Part 13)

Freshness is derived **only** from a real snapshot timestamp (`generatedAt`, which the manager/commissioner
snapshots already carry):

- `formatFreshness(generatedAt)` → human-readable ("Updated 30 min ago", "Updated 2 days ago"); returns
  **null** when there is no real timestamp — the UI then says freshness is unavailable, **never invents
  one**.
- `isStale(generatedAt)` → true past a 24h threshold → the `stale-evidence` / "Needs sync" state.
- `DemoStateBadge` shows the freshness string next to the state only when it is real; it is omitted when
  null. Exact timestamps belong in accessible details/diagnostics, not the executive headline.

## 4. Rendering (`DemoStateBadge`)

Provider-neutral, white-label-safe (tones route through `status-*` semantic tokens, so brand themes and
light/dark are honored), accessible (`aria-label` carries "{label}. {description}"; colour is never the
only signal — the label text carries meaning; the dot is `aria-hidden`).

## 5. Where it is wired

The `/fantasy-os` gateway's demonstration section now renders the canonical badges: a **Preview** badge on
the preview path and a **Live** badge on the connected-account path — which correctly degrades to **Data
unavailable** (not "Live") when no leagues are connected (verified live and by test). This directly serves
the success condition: a user can tell live from preview at a glance, and unavailable from empty.

## 6. Verification

`__tests__/fantasy-os-demo-truth-model.test.ts` (11) — the three invariants, canonical-label uniqueness,
freshness/staleness formatting, conservative entry-state resolution. Gateway tests assert the badges render
and that the preview affordance is never labeled live, and that a no-league account shows Data unavailable.
Live `/fantasy-os` render confirmed the canonical labels and the absence of implementation terminology.
