# Help & Knowledge Center — Blueprint

**Status: PROPOSED, awaiting approval. No code has been written against this
document.** Authored to close the architecture gap repository discovery
found on 2026-07-03 (see `lib/commissioner-os/platform/serviceRegistry.ts`'s
own `hasDedicatedBlueprint: false` annotation, and that same phase's
Discovery Report for the full checkpoint-by-checkpoint findings). Written
to the same constraints as the ten already-implemented modules — it
extends the existing Canon, it does not invent a new one.

---

## 1. Purpose and ownership

Help & Knowledge Center is Commissioner OS's single owner of **explanatory
content**: what things mean, how workflows work, and how to get from "I
don't understand this" to "here's the concept, and here's where to act on
it." It owns:

- Documentation hub (the browsable home for all of the below)
- Contextual help (short, targeted explanations of a specific concept)
- Operational guides (multi-step "how this workflow works" narratives)
- Glossary (term → definition)
- Onboarding resources (a first-run oriented subset of guides)
- Support articles (troubleshooting-flavored content)
- Feature documentation (what a given module is for for)
- Cross-module help links (a guide referencing the modules it's about)

It explicitly does **not** own — and this is the boundary every other
module's own README already draws for itself, restated here for Help
Center's side of it:

- **Business intelligence.** No score, no risk, no recommendation, no
  automation health, no KPI. If a number needs computing, it belongs to
  the module that computes it, and Help Center links to that module
  rather than restating or explaining its output as if it owned it.
- **Module data of any kind.** A glossary entry for "League Health Score"
  explains the *concept* in prose; it never renders a live score, a real
  risk list, or any other module's actual data inline. That would be the
  same "two independently maintained implementations answering the same
  question" duplication the Recommendations-deletion and
  Activity-Stream-deletion precedents in this program already rejected.
- **Operational events.** Publishing or editing a help article is not a
  "meaningful cross-module event" in Activity Stream's sense, and reading
  one is not something Notification Center tracks. See §7.

## 2. Reachability pattern

Two real precedents exist in this program, and they disagree on purpose:

| Pattern | Precedent | Shape |
|---|---|---|
| Header-triggered overlay, no `CommissionerModuleId` | Search, Notifications | Transient, in-and-out, no deep browsing |
| Real routed module, real `CommissionerModuleId`, sidebar entry | Activity Stream | A destination with enough content to warrant its own page and browsing UI |

Help Center's actual content — a glossary, a catalog of guides and
articles, organized by category — is a browsing job, not a quick in-and-out
job. A command-palette-style overlay is the wrong shape for "read a
multi-paragraph operational guide." **Recommendation: the real-routed-module
pattern, following Activity Stream's precedent, not Search/Notifications'.**

Concretely:
- `'help'` becomes a new, real `CommissionerModuleId` (see §4).
- `/commissioner-os/help` is a real page, added to
  `COMMISSIONER_SECONDARY_NAV_ITEMS` in `lib/commissioner-os/navigation/moduleNav.ts`
  (alongside Activity Stream — a secondary, always-available destination,
  not a primary daily-decision surface like League Health or Workspace).
- The header gets a small icon-button affordance (`HelpCircle` from
  `lucide-react`, next to Search/Notifications/Profile in
  `CommissionerHeader.tsx`) — but unlike Search's and Notifications'
  buttons, **it is a plain navigation link to `/commissioner-os/help`, not
  an `openService(...)` call.** Help Center does not join
  `CommissionerPlatformProvider`'s `openServiceId` overlay state machine at
  all — there is no overlay to open. This is a deliberate, explicit
  divergence from the Search/Notifications header-button shape and should
  not be "corrected" back to `openService` later.
- "Contextual help" is satisfied by other modules optionally linking *out*
  to a specific `/commissioner-os/help` article via the existing
  `CommissionerRelatedLink` contract (§4) — the same one-way,
  link-not-merge pattern every other cross-module reference in this
  program already uses. No new contextual-popover mechanism is introduced.
  Retrofitting existing modules with these links is explicitly **out of
  scope for the initial implementation** (see §10) — a future, separate,
  additive ticket per module, not a blocker for Help Center's own launch.

## 3. Content model

Two content types, deliberately not one — an article and a glossary term
answer different shaped questions ("how does X work" vs. "what does X
mean") and forcing them into one shape would blur that the way merging
Notifications and Activity Stream would have.

**Help Article** — an operational guide, onboarding resource, support
article, or feature explainer:
- `id`, `slug` (for in-page deep-linking within the SPA state, not a Next.js
  dynamic route — see §9), `title`, `category`, `summary` (for card/list
  display), `body` (the full text), `relatedModuleIds` (zero or more real
  modules this article is *about*), `relatedLinks` (optional, reuses
  `CommissionerRelatedLink` for "jump to the real thing"), `updatedAt`.

**Glossary Term** — a single concept definition:
- `id`, `term`, `definition`, `relatedModuleIds` (optional).

Categories (`CommissionerHelpCategory`): `'getting-started' |
'workflows' | 'glossary' | 'troubleshooting' | 'module-guide'`. Five,
matching the ownership list in §1 without one category per bullet (glossary
terms live outside the article category set entirely, as their own
content type, not a category of article).

Authored, not computed — like every other module's *fixture* data (League
Health's demo risks, Automation's demo catalog), Help content is hand-written
prose describing this **real, already-implemented** Commissioner OS, not
placeholder lorem ipsum. Demo content should cover the workflows and terms
introduced across Mission Control, League Health, Recommendations,
Manager Intelligence, Workspace, Automation Center, League Analytics,
Reports, Search, Notification Center, and Activity Stream — the eleven
modules/services that exist today. Content authoring is real
implementation work in its own right, not an afterthought.

## 4. Contract shape

Proposed additions to `lib/commissioner-os/contracts/` — a new
`help.ts`, following the exact shape/doc-comment conventions of
`activity.ts` and `notifications.ts`:

```ts
// lib/commissioner-os/contracts/help.ts
import type { CommissionerModuleId } from './navigation'
import type { CommissionerRelatedLink } from './relatedLink'

export type CommissionerHelpCategory =
  | 'getting-started'
  | 'workflows'
  | 'glossary'
  | 'troubleshooting'
  | 'module-guide'

export interface CommissionerHelpArticleContract {
  id: string
  slug: string
  title: string
  category: CommissionerHelpCategory
  summary: string
  body: string
  relatedModuleIds?: CommissionerModuleId[]
  relatedLinks?: CommissionerRelatedLink[]
  updatedAt: string
}

export interface CommissionerGlossaryTermContract {
  id: string
  term: string
  definition: string
  relatedModuleIds?: CommissionerModuleId[]
}
```

Client interface (`lib/commissioner-os/help/decision-os-client/types.ts`,
once approved):

```ts
export interface HelpClient {
  getArticles(): Promise<CommissionerPlatformResponse<CommissionerHelpArticleContract[]>>
  getGlossary(): Promise<CommissionerPlatformResponse<CommissionerGlossaryTermContract[]>>
}
```

Two flat list-getters — no `getSummary()` (see §8 for why Mission Control
needs none) — the same "just the real list, the page slices what it needs"
shape Activity Stream and Recommendations already established, applied to
two content types instead of one event type.

**No `CommissionerErrorAttributableId` widening needed.** `errors.ts`'s own
comment currently predicts "Activity Stream and Help Center get the same
one-line addition when their own phase actually needs it" — that
prediction turned out **wrong for Activity Stream** (`'activity'` was
already a real `CommissionerModuleId`, so no widening was needed), and the
same reasoning applies here: since §2 makes `'help'` a real
`CommissionerModuleId`, `wrapMethod`'s `moduleId` argument for Help
Center's adapter methods is passed as a plain `CommissionerModuleId`, not a
platform-service string. Correcting that stale comment is in-scope
implementation cleanup once approved, not a blocker now.

## 5. Stub/Demo/Live expectations

Kept for conformance with every other module's pattern, even though Help
content's nature (authored, not per-user/per-league business data) makes
the three tiers less naturally distinct than, say, League Health's:

- **Stub**: one minimal article, one minimal glossary term — proves the
  shape, matches every other module's stub convention.
- **Demo**: the real, elaborate authored catalog described in §3 — this is
  the tier that actually matters, since there is no separate "richer
  fictional scenario" the way League Health's demo score differs from its
  stub score. Demo *is* the realistic content here.
- **Live**: an honest `upstream_unavailable` placeholder, identical in
  shape to every other module's `live.ts` — **deliberately not** "the demo
  content, served unconditionally as if live," even though that would
  technically always succeed. Keeping `live` meaning "the real backend
  isn't wired up yet" uniformly across all twelve namespaces preserves a
  single, consistent meaning for what `source: 'live'` promises the rest
  of the platform. A real future backend (flat files bundled at build
  time, or a CMS if non-engineers need to author content without a
  deploy) is a decision for that later phase, not this blueprint.

## 6. Relationship to Settings

`app/commissioner-os/settings/page.tsx` already exists as a placeholder
with an undefined real scope. The boundary: **Settings owns configuration**
(toggles, thresholds, preferences — "how do I configure X"); **Help Center
owns explanation** ("what does X mean, how does the workflow work"). A
Settings screen may link *out* to a relevant Help article for elaboration
(a one-way `CommissionerRelatedLink`, same as any other module), but
Settings never embeds explanatory prose itself, and Help Center never
renders or mutates a configuration value. No shared ownership, no shared
contract.

## 7. Relationship to Search, Notifications, and Activity Stream

- **Search**: indexes Help articles as one more source, the same way its
  demo/live composition already reaches into Recommendations, Managers,
  Workspace, Automations, and Reports' own demo clients today.
  `CommissionerSearchResultCategory` gets one additive new member —
  `'help'` — and `getSearchClient()`'s demo composition adds one more
  `await getHelpClient().getArticles()` call, mapping each article to a
  `CommissionerSearchResultContract` with `sourceModuleId: 'help'`. The
  direction is Search reaching into Help, never the reverse — Help Center
  has no dependency on Search at all.
- **Notifications**: no relationship. Publishing, editing, or reading help
  content never generates a notification, and Notification Center never
  renders help content. A "new article available" notification is a
  plausible future idea but is explicitly **not** part of this blueprint —
  it would need its own separate approval, the same way Notification
  Center's own scope was gated phase-by-phase.
- **Activity Stream**: no relationship, for the same reason League
  Health's own tier changes are logged there but Help content changes are
  not — Activity Stream's remit is *meaningful operational events*
  (a risk detected, a task completed, an automation run). Documentation
  authorship isn't an operational event about the league; it's reference
  material about the product. No `CommissionerActivityEventContract`
  should ever carry `sourceModuleId: 'help'`.

## 8. Mission Control consumption rule

**Entry point only, no summary, no adapter call from Mission Control at
all.** This mirrors Search's "consumes search entry points only" pattern,
not Notifications'/Reports'/Analytics'/Automation's `getSummary()` +
`SummaryCard` pattern — deliberately, because unlike unread-notification
counts or ready-report counts, there is no count intrinsic to help content
that's meaningful on a daily operational dashboard. "3 unread articles"
isn't a commissioner decision signal the way "2 critical risks" is, and
inventing one just to justify a `SummaryCard` would be exactly the kind of
manufactured metric the Decision Ownership Matrix's own discipline exists
to prevent.

The header's persistent `HelpCircle` icon (present on every Commissioner
OS page, including Mission Control, once §2 lands) already satisfies
"Mission Control consumes help entry points only" for free — the same way
Search's header button satisfies its own identical requirement today,
with zero Mission-Control-specific code. No `SummaryCard`, no
`adapter.help.getSummary()` method should be built.

