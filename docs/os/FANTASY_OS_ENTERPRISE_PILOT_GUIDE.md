# Fantasy OS — Enterprise Pilot Guide (Phase V6.0)

**Branch:** `g15-event-foundation` · **Scope:** Fantasy OS (Licensing/B2B). This is a pilot-packaging
phase — no new features, no backend, no Decision OS changes. It prepares the *already-built* product for
structured enterprise demonstrations and pilots.

> **Purpose:** give a sales engineer / solution architect everything needed to take a prospective
> enterprise customer from first introduction through a guided pilot, and to know exactly what the
> product does and does not do today. Companion documents: Onboarding Guide, Security & Data Boundary
> Summary, Executive Demonstration Script, Pilot Success Criteria, Known Capability Boundary Matrix.

---

## 1. What Fantasy OS is (the one-paragraph framing)

Fantasy OS is a white-label **executive analytics and decision layer** for fantasy-sports operators. It
turns the data a customer already has — across whichever providers their users connect — into seven
role-specific **Operating Systems**, each a calm, executive dashboard that answers one decision question
and recommends one next action. It is provider-agnostic (no provider branding on the executive surface),
deployable under the customer's own brand, and built so its intelligence engine (Decision OS) and its
presentation layer are cleanly separated and independently certified (see the Architecture Review, V4.0).

## 2. The prospect journey (Step 1 audit)

Mapped against the real product surfaces. Each stage cites where it happens today.

| # | Stage | Where it happens today | State |
| --- | --- | --- | --- |
| 1 | **Initial introduction** | `/commissioner-hub` hero (brandable copy) + this guide | ✅ Ready |
| 2 | **Branding applied** | `NEXT_PUBLIC_TENANT_ID` → `lib/white-label/` (product name, hub labels, theme, logo, feature visibility) | ✅ Ready (V5.0) |
| 3 | **Data connection** | Provider connect/import flows (Sleeper/ESPN/Yahoo/MFL) → `/import` | ✅ Ready |
| 4 | **First executive dashboard** | `/commissioner-hub` (League Health Map) — works on preview data with no account | ✅ Ready |
| 5 | **Operating System exploration** | 7 workspaces across `/commissioner-hub` (Commissioner/League/Trade) + `/manager-hub` (Manager/Waiver/Draft/Platform) | ✅ Ready (needs connected account for the manager-side four — see §3) |
| 6 | **Decision workflow** | Each workspace surfaces one recommendation with a clear home (V3.1 one-home-per-recommendation) | ✅ Ready |
| 7 | **Value realization** | Executive can read season/league/market state in ~10s and act | ✅ Ready |

### Friction points found (no features added — these are honest observations, not blockers)

1. **Manager-side workspaces need a connected account to show populated data** (§3). This is by design
   (no fabricated sample data), so the mitigation is a demo account, not a code change.
2. **Two hub entry points** (`/commissioner-hub`, `/manager-hub`) — intentional (commissioner vs manager
   personas). The Demonstration Script sequences them so the split reads as deliberate, not disjoint.
3. **Logo is currently a wordmark** (product name) — `lib/white-label/` models a logo asset slot; wiring
   an `<img>` is a one-line per-hub addition when a customer supplies an asset (documented in Onboarding).

No verified journey blocker was found that warrants a code change in this phase.

## 3. Demo dataset strategy (Step 2)

**Decision: use a curated real authenticated demo account. Do not build synthetic demo data.**

Rationale, grounded in the codebase:

- **The Commissioner Hub already has a built-in "presentation-safe preview"** (`showDemoMode` in
  `CommissionerHubPageClient.tsx`) that populates the commissioner operational sections
  (multi-league overview, health dashboard, showcase) with stable preview data when no leagues are
  connected. This is enough for a **no-login first-impression / branding demo**.
- **The seven flagship Executive Analytics Workspaces are driven by live snapshots** (the
  `league-analytics` and `manager-command-center` reads, and health snapshots) that intentionally return
  **honest empty/"not available" states** — never fabricated sample data — when no account is connected
  (a deliberate V2.x truthfulness rule, e.g. Platform Focus states "no sample data is shown in its
  place"). So a *populated* seven-OS walkthrough needs real connected data.
- **That real data already exists, demo-ready:** the Phase E live-Sleeper proof account (Neon project
  `cool-lab-87438174`) is a real authenticated account with connected leagues, validated end to end with
  zero defects and explicitly marked customer-demo ready.

**Therefore the pilot demo dataset is:**

| Demo path | Use for | Data source | Login? |
| --- | --- | --- | --- |
| **A — Branding / first impression** | Stages 1–4, brand review | Commissioner Hub presentation-safe preview (built-in) | No |
| **B — Full seven-OS walkthrough** | Stages 5–7, decision workflow | Phase E real demo account with connected leagues | Yes |

This keeps demo data **provider-agnostic on the executive surface** (the account happens to use Sleeper,
but no provider string renders — verified V4.0/V5.0), **clearly distinct from a customer's own live
data**, and adds **zero backend complexity** (it reuses an account and infrastructure that already
exist). Building fake per-workspace demo data was explicitly rejected: it would violate the truthfulness
guarantees the product is certified on and add a maintenance surface with no customer value.

## 4. How a pilot is structured

1. **Introduce** (this guide + hero): what Fantasy OS is and the seven-OS model.
2. **Brand it** (Onboarding Guide): set `NEXT_PUBLIC_TENANT_ID` to the customer's tenant; show the hubs
   under their name/theme. Validate with the branded-deployment validator (V5.0).
3. **Connect** (Onboarding Guide): connect the customer's provider(s) in a pilot environment, or use
   demo path B.
4. **Walk the seven OSes** (Demonstration Script): one executive question + one recommendation each.
5. **Evaluate** (Pilot Success Criteria): observe the defined, non-invented criteria during the pilot.
6. **Scope forward** (Known Capability Boundary Matrix): show what is intentionally deferred and how each
   deferred capability lights up later without redesigning the executive layer.

## 5. Boundaries honored in this phase

No backend expansion · no Decision OS changes · no new Operating Systems · no provider-specific UI · no
Legacy/B2C work. This phase is documentation + a verified-only validation pass; it did not add features.
