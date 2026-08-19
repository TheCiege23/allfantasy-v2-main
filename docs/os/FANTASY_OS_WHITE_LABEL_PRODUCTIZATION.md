# Fantasy OS — White-Label Productization (Phase V5.0)

**Branch:** `g15-event-foundation` · **Track:** A (White-Label Productization) · **Scope:** Fantasy OS
B2B/licensing surfaces only (Commissioner Hub, Manager Hub, and the executive layer they host).

> **What this phase delivers:** the Fantasy OS hubs can now be deployed under a licensee's own brand —
> product name, hub labels, theme (brand color + font), logo reference, optional-section visibility, and
> a licensing tier — from a single **frontend-only, brand-keyed configuration layer** (`lib/white-label/`),
> with a build-time validator that fails a broken brand config before it ships. Selecting a tenant is a
> one-line env change; **no database, no routes, no backend tenancy** were added, and the Phase V4.0
> boundary (executive-viz independent of Decision OS) is preserved and test-enforced.

---

## 1. Why a new layer (and not the existing white-label config)

There is a prior `lib/decision-os/presentation/white-label.ts` (Phase 7.0). It is **not** the right home
for hub branding, for three concrete reasons:

1. **Wrong layer.** It lives in `lib/decision-os/`, which Phase V4.0 certified the executive-viz/hub
   surfaces are *independent of* (they import Decision OS **types** only, never runtime). Importing its
   resolver into the hubs would reintroduce the exact coupling V4.0 certified against.
2. **Wrong key.** It is keyed by **data provider** (`sleeper`/`yahoo`/`espn`) — its "tenant" is the
   fantasy platform *supplying* data. White-label *licensing* is the opposite: keyed by the **licensee
   brand** *deploying* the product.
3. **Wrong surface.** It maps intelligence semantic tokens for embedded SDK/IPM widgets; it has no concept
   of a hub product name, hero copy, logo, or section visibility — the actual rebrand surface.

So `lib/white-label/` is a **sibling** concern, not a replacement. The two can coexist: the SDK path keeps
mapping provider widget tokens; this layer brands the hosted hubs.

## 2. The configuration schema (`lib/white-label/types.ts`)