## 9. Required UI surfaces

- **`/commissioner-os/help` main page**: category-grouped browse view
  (reusing the tablist pattern Activity Stream/Workspace/Recommendations
  already established — `role="tablist"`), a glossary section, and a
  local text filter across title/summary (in-page filtering, distinct
  from the global ⌘K palette — both should work, doing different jobs).
- **Article detail**: selecting an article expands/reveals its full body
  **in place, via client component state** — not a Next.js dynamic route
  (`/commissioner-os/help/[slug]`). Every module built so far in this
  entire program (12 routes) uses only static routes; drill-down is
  always handled by client state or a Dialog, never a dynamic segment.
  Introducing this program's first `[param]` route for Help Center alone
  would be a bigger structural change than the content justifies — the
  `slug` field exists for anchor/deep-link purposes within that client
  state, not for routing.
- **Header affordance**: `HelpCircle` icon button, plain link to
  `/commissioner-os/help` (§2).
- **Sidebar entry**: added to `COMMISSIONER_SECONDARY_NAV_ITEMS`.
- Empty/loading/error states reuse the exact existing components
  (`EmptyState`, `LoadingState`, `ErrorState`, `PreviewDataBanner`) every
  other module already uses — no new state components.
- Explicitly **out of scope for initial implementation**: retrofitting
  other modules with outbound contextual-help links, and any dynamic
  routing.

