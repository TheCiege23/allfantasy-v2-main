# Manager Intelligence

Owns behavioral pattern analysis only — participation, reliability, risk,
engagement trend, recognition. Never fantasy strategy,
player evaluation, or message content.

## Scope

Built the Manager Directory — the module's landing surface — with each
manager's tenure, engagement trend, reliability trait, and
Recognition/Risk callouts. Individual manager profile pages (the full
four-tab depth from the blueprint: Overview/Behavior/Trends &
History/Guidance) and the League Relationship Graph are deferred; the
directory is the complete, working entry point everything else attaches
to later.

## Privacy & Trust, enforced in code, not just documentation

- **No single collapsed "manager score."** Reliability renders as one
  specific, labeled trait (`Reliability: 96`), never an overall grade —
  tested explicitly (`commissioner-os-manager-intelligence.test.tsx`).
- **Recognition and Risk carry equal structural weight.** Neither is
  conditionally hidden behind the other; the demo data deliberately
  includes both, and a test asserts both appear.
- **No message content anywhere** — `riskFlag`/`recognition` are always
  pattern summaries, never quotes or paraphrases of anything a manager
  actually said.
- **No archetype or identity label, of any tone.** Milestone 32 shows a
  characterisation label of a named manager to nobody, commissioners
  included, so the directory carries facts and continuity signals only.
  The DNA classifier's `primaryIdentity` is deliberately not read.

## Data

`lib/commissioner-os/managers/decision-os-client/` — stub, demo (same
"Iron Horse Dynasty" league as Mission Control and League Health), and an
honest live placeholder. `app/commissioner-os/managers/page.tsx` no longer
calls `getManagerIntelligenceClient()` directly — it consumes
`adapter.managers` from the [Decision OS Adapter Layer](../../../lib/commissioner-os/adapter/README.md),
which resolves Demo Mode once and normalizes the response before this
module's view ever sees it. The client files themselves — and this
module's ownership of their fixtures — are unchanged.
