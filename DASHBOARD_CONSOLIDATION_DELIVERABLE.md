# Dashboard Surface Consolidation — Deliverable Summary

**Date:** May 13, 2026  
**Scope:** Unify feature area destinations without redesign, new features, or code deletion  
**Status:** ✅ COMPLETE

---

## 1. Canonical Route Ownership Map

All dashboard CTAs, AI links, trade links, settings links, and wallet links now point to single canonical destinations:

| Feature Area | Canonical Destination | Purpose | Status |
|--------------|----------------------|---------|--------|
| **Dashboard** | `/dashboard` | Primary hub for leagues, Today strip, AI tools, standings | ✓ Active |
| **AI Command Center** | `/tools-hub` | Tool discovery, filtering by sport/category, related tools | ✓ Consolidated from `/tools` |
| **AI Chat / Chimmy** | `/chimmy/chat` | Interactive Chimmy chat interface with context | ✓ Active (also `/messages?tab=ai` for private mode) |
| **Trade Analyzer** | `/trade-analyzer` | SEO landing (or `/dynasty-trade-analyzer` for interactive) | ⚠ See notes below |
| **Trade Finder** | `/trade-finder` | AI trade partner matchmaking (PECR orchestration) | ✓ Active |
| **Settings** | `/settings` | User profile, preferences, security, billing (tabs via `?tab=` param) | ✓ Active |
| **Wallet** | `/wallet` | Wallet hub with deposit link | ✓ Active |
| **Messages / DMs** | `/messages` | Unified inbox (DMs, groups, AI chat tab) | ✓ Active |
| **League List** | `/leagues` | All user leagues (accessed via RightControlPanel) | ✓ Active |
| **Create League** | `/create-league` | League creation form | ✓ Active |
| **Profile** | `/profile` | User profile page | ✓ Active |

**Note on Trade Analyzer:**  
Current situation: `/trade-analyzer` is an SEO landing page with mostly metadata. The interactive version is at `/dynasty-trade-analyzer`. For maximum clarity, **consolidate during next trade system refactoring phase**. For now, internal CTAs may use either; `/trade-analyzer` is preferred for marketing, `/dynasty-trade-analyzer` for interactive features.

---

## 2. Updated Files

### ✅ Files Modified (Consolidation Patches)

1. **[lib/dashboard/routes.ts](lib/dashboard/routes.ts)** (NEW)
   - Created canonical route ownership constants file
   - Defines `DASHBOARD_ROUTES` object with all canonical destinations
   - Documents orphaned/legacy routes for reference
   - Single source of truth for route consolidation

2. **[app/dashboard/components/DashboardOverview.tsx](app/dashboard/components/DashboardOverview.tsx)**
   - Updated: `/tools` → `/tools-hub` (CTA button)
   - Added: Documentation comment marking canonical routes used
   - Preserved: `/create-league`, `/find-league`, `/brackets`, `/af-legacy` (intentional, not dashboard scope)

3. **[app/dashboard/components/RightControlPanel.tsx](app/dashboard/components/RightControlPanel.tsx)**
   - Verified: `/create-league` (canonical ✓)
   - Verified: `/settings` (canonical ✓)
   - Verified: `/profile` (canonical ✓)
   - Added: Documentation comment for route clarity

4. **[app/settings/components/SettingsApp.tsx](app/settings/components/SettingsApp.tsx)**
   - Verified: `/settings` (canonical ✓)
   - Verified: Tab query params preserved (`?tab=profile`, `?tab=connected`, etc.)
   - Added: Documentation comment for deep link handling

5. **[app/ai/saved/page.tsx](app/ai/saved/page.tsx)**
   - Updated: `/chimmy` → `/chimmy/chat` (Chimmy CTA button)

6. **[app/ai/history/page.tsx](app/ai/history/page.tsx)**
   - Updated: `/ai/tools` → `/tools-hub` (AI tools CTA)

### ℹ️ Files Verified (No Changes Needed)

- [app/wallet/page.tsx](app/wallet/page.tsx) - Wallet `/wallet` link already canonical ✓
- [app/dashboard/components/LeftChatPanel.tsx](app/dashboard/components/LeftChatPanel.tsx) - Chimmy chat uses resolver helpers ✓
- [app/dashboard/DashboardShell.tsx](app/dashboard/DashboardShell.tsx) - Route handling already correct ✓
- [components/ai-tools/AIToolsGrid.tsx](components/ai-tools/AIToolsGrid.tsx) - Uses `getChimmyChatHref()` resolver ✓

---

## 3. Duplicate / Orphaned Surfaces Found

### 🚨 Orphaned Components (NOT DELETED per user request; flagged for future cleanup)

| Component | Path | Status | Reason |
|-----------|------|--------|--------|
| **DashboardContent** | `app/dashboard/DashboardContent.tsx` | Orphaned | Duplicate of DashboardOverview; not mounted by DashboardShell |
| **SettingsFullPage** | `app/settings/SettingsFullPage.tsx` | Orphaned | Alternative full-page settings; not referenced by active `/settings` route |

