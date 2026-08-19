# Fantasy OS — Pilot Execution Kit (Phase V7.0)

**Branch:** `g15-event-foundation` · **Scope:** Fantasy OS (Licensing/B2B). This phase does **not** build
product functionality. It provides the instruments to *run* a real enterprise pilot and the readiness
verification that a pilot environment is deployable — plus an explicit statement of what only the business
team can do.

> **Honesty boundary (read first).** A real pilot's value comes from real customers, real deployments, and
> the real questions/confusion/requests they raise. Those cannot be generated here. This kit therefore
> ships **blank instruments** (partner-selection rubric, observation log, gap-analysis framework, findings
> report) to be **filled in during actual pilots**, plus the **executable readiness checks** that were run
> for real. It contains **no invented pilot partners and no fabricated customer findings** — doing so would
> violate the truthfulness discipline this entire program (V2.0–V6.0) is built on and corrupt the evidence
> base the roadmap depends on. Any log or report in this kit that has empty fields is empty *on purpose*.

Companion documents in this kit:
- `FANTASY_OS_PILOT_OBSERVATION_LOG_TEMPLATE.md` — the per-pilot log (Step 4)
- `FANTASY_OS_PILOT_GAP_ANALYSIS_FRAMEWORK.md` — request categorization + prioritization (Step 5)
- `FANTASY_OS_PILOT_FINDINGS_REPORT_TEMPLATE.md` — the cross-pilot summary (Step 7)

Built on: Enterprise Pilot Guide, Onboarding Guide, Security & Data Boundary Summary, Executive
Demonstration Script, Pilot Success Criteria, Known Capability Boundary Matrix (all Phase V6.0).

---

## 1. Who does what

| Activity | Owner | This kit provides |
| --- | --- | --- |
| Select & contact pilot partners (Step 1) | **Business / BD team** | A fit-scoring **rubric** + archetypes + a blank shortlist table — not named companies |
| Prepare pilot environment (Step 2) | Implementation team | A readiness **checklist** + the automated checks that *can* be run, executed below |
| Run demo sessions (Step 3) | Sales engineer / SA | The V6.0 Executive Demonstration Script |
| Record observations (Step 4) | Session note-taker | The Observation Log template |
| Categorize requests (Step 5) | Product | The Gap Analysis framework |
| Measure success (Step 6) | Product + customer | The V6.0 Pilot Success Criteria |
| Write findings (Step 7) | Product | The Findings Report template |

The engineering deliverable of this phase is everything in the "this kit provides" column. Everything in
the "Owner" column that involves a real customer is the business team's to execute.

## 2. Pilot partner selection — rubric (Step 1)

Do **not** treat this as a list of recommended companies (naming specific real prospects here would be
speculation). Use it to score your own candidate list.

**Target archetypes** (from the brief): fantasy platform providers · commissioner communities · enterprise
fantasy-technology companies · sports-media orgs with fantasy products · white-label software partners.

**Fit-scoring rubric** — score each candidate 1–5 per dimension; shortlist the highest total:

| Dimension | 1 (poor fit) | 5 (ideal fit) |
| --- | --- | --- |
| Executive-analytics need | Runs one league casually | Operates/serves many leagues; needs a portfolio view |
| White-label motivation | Happy with a generic tool | Wants the product under *their* brand |
| Provider footprint | Bespoke/unsupported provider | Uses a supported provider (Sleeper/ESPN/Yahoo/MFL) |
| Decision-maker access | No exec sponsor | Named executive sponsor for the pilot |
| Data availability | Cannot connect real data | Can connect ≥1 real league in a pilot env |
| Reference potential | Unlikely to advocate | Credible future reference / case study |

**Blank shortlist** (fill during Step 1):

| Candidate | Archetype | Fit score (/30) | Exec sponsor | Provider(s) | Why a good fit | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| _(to fill)_ | | | | | | |

Target 3–5 shortlisted partners.

## 3. Pilot-environment readiness (Step 2)

### 3a. Checklist (per pilot)

- [ ] Tenant brand config added (`lib/white-label/tenants.ts`) and **validator passes** (no `error` issues)
- [ ] `NEXT_PUBLIC_TENANT_ID` set to the pilot tenant
- [ ] Hubs render under the pilot brand (title, badge, theme, section visibility)
- [ ] Authentication works (sign-in path reachable; auth-gated content behaves)
- [ ] At least one demo/pilot account with a connected, synced league (for the populated 7-OS walkthrough)
- [ ] Production build succeeds **in CI/Vercel (Linux)** — see 3c
- [ ] Security & Data Boundary Summary shared with the customer's technical reviewer

### 3b. Automated checks — RUN for real (default `allfantasy` tenant, dev server)

| Check | Method | Result (this run) |
| --- | --- | --- |
| White-label branding validates | `tenant-brand-config` suite (`allTenantsDeployable`) | ✅ 18/18 pass |
| Commissioner Hub serves + brand-correct | `GET /commissioner-hub` | ✅ HTTP 200 · `Commissioner Hub \| AllFantasy` |
| Manager Hub serves + brand-correct | `GET /manager-hub` | ✅ HTTP 200 · `Manager Hub \| AllFantasy` |
| Auth gate renders (not a 500) | unauthenticated hub load | ✅ sign-in affordance present on both |
| Executive layer regression intact | `__tests__/executive-viz` + `__tests__/white-label` | ✅ 141/141 (run in V6.0 validation) |

Re-run per pilot with that pilot's `NEXT_PUBLIC_TENANT_ID` to confirm the branded build renders and
validates. Swap the expected titles for the pilot's product name.

### 3c. What must be verified in CI/Vercel (not here)

A local production build is **not** a reliable check on this Windows dev box (known Windows-only
`readlink EISDIR` during `vercel-build`; the branch also carries ~158 pre-existing unrelated typecheck
errors and a broad red e2e tree that are baseline noise, not caused by the licensing layer). **Verify the
production build on Linux/Vercel**, per pilot, before a customer session. Do not claim a green production
build from a local Windows run.

## 4. Running the sessions (Steps 3–4)

- Use the **Executive Demonstration Script** verbatim for structure; one question / one action / one reason
  per Operating System.
- **Do not debate feedback live.** Record it objectively in the Observation Log (one row per observation),
  including verbatim customer wording where useful.
- Capture: questions, points of confusion, feature requests, terminology issues, workflow observations,
  and any deferred capability the customer explicitly asks for.

## 5. After the pilots (Steps 5–7)

1. **Gap Analysis** — categorize every request (Documentation / Configuration / Decision OS Expansion /
   Visualization Enhancement / Out of Scope) using the framework doc. Prioritize **only validated,
   recurring** requests — a single voice is a data point, not a mandate.
2. **Measure success** against the V6.0 Pilot Success Criteria (must-pass 1–6).
3. **Findings Report** — synthesize cross-pilot themes with the template, clearly separating *confirmed
   demand* from *individual preference* from *speculation*.
4. **Updated roadmap** — derive the next Decision OS / configuration / visualization work **from the
   validated, recurring requests only**. This is the one artifact that is intentionally *not* pre-written
   here: it must be authored from real pilot evidence, not invented in advance.

## 6. Boundaries honored

No backend expansion · no Decision OS changes during the pilot · no new Operating Systems · no
provider-specific customization outside approved white-label configuration · no fabricated pilot data.