## 10. Implementation acceptance criteria

Once approved, Phase 1.11 implementation is complete when, mirroring
every prior phase's own bar:

1. `lib/commissioner-os/contracts/help.ts` added, exported from
   `contracts/index.ts`.
2. `'help'` added to `CommissionerModuleId`
   (`lib/commissioner-os/navigation/moduleNav.ts`), with a nav entry in
   `COMMISSIONER_SECONDARY_NAV_ITEMS` and an icon in `MODULE_ICONS`.
3. `lib/commissioner-os/help/decision-os-client/{types,stub,demo,live,index}.ts`
   built to the established pattern; demo content is real, authored
   material covering all ten existing modules (§3), not placeholder text.
4. Adapter extended with a 12th `help` namespace
   (`lib/commissioner-os/adapter/{types,index}.ts`) — plain
   `CommissionerModuleId`, no `CommissionerErrorAttributableId` change.
5. `app/commissioner-os/help/page.tsx` + `loading.tsx` built; header gets
   the `HelpCircle` link (§2, §9).
6. Search's own demo/live composition extended with the `'help'` source
   (§7) — a small, additive change to Search's existing client, owned by
   Search, not by Help Center.
7. Zero Mission Control changes beyond the shared header being present
   (§8) — no adapter call, no summary method, no `SummaryCard`.