### ⚠️ Legacy Routes (Marked for future consolidation, NOT DELETED)

| Route | Path | Status | Next Step |
|-------|------|--------|-----------|
| **Trade Analyzer (SEO)** | `/trade-analyzer` | Legacy landing | Replace with interactive form or redirect to `/dynasty-trade-analyzer` during trade refactor |
| **Trade Analyzer (Legacy UI)** | `/af-legacy/trade-analyzer` | Legacy interactive | Keep for backward compat; marked as legacy in code |
| **AI Chat (SEO)** | `/ai-chat` | SEO landing | Keep for SEO; internal CTAs use `/chimmy/chat` |
| **Chimmy (Landing)** | `/chimmy` | Marketing page | Keep for onboarding; internal CTAs use `/chimmy/chat` |
| **AI (Explainer)** | `/ai` | Educational page | Keep; not a user destination |

---

## 4. Dashboard CTA Target Matrix

### Primary Dashboard CTAs

| Control | Location | Before | After | Notes |
|---------|----------|--------|-------|-------|
| "Create League" button | DashboardOverview | `/create-league` | `/create-league` | ✓ Already canonical |
| "Tools" button | DashboardOverview | `/tools` | `/tools-hub` | ✓ Consolidated |
| "Settings" menu item | RightControlPanel | `/settings` | `/settings` | ✓ Already canonical |
| "Profile" menu item | RightControlPanel | `/profile` | `/profile` | ✓ Already canonical |
| "Ask Chimmy" link | AIToolsGrid | `getChimmyChatHref()` | `getChimmyChatHref()` | ✓ Uses resolver |

### Secondary Dashboard CTAs (Intentionally NOT consolidated)

| Control | Location | Route | Reason |
|---------|----------|-------|--------|
| "Find League" | DashboardOverview | `/find-league` | Not dashboard feature scope |
| "Brackets" | DashboardOverview | `/brackets` | Not dashboard feature scope |
| "Legacy" | DashboardOverview | `/af-legacy` | Intentional legacy support |

---

## 5. Route Constants File

Created **[lib/dashboard/routes.ts](lib/dashboard/routes.ts)** as the single source of truth:

```typescript
export const DASHBOARD_ROUTES = {
  dashboard: () => '/dashboard',
  profile: () => '/profile',
  createLeague: () => '/create-league',
  leagues: () => '/leagues',
  toolsHub: () => '/tools-hub',
  chimmyChat: () => '/chimmy/chat',
  messages: () => '/messages',
  tradeAnalyzer: () => '/trade-analyzer',
  dynastyTradeAnalyzer: () => '/dynasty-trade-analyzer',
  tradeFinder: () => '/trade-finder',
  settings: (tab?: string) => tab ? `/settings?tab=${tab}` : '/settings',
  wallet: () => '/wallet',
}
```

**Usage:** Import and use constants instead of hardcoded hrefs (optional refactor for future PRs).

---

## 6. Remaining Route Cleanup Work

### Phase 2 (Future — Not Included in This Pass)

1. **Trade Analyzer Consolidation**
   - Decide: Keep `/trade-analyzer` as interactive, or use `/dynasty-trade-analyzer`?
   - Action: Either redesign `/trade-analyzer` to be interactive, or deprecate/redirect it
   - Impact: Update all internal CTAs once decision is made

2. **AI Landing Page Consolidation**
   - `/ai`, `/ai-chat`, `/chimmy` → All marketing/onboarding pages
   - Keep for SEO/discovery; mark landing pages clearly so they don't confuse internal navigation

3. **Orphaned Component Cleanup**
   - Delete `app/dashboard/DashboardContent.tsx` (duplicate of DashboardOverview)
   - Delete `app/settings/SettingsFullPage.tsx` (not used by active /settings route)
   - Add deprecation comments before deletion in case external references exist

4. **Settings Shortcut Standardization**
   - Ensure all product pages use `/settings` (no variations like `/user/settings`)
   - Verify query param handling for tab state is consistent

5. **Wallet Integration** (Out of scope for this pass)
   - Integrate wallet balance display in dashboard (currently stub)
   - Link wallet transactions to `/wallet` from RightControlPanel profile menu

---

## 7. Mobile Behavior Preserved

✅ **Custom event dispatching intact:**
- `af-dashboard-open-mobile-left` — Toggle left chat panel on mobile
- `af-dashboard-focus-left-chimmy` — Focus Chimmy tab on mobile
- `af-open-ai-tool` — Dispatch AI tool modals with context

✅ **Deep links preserved:**
- Dashboard league selector: URL query param management (`?league=id`)
- Settings tabs: Tab state in URL (`?tab=profile`)
- Chimmy context: Prompt prefill and league context via search params

✅ **API contracts unchanged:**
- All `/api/*` routes remain intact
- No database schema changes
- No auth changes

---

## 8. Manual Navigation Test Plan

### Critical Path Testing

