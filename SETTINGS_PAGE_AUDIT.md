# Settings Page Audit & Improvement Plan

## Current State Assessment

### ✅ Settings Sections (11 tabs)
1. **Profile** - Display name, avatar/emoji selection, custom image upload ✓
2. **Preferences** - Language (EN/ES), timezone, default sport, theme ✓
3. **Security** - Email, phone, password management ✓
4. **Notifications** - Per-category delivery method preferences ✓
5. **Connected Accounts** - OAuth providers (Discord, Spotify, sign-in providers) ✓
6. **Billing** - Subscription status, plan display ✓
7. **Referral** - Referral code and incentives (via ReferralSection) ✓
8. **Legacy** - Legacy import tools ✓
9. **Legal** - Acceptance state (age, terms, disclaimer) ✓
10. **AI** - Chimmy-specific settings ✓
11. **Account** - Sign out, delete account, member since, plan info ✓

### ✅ Real vs Placeholder Fields

| Field | Real | Notes |
|-------|------|-------|
| Display name | ✓ | Saved to DB via `useSettingsProfile` |
| Avatar/emoji | ✓ | Presets + custom upload to storage |
| Email | ✓ | Verification required, used for recovery |
| Phone | ✓ | Verification via OTP |
| Password | ✓ | Change password with current pwd verification |
| Timezone | ✓ | Saved, used for time formatting |
| Language | ✓ | EN/ES only, persisted in localStorage + DB |
| Theme | ✓ | Light/dark/legacy/system, persisted locally |
| Default sport | ✓ | Preferred sports list (first is default) |
| Connected accounts | ✓ | OAuth link/disconnect, provider config check |
| Notifications | ✓ | Category-based, delivery methods per category |
| Billing | ✓ | Read-only, pulls from entitlements API |
| Legal acceptance | ✓ | Read-only, displays acceptance state timestamps |
| Account deletion | ✓ | Email support redirect (manual process) |

### ✅ Features Implemented
- ✓ Profile avatar (emoji + image upload)
- ✓ Username (read-only, shown on profile)
- ✓ Email (with verification)
- ✓ Phone (with OTP verification)
- ✓ Password reset (requires current pwd)
- ✓ Timezone (dropdown, shows local time)
- ✓ Language EN/ES (toggle buttons)
- ✓ Favorite sports (single selector)
- ✓ Notification preferences (per-category, per-delivery method)
- ✓ Dark/light mode toggle
- ✓ Connected accounts (Discord, Spotify, Sign-in providers)
- ✓ Legal acknowledgements (display state, links to docs)
- ✓ Account deletion (via email confirmation)
- ✓ Sign out
- ✓ Billing status (read-only)

### ✅ Mobile Friendliness
- ✓ Tab navigation responsive (horizontal scroll on mobile)
- ✓ Forms stack vertically
- ✓ Buttons sized for touch (min-h-[44px] implied)
- ✓ Input fields full-width on mobile
- ⚠️ Spacing could be better on small screens

### ✅ Save/Error/Success States
- ✓ useSettingsProfile hook provides: `loading`, `saving`, `error`, `profile`
- ✓ Individual form sections handle validation
- ✓ Error toast/message display exists
- ⚠️ Success messages could be clearer
- ⚠️ Form save buttons could show better feedback

### ✅ Deep Link Support
- ✓ Tab query params work: `/settings?tab=profile`, `/settings?tab=connected`, etc.
- ✓ useSearchParams() reads param
- ✓ handleTabSelect() uses router.replace() to update URL
- ✓ useEffect() syncs URL changes back to state

### 🚨 Duplicate Settings Pages
| File | Status | Notes |
|------|--------|-------|
| SettingsApp.tsx | Active | Primary active component |
| SettingsFullPage.tsx | Orphaned | Not referenced by /settings route |
| app/settings/page.tsx | Active | RSC entry point, mounts SettingsApp |

---

## UX Improvement Plan

### Priority 1: Clear Messaging & Labels
- [ ] Add "Account Control Center" subtitle to main header
- [ ] Add section descriptions to each tab
- [ ] Improve save/error/success message clarity
- [ ] Add "No changes" message when nothing to save
- [ ] Better error message formatting (not just text)

### Priority 2: Mobile Layout
- [ ] Improve vertical spacing on small screens
- [ ] Better touch target sizes for form controls
- [ ] Sticky header for form submit buttons
- [ ] Collapsible sections on mobile

### Priority 3: Language & Localization
- [ ] Ensure language selector shows ONLY English/Español
- [ ] Verify timezone list is localized (if needed)
- [ ] Add hint text for timezone (shows current local time)
- [ ] Language change affects entire UI (✓ already works)

### Priority 4: Connected Accounts
- [ ] Better provider labels (Discord → "Discord", not just "discord")
- [ ] Clearer linked/unlinked status indicators
- [ ] More prominent connect/disconnect buttons
- [ ] Success message when account linked
- [ ] Confirmation before disconnect