8. Full typecheck, Commissioner OS test suite, accessibility, browser, and
   mobile verification — the same bar every prior phase met.
9. Documentation: `components/commissioner-os/help/README.md`, plus the
   established cross-reference updates to `adapter/README.md` (12th
   namespace), `platform/README.md` (closing the gap this blueprint
   fixes), and `search/README.md` (new source).
10. A Session Completion Report with the same seven sections every prior
    phase has delivered.

---

## Decision Ownership entry

*(No standalone Decision Ownership Matrix document exists as a repo file
today — every reference to it in this codebase is self-referential, per
the 2026-07-03 discovery. This entry is written ready to be transplanted
into one if/when it's created as its own artifact.)*

| Field | Value |
|---|---|
| Module | Help & Knowledge Center |
| Module id | `help` |
| Owns | Documentation hub, contextual help, operational guides, glossary, onboarding resources, support articles, feature documentation, cross-module help links |
| Does not own | Business intelligence, any module's operational data, notifications, activity events, configuration (Settings') |
| Consumes | Nothing from other modules' data — only static authored content |
| Consumed by | Search (indexes articles, §7); Mission Control (header entry point only, §8); any module may optionally link out (§2, future work) |
| Must never consume | League Health / Recommendations / Managers / Workspace / Automations / Analytics / Reports / Notifications / Activity Stream internal data |
| Reachability | Real routed module (`/commissioner-os/help`), sidebar + header link — not an `openServiceId` overlay (§2) |

## Platform contract proposal

See §4 in full above — `CommissionerHelpCategory`,
`CommissionerHelpArticleContract`, `CommissionerGlossaryTermContract`,
and `HelpClient`, proposed for `lib/commissioner-os/contracts/help.ts`
and `lib/commissioner-os/help/decision-os-client/types.ts` respectively.

## Implementation guidance

Follow §10 in order. The sequencing that's worked for every prior phase
applies unchanged: contracts → decision-os-client (stub/demo/live) →
adapter namespace → UI → route wiring → Search's small additive extension
→ tests → typecheck → accessibility/browser/mobile verification → docs →
Session Completion Report. The one net-new piece of *work*, not just
*pattern-following*, is authoring real, accurate help content for ten
existing modules — budget real effort for that, it is the actual product
value of this module, not boilerplate.

## Go/no-go recommendation

**Go, contingent on your approval of this document.** All five open
architecture questions raised in the 2026-07-03 Discovery Report are
resolved above with a specific, precedent-grounded answer (reachability →
§2; content shape → §3–4; content source and stub/demo/live meaning → §5;
cross-module link mechanism → §2, §4; Settings boundary → §6). Nothing
here requires inventing a pattern this program hasn't already used
elsewhere — every decision either reuses an existing mechanism directly
(evidence links, tablist filtering, the three-tier client pattern) or
picks between two patterns this program has already built (Activity
Stream's routed-module shape over Search/Notifications' overlay shape,
and Search's zero-footprint Mission Control shape over the
summary-card modules' shape), with the reasoning for each choice stated
inline. I have not implemented anything against it. On your approval,
Phase 1.11 can proceed directly using §10 as its task list.