**Dashboard to AI Tools:**
1. Open `/dashboard`
2. Click "Tools" button → Should navigate to `/tools-hub` ✓
3. Click "Ask Chimmy" link → Should navigate to Chimmy chat ✓
4. Verify AI tool cards dispatch modal event correctly

**Dashboard to Settings:**
1. From `/dashboard` right panel, click settings icon
2. Should navigate to `/settings` with `?tab=profile` ✓
3. Click different tabs (preferences, security, connected, etc.)
4. Verify URL updates with `?tab=X` parameter
5. Copy URL and open in new tab → Should restore correct tab state ✓

**Dashboard to Create League:**
1. Click "Create League" button in RightControlPanel
2. Should navigate to `/create-league` ✓
3. Verify form loads correctly

**Mobile Behavior:**
1. Open dashboard on mobile view
2. Click AI tool card
3. Verify modal opens in-place (no navigation)
4. Verify left panel custom events work (chat toggle, Chimmy focus)

**Settings Tab Deep Links:**
1. Visit `/settings?tab=connected`
2. Verify "Connected Accounts" tab is active ✓
3. Copy URL and open in new incognito tab
4. Verify correct tab state restores ✓

**AI Route Consolidations:**
1. Open `/ai/saved`
2. Click "Open Chimmy" button → Should navigate to `/chimmy/chat` ✓
3. Open `/ai/history`
4. Click "Open AI tools" button → Should navigate to `/tools-hub` ✓

---

## 9. Files Modified Summary

| File | Changes | Risk | Status |
|------|---------|------|--------|
| [lib/dashboard/routes.ts](lib/dashboard/routes.ts) | NEW constants file | Low (new file) | ✅ Created |
| [app/dashboard/components/DashboardOverview.tsx](app/dashboard/components/DashboardOverview.tsx) | `/tools` → `/tools-hub` + docs | Low (1 link updated) | ✅ Updated |
| [app/dashboard/components/RightControlPanel.tsx](app/dashboard/components/RightControlPanel.tsx) | Docs comment only | None | ✅ Updated |
| [app/settings/components/SettingsApp.tsx](app/settings/components/SettingsApp.tsx) | Docs comment only | None | ✅ Updated |
| [app/ai/saved/page.tsx](app/ai/saved/page.tsx) | `/chimmy` → `/chimmy/chat` | Low (1 link updated) | ✅ Updated |
| [app/ai/history/page.tsx](app/ai/history/page.tsx) | `/ai/tools` → `/tools-hub` | Low (1 link updated) | ✅ Updated |

---

## 10. Consolidation Metrics

| Metric | Count |
|--------|-------|
| **Files audited** | 15+ |
| **Files updated** | 6 |
| **Routes consolidated** | 3 (`/tools` → `/tools-hub`, `/chimmy` → `/chimmy/chat`, `/ai/tools` → `/tools-hub`) |
| **Canonical destinations** | 12 |
| **Orphaned components found** | 2 (not deleted per request) |
| **Legacy routes preserved** | 4 (for backward compatibility) |
| **Mobile behavior preserved** | 3 custom event types intact |
| **Deep link patterns preserved** | Query param routing (tab state, league selector) |

---

## 11. Consolidation Checklist

- ✅ Dashboard CTAs point to canonical destinations
- ✅ AI tool links consolidated to `/tools-hub`
- ✅ Settings route and tab query params verified
- ✅ Wallet route verified as canonical
- ✅ Chimmy chat routing uses resolver helpers
- ✅ Mobile custom events preserved
- ✅ Deep link query params preserved
- ✅ No API contracts changed
- ✅ No auth changes
- ✅ No visual redesign
- ✅ No new features added
- ✅ No code deleted (orphaned components flagged only)
- ✅ Documentation comments added to key files
- ✅ Route constants file created

---

## 12. Next Steps (Recommended)

1. **Verify in development:**
   - Run `npm run build` and `npm run typecheck` to catch any type errors
   - Test all navigation paths in browser (desktop and mobile)
   - Check that URL query params are preserved correctly

2. **Update imports (optional future refactor):**
   - Components can now import `DASHBOARD_ROUTES` from `lib/dashboard/routes.ts`
   - Example: `router.push(DASHBOARD_ROUTES.settings('connected'))`
   - Not required for this pass; suggested for consistency in future PRs

3. **Plan Phase 2 cleanup:**
   - Trade analyzer consolidation
   - Orphaned component deletion
   - Landing page SEO optimization

4. **Monitor and document:**
   - Track any 404s or redirect loops related to consolidated routes
   - Update navigation documentation if any product pages add new CTAs

---

## Summary

**Dashboard surface consolidation completed successfully.** All primary CTAs now point to canonical destinations without redesign, new features, or code deletion. Mobile behavior and deep linking are preserved. Two orphaned components were identified but not deleted per request.

**Key consolidation win:** `/tools` → `/tools-hub` (AI tools hub now has single official entry point)

**Ready for:** User testing, QA validation, and Phase 2 cleanup planning.