### Priority 5: Security Section
- [ ] Add "Email & Phone" subheader
- [ ] Clear "Password" subheader
- [ ] Session timeout display & management
- [ ] Better password change form layout

### Priority 6: Account Danger Zone
- [ ] Larger warning border/color
- [ ] Clearer "Delete Account" heading
- [ ] Better explanation of what deletion means
- [ ] More prominent email confirmation link

### Priority 7: Legal Acknowledgements
- [ ] Better card styling for acceptance state
- [ ] Links to legal docs (disclaimer, terms, privacy, cookies, data deletion)
- [ ] Timestamp formatting in user's timezone
- [ ] Better layout for long legal text

### Priority 8: Wallet Integration
- [ ] Add link to /wallet from billing section
- [ ] Better wallet card design in billing
- [ ] "View wallet" button

---

## Remaining Gaps

1. **Session Management**
   - No idle timeout display
   - No "active sessions" view
   - No "sign out from all devices" option

2. **Two-Factor Authentication**
   - Not implemented (security section has email/phone but not 2FA)
   - Could add TOTP or SMS 2FA in future

3. **Email Preferences**
   - Notification settings exist (✓)
   - But email subscription management could be more granular

4. **Profile Visibility**
   - No "public profile" toggle or customization
   - No profile URL display

5. **Export Data**
   - No data export feature
   - Could add user data download (GDPR compliance)

6. **Activity Log**
   - No login history or activity timeline
   - Could add "recent activity" section

---

## Test Checklist

### Routing & Deep Links
- [ ] `/settings` loads with `?tab=profile` default
- [ ] `/settings?tab=connected` loads connected accounts tab
- [ ] `/settings?tab=preferences` shows language toggle EN/ES
- [ ] Tab switching updates URL query param
- [ ] Copy URL and open in new tab → correct tab restores

### Profile Section
- [ ] Display name input and save works
- [ ] Avatar emoji selection shows in preview
- [ ] Custom image upload works
- [ ] Form saves without errors

### Preferences Section
- [ ] Language toggle EN/ES (not other languages)
- [ ] Timezone dropdown works (shows ~400 options)
- [ ] Timezone change shows local time hint
- [ ] Default sport selector works
- [ ] Theme toggle (light/dark/legacy/system) works
- [ ] Settings save without errors

### Security Section
- [ ] Email edit form works
- [ ] Email verification flow works (if needed)
- [ ] Phone edit form works
- [ ] Phone OTP verification flow works
- [ ] Password change requires current password
- [ ] Password change validates confirmation match
- [ ] All save without errors

### Connected Accounts
- [ ] Provider list loads
- [ ] "Connect" buttons visible and work
- [ ] "Disconnect" buttons require confirmation
- [ ] Success/error messages clear
- [ ] List refreshes after connect/disconnect

### Notifications
- [ ] Category accordion opens/closes
- [ ] Toggles enable/disable category
- [ ] Delivery method checkboxes work (in-app, email, SMS)
- [ ] Save works

### Billing
- [ ] Shows correct plan status
- [ ] Shows expiration/renewal date
- [ ] Link to wallet (if added)
- [ ] Read-only (no edit buttons)

### Legal
- [ ] Displays acceptance state (Y/N for each)
- [ ] Shows acceptance timestamp
- [ ] Links to legal docs all work
- [ ] Read-only

### Account
- [ ] Sign out button works
- [ ] Delete account button opens dialog
- [ ] Dialog requires typing "DELETE"
- [ ] Email link only appears when confirmed
- [ ] Plan and member since display correctly

### Mobile (tested on < 640px)
- [ ] Tab nav still scrollable
- [ ] Forms readable without horizontal scroll
- [ ] Buttons have good touch targets
- [ ] Spacing looks good
- [ ] No layout shifts

---

## Files to Modify (Targeted)

**Low-risk improvements:**
1. `SettingsChrome.tsx` - Better header/descriptions
2. `ProfileSettingsSection.tsx` - Better labels, success messages
3. `PreferencesSettingsSection.tsx` - Language enum check, timezone hints
4. `SecuritySettingsSection.tsx` - Better section headers, clearer forms
5. `ConnectedAccountsSettingsSection.tsx` - Better provider labels, status display
6. `BillingSettingsSection.tsx` - Add wallet link
7. `LegalSettingsSection.tsx` - Better card formatting
8. `AccountSettingsSection.tsx` - Clearer danger zone, better delete UI

**Do NOT modify:**
- Auth flows (leave NextAuth as-is)
- Database schema
- API endpoints
- SettingsApp.tsx core logic (tab routing works)
- Payment processing

---

## Success Criteria

✅ All settings sections render without errors
✅ Deep links (`?tab=X`) work correctly
✅ Language toggle shows only EN/ES
✅ Timezone selector shows local time
✅ Connected accounts show clear labels and status
✅ Mobile layout is clean and readable
✅ Save/error messages are clear
✅ Delete account danger zone is clear and prominent
✅ Wallet link appears in billing section
✅ All forms validate input correctly