| Field | Purpose | Replaces (today's hardcoded value) |
| --- | --- | --- |
| `copy.productName` | Platform brand name | `"AllFantasy"` (titles, trust/migration copy) |
| `copy.commissionerHubLabel` | Commissioner workspace label | `"Commissioner Hub"` |
| `copy.managerHubLabel` | Manager workspace label | `"Manager Hub"` |
| `copy.platformScopeLabel` | **Brand-neutral** cross-league scope phrase | `"your entire Fantasy OS footprint"` (the one string rendered *inside* the viz layer) |
| `logo.src` / `logo.alt` | Logo asset (path/data-URI) or wordmark-only | — |
| `theme` | CSS-var overrides (brand color family / accent / font) | app default theme |
| `features` | Per-tenant visibility of optional sections | always-on today |
| `licensingTier` | `starter \| professional \| enterprise` | — |

## 3. Tenant registry (`tenants.ts`) — two real consumers

- **`allfantasy`** (default): **identity theme** — empty overrides, all features on, first-party strings.
  Wiring the hubs to config therefore changes **nothing visible** in production until a different tenant
  is selected.
- **`apex`** (example licensee): a worked second consumer that proves the layer is genuinely multi-tenant —
  its own product name (`Apex Fantasy`), hub labels (`League Command` / `My Teams`), a brand accent
  (`--color-primary`/`--color-accent → #6d28d9`) and font override, and **Migration Center hidden**, so
  feature-gating is exercised end to end rather than only defined.

## 4. Tenant selection (`resolveTenant.ts`) — frontend, env-driven

`resolveTenantBrand()` reads `NEXT_PUBLIC_TENANT_ID` (build/runtime env, inlined by Next — **not** a DB
or route) and returns the matching config, falling back to `allfantasy` for an unset/unknown id (a
misconfigured deploy renders the first-party brand rather than crashing). It is **synchronous and pure**,
so both server components (page metadata) and client components (the hubs) call it at module/render time.

- `tenantThemeStyle(config)` → a style object spread onto each hub's root wrapper. Color vars cascade to
  every descendant Tailwind `var(--color-*)` usage (re-resolved per element, so `brand-primary` etc.
  re-theme correctly); `font-family-base`, when set, is additionally applied as a real `fontFamily` so the
  subtree actually inherits the new face.
- `isFeatureVisible(config, feature)` → gate helper (defaults to visible).

## 5. What is wired

| Surface | File | Brand binding |
| --- | --- | --- |
| Commissioner Hub page title | `app/commissioner-hub/page.tsx` | `${commissionerHubLabel} \| ${productName}` |
| Commissioner Hub badge + trust/migration/import copy | `CommissionerHubPageClient.tsx` | `productName` / `commissionerHubLabel` |
| Commissioner Hub theme + section gates | `CommissionerHubPageClient.tsx` | `tenantThemeStyle` on root; `aiPrompts` + `migrationCenter` gates |
| Manager Hub page title | `app/manager-hub/page.tsx` | `${managerHubLabel} \| ${productName}` |
| Manager Hub badge + theme | `ManagerHubPageClient.tsx` | `managerHubLabel`; `tenantThemeStyle` on root |
| Platform Focus scope + gate | `ManagerCommandCenterSection.tsx` → `PlatformFocus.tsx` | `platformScopeLabel` prop; `showPlatformFocus` gate |

**The executive-viz layer stays pure:** `PlatformFocus` receives `scopeLabel` as a **prop** from the hub —
it does not import the brand config. The previously-hardcoded `"...your entire Fantasy OS footprint"` is
gone, replaced by a brand-neutral default that a tenant can override. This is asserted by test.

## 6. Branded-deployment validation (`validateTenant.ts`)

`validateAllTenants()` runs pure checks a licensee build can gate on:

- **Errors** (block deploy): missing brand strings, invalid tier, malformed logo, and the hard invariant —
  the Platform Focus **scope label must be brand- and provider-neutral** (no product name, no
  `sleeper/espn/yahoo/...`), which protects the viz layer's brand-neutrality.
- **Warnings** (allowed): an unknown/empty theme variable (a likely typo that would silently no-op),
  checked against the `THEMEABLE_CSS_VARS` allowlist.

The test suite asserts every registered tenant returns **zero errors** (`allTenantsDeployable() === true`).

## 7. Onboarding a new licensee — checklist

1. Add a `TenantBrandConfig` to `TENANT_REGISTRY` with a lowercase `tenantId`.
2. Set `copy.*` (keep `platformScopeLabel` brand-neutral), `logo`, `licensingTier`.
3. Add `theme` overrides using only `THEMEABLE_CSS_VARS` keys (brand color family / accent / font).
4. Set `features` for any sections the licensee should not see.
5. Run the tenant validator (`allTenantsDeployable()` / the V5.0 test) — resolve all **errors**.
6. Deploy with `NEXT_PUBLIC_TENANT_ID=<tenantId>`.

## 8. Boundaries & deferrals (honest scope)

- **Frontend-only, by request:** no DB tenancy, no per-tenant routes, no backend brand store. A future
  hosted-tenancy backend is out of scope and unbuilt.
- **Scoped to the licensing surfaces:** the broader consumer/B2C app (landing, legal, email) is
  deliberately untouched — Legacy/B2C remains out of scope for this OS suite.
- **Logo rendering** is modeled (`logo.src`/wordmark fallback + `tenantLogoAlt`) but the hubs currently
  render a wordmark; wiring an `<img>` is a one-line addition per hub when a licensee supplies an asset.
- **Runtime tenant switching / per-request tenancy** is not supported (tenant is fixed per deployment).

## 9. Verification

- Tests: `__tests__/white-label/tenant-brand-config.test.ts` (resolution/fallback, identity default,
  multi-tenancy, theming, feature gating, validator, and two architecture invariants) — all green,
  alongside the executive-viz and manager-command-center suites (behavior preserved).
- Typecheck: baseline preserved; zero errors in the touched files.
