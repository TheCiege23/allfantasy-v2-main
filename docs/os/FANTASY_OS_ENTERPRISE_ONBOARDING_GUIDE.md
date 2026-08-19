# Fantasy OS — Enterprise Onboarding Guide (Phase V6.0)

**Audience:** the customer's implementation / platform team. **Purpose:** how to *deploy and configure*
Fantasy OS under your own brand — not how it is built internally. For the security posture, see the
Security & Data Boundary Summary; for the demo flow, see the Enterprise Pilot Guide.

---

## 1. Prerequisites

- A deployment target that runs a Next.js (App Router) application (Node 20+).
- Provider access for the leagues you intend to connect (Sleeper, ESPN, Yahoo, MFL — the currently
  supported import providers).
- A database connection string for the environment (the application's existing data layer; the pilot can
  run against a dedicated non-production database — see §3).
- Your brand assets: product name, hub labels, brand color(s), optional font, optional logo.

## 2. Provider connection process

1. From the hub, choose **Import League** (Migration Center) and select the provider.
2. Authenticate/associate the league per the provider's flow.
3. The platform imports and synchronizes league, roster, draft, and scoring data behind a
   **provider-agnostic** internal model — downstream, the executive layer never sees provider specifics.
4. Repeat per league. A commissioner or manager can connect multiple leagues; every connected league
   becomes visible across the relevant Operating Systems.

Supported import providers today: **Sleeper, ESPN, Yahoo, MFL.** Provider terminology appears only on
connection/sync/admin surfaces — never on the executive dashboards.

## 3. Deployment options

- **Shared environment:** deploy the application with the customer's brand tenant selected. Suitable for
  guided pilots.
- **Dedicated pilot environment:** deploy against a dedicated (non-production) database so pilot data is
  isolated. This mirrors the Phase E proof setup (a separate database project used for live validation)
  and is the recommended posture for a customer pilot with real data.
- **Runtime model:** the executive layer performs no direct data fetching or persistence itself; it
  renders from Decision OS snapshots (see the Security & Data Boundary Summary). Standard app-server
  scaling applies; there is no separate analytics service to operate.

## 4. Branding configuration (white-label)

Branding is a **frontend-only** configuration (no backend tenancy). Full reference:
`FANTASY_OS_WHITE_LABEL_PRODUCTIZATION.md`.

1. Add a tenant to `lib/white-label/tenants.ts` (`TENANT_REGISTRY`) with a lowercase `tenantId`:
   - `copy`: product name, commissioner/manager hub labels, and a **brand-neutral** platform scope
     phrase.
   - `logo`: an asset path/data-URI, or `null` for a wordmark.
   - `theme`: CSS-variable overrides — brand color family (`color-primary`, `color-accent`, …), and an
     optional `font-family-base`. Only allowlisted variables are honored.
   - `features`: hide any optional sections the deployment should not show (e.g. Migration Center, AI
     Prompts, Platform Focus).
   - `licensingTier`: `starter | professional | enterprise`.
2. Run the **branded-deployment validator** (`allTenantsDeployable()` / the V5.0 test). Resolve every
   `error`; warnings (e.g. an unknown theme variable) are advisory.
3. Deploy with `NEXT_PUBLIC_TENANT_ID=<tenantId>`. The default (`allfantasy`) is an identity theme, so an
   unset value renders the first-party appearance rather than failing.

## 5. Supported customization

| Customizable | How |
| --- | --- |
| Product name & hub labels | `copy.*` |
| Brand colors | `theme` (`color-primary`, `color-accent`, brand color family) |
| Typography | `theme['font-family-base']` |
| Logo | `logo.src` (asset/data-URI) — wordmark fallback today; `<img>` wiring is a one-line per-hub add |
| Section visibility | `features` (Migration Center, AI Prompts, Platform Focus) |
| Light / dark theme | Inherited from the app's theme system automatically |

## 6. Operational boundaries (what is intentionally out of scope)

- **No per-request / runtime tenant switching** — a deployment serves one brand tenant (env-selected).
- **No backend brand store, per-tenant routes, or hosted multi-tenancy** — branding is static frontend
  config by design.
- **No changes to the intelligence engine** are required or supported as part of onboarding — Decision OS
  is frozen and shared.
- **The consumer/B2C surfaces** (marketing, legal, email) are outside the licensed Fantasy OS surface and
  are not part of white-label configuration.

## 7. Decision OS overview (internal only — do not share externally)

> This section is background for the implementation team, not customer-facing material.

Decision OS is the shared, provider-agnostic intelligence engine. It ingests synchronized league data and
produces **snapshots** (league health, league analytics, manager command center, recommendations by
category). The executive layer consumes these snapshots as **types only** and renders them — it holds no
business logic and makes no data calls itself. This separation is certified (V4.0): the presentation layer
is independent of and one-directionally dependent on Decision OS, so the engine can evolve without
redesigning any dashboard. Customers deploy and brand the presentation; they do not modify the engine.

## 8. Onboarding acceptance

Onboarding is complete when, without engineering intervention:
1. The hubs render under the customer's brand (validator passes).
2. At least one provider league is connected and synchronized.
3. All seven Operating Systems render populated for the connected account.
4. The Pilot Success Criteria (separate doc) can be observed.
