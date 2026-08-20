# Settings Page Manual Test Checklist

## Pre-Test Setup

- [ ] User is authenticated and logged in
- [ ] Test account has access to all settings sections
- [ ] Browser DevTools open for error monitoring
- [ ] Test on both desktop and mobile viewports
- [ ] Clear browser cache before testing

---

## 1. Route & Navigation Tests

### Basic Navigation
- [ ] Navigate to `/settings` → Profile tab loads
- [ ] Page title shows "Settings" with subtitle
- [ ] Back to dashboard button visible in header
- [ ] Back button navigates to `/dashboard`

### Tab Switching
- [ ] Click Profile tab → URL becomes `/settings?tab=profile`
- [ ] Click Preferences tab → URL becomes `/settings?tab=preferences`
- [ ] Click Security tab → URL becomes `/settings?tab=security`
- [ ] Click Notifications tab → URL becomes `/settings?tab=notifications`
- [ ] Click Connected tab → URL becomes `/settings?tab=connected`
- [ ] Click Billing tab → URL becomes `/settings?tab=billing`
- [ ] Click Referral tab → URL becomes `/settings?tab=referral`
- [ ] Click Legacy tab → URL becomes `/settings?tab=legacy`
- [ ] Click Legal tab → URL becomes `/settings?tab=legal`
- [ ] Click AI tab → URL becomes `/settings?tab=ai`
- [ ] Click Account tab → URL becomes `/settings?tab=account`

### Deep Linking
- [ ] Copy URL from active tab
- [ ] Open URL in new window → correct tab loads
- [ ] Refresh page at `/settings?tab=preferences` → stays on preferences
- [ ] Edit URL to `/settings?tab=connected` → switches to connected accounts
- [ ] Invalid tab param (e.g., `?tab=invalid`) → defaults to profile

### Mobile Navigation
- [ ] On mobile, tabs appear as horizontal scroll bar
- [ ] Scroll through tabs without page scrolling
- [ ] Tab switching works smoothly on mobile
- [ ] Active tab indicator visible on mobile
- [ ] Back button still accessible on mobile

---

## 2. Profile Section Tests

### Display Name Field
- [ ] Input field renders with current display name
- [ ] Can type new display name
- [ ] Placeholder text visible if no name set
- [ ] Field accepts spaces and special characters
- [ ] Field accepts Unicode characters (emojis, accents)

### Avatar Emoji Selection
- [ ] Avatar emoji buttons render (8 options)
- [ ] Click emoji button → button highlights
- [ ] Preview updates with selected emoji
- [ ] "Use initial" button available
- [ ] Selected emoji appears in preview

### Profile Image Upload
- [ ] "Upload image" button visible
- [ ] Click button → file picker opens
- [ ] Can select PNG/JPG/GIF/WEBP
- [ ] Upload starts immediately
- [ ] Progress indication appears
- [ ] Preview updates with new image
- [ ] "Remove image" button appears after upload
- [ ] Remove button deletes image
- [ ] Error message if upload fails
- [ ] Error message if file is too large
- [ ] Error message if unsupported file type

### Form Submission
- [ ] Submit button text changes to "Saving..." while saving
- [ ] Form disables during save
- [ ] Submit button re-enables after save completes
- [ ] Display name saves to database
- [ ] Avatar selection saves to database
- [ ] Cancel button reverts form to saved state
- [ ] Error message displays if save fails
- [ ] Username displays as read-only

### Mobile Profile Section
- [ ] Avatar preview centered
- [ ] Emoji grid scrollable on small screens
- [ ] Input field full-width
- [ ] Buttons stack vertically
- [ ] Good spacing throughout

---

## 3. Preferences Section Tests

### Language Selection
- [ ] English button renders
- [ ] Español button renders
- [ ] No other language options visible
- [ ] Active language highlighted with cyan border
- [ ] Click English → UI changes to English
- [ ] Click Español → UI changes to Spanish
- [ ] Settings title changes language
- [ ] Tab labels change language
- [ ] All form labels change language

### Timezone Selection
- [ ] Timezone dropdown visible
- [ ] Placeholder text shown initially
- [ ] Click dropdown → list of ~400 timezones appears
- [ ] Can scroll through timezone list
- [ ] Selected timezone shows in dropdown
- [ ] When timezone selected, local time hint appears
- [ ] Local time displays in user's timezone
- [ ] Local time updates with timezone changes

### Default Sport Selection
- [ ] Sport dropdown shows current selection
- [ ] Can open dropdown → list of sports appears
- [ ] All supported sports visible (NFL, NBA, etc.)
- [ ] Can select different sport
- [ ] Selected sport saves

### Theme Selection
- [ ] Light theme button visible
- [ ] Dark theme button visible
- [ ] Legacy theme button visible
- [ ] System theme button visible
- [ ] Click theme → UI immediately changes
- [ ] Selected theme highlighted
- [ ] Theme preference saves
- [ ] System theme hint shows for system option

### Chimmy Voice Settings
- [ ] Chimmy voice card renders
- [ ] Voice selection works (if configured)
- [ ] Voice preference saves

### Form Submission
- [ ] "Saving..." message appears while saving
- [ ] All changes persist after save
- [ ] Cancel button reverts unsaved changes
- [ ] Multiple settings save correctly together
- [ ] Error message if any field fails to save

### Mobile Preferences
- [ ] Language toggle responsive
- [ ] Timezone dropdown accessible
- [ ] All fields readable on mobile
- [ ] Good touch target sizes
- [ ] Scrolling works smoothly

---

## 4. Security Section Tests

### Email Management
- [ ] Email field shows current email
- [ ] "Edit" button available
- [ ] Click edit → form expands
- [ ] Can input new email
- [ ] Form validates email format
- [ ] Email saves after current password verification
- [ ] Verification email sent
- [ ] Error message if duplicate email
- [ ] Error message if invalid format
- [ ] "Send verification" button available
- [ ] Resend verification email works
- [ ] Rate limit message appears if limit exceeded

### Phone Management
- [ ] Phone field shows current phone
- [ ] "Edit" button available
- [ ] Click edit → phone form expands
- [ ] Can input phone number
- [ ] Accepts various phone formats
- [ ] "Send code" button triggers OTP
- [ ] SMS OTP received
- [ ] Can verify with OTP code
- [ ] Error message if invalid code
- [ ] Phone saves after verification
- [ ] Rate limit message appears if limit exceeded

### Password Change
- [ ] "Change password" button/form visible
- [ ] Requires current password
- [ ] Requires new password (8+ chars, letter + number)
- [ ] Requires password confirmation
- [ ] Error if passwords don't match
- [ ] Error if password too weak
- [ ] "Show/hide" toggle for passwords
- [ ] Password change completes
- [ ] Success message displays
- [ ] Form closes after success

### Session Timeout
- [ ] Session idle timeout selector visible
- [ ] Current timeout value shown
- [ ] Can change timeout value
- [ ] Dropdown includes common options
- [ ] Timeout saves correctly
- [ ] Error message if save fails

### Form States
- [ ] All fields show correct state (verified/unverified)
- [ ] Clear messaging for each status
- [ ] Error messages are actionable
- [ ] Success messages confirm action

---

## 5. Notifications Section Tests

### Category Expansion
- [ ] Notification categories list visible
- [ ] "Lineup reminders" expanded by default
- [ ] Can collapse category
- [ ] Can expand different category
- [ ] Only one category expanded at a time

### Category Toggles
- [ ] Enable/disable toggle for each category
- [ ] Category name shows
- [ ] Delivery method options appear
- [ ] Save button appears after changes

### Delivery Methods
- [ ] In-app checkbox visible
- [ ] Email checkbox visible
- [ ] SMS checkbox visible
- [ ] Can toggle each independently
- [ ] Greyed out if email/phone not verified
- [ ] "Verify email/phone" link available if needed

### Test Notification
- [ ] Test button visible
- [ ] Can select category for test
- [ ] Click test → notification sent
- [ ] Success message appears
- [ ] Error message if send fails
- [ ] Notification received (in-app/email/SMS per settings)

### Save/Reset
- [ ] "Save changes" button appears
- [ ] "Cancel changes" button available
- [ ] Save button shows "Saving..." state
- [ ] All changes persist after save
- [ ] Error message if save fails

---

## 6. Connected Accounts Section Tests

### Sign-In Providers
- [ ] Provider list loads
- [ ] Shows Discord, Yahoo, ESPN, Fantrax, MFL, Fleaflicker, Sleeper
- [ ] Status shows connected or not connected
- [ ] Identity info shows for connected providers
- [ ] Can connect unconnected provider
- [ ] Can disconnect connected provider
- [ ] Confirmation required before disconnect
- [ ] Success message after connect/disconnect
- [ ] Error message if action fails
- [ ] List refreshes automatically

### Discord Connection
- [ ] Discord section visible
- [ ] "Connect Discord" button if not connected
- [ ] Shows Discord username if connected
- [ ] Shows Discord avatar if connected
- [ ] Can disconnect with confirmation
- [ ] Disconnect fails with error if only auth method
- [ ] Success message when connected

### Spotify Connection
- [ ] Spotify section visible
- [ ] "Connect Spotify" button if not connected
- [ ] Shows Spotify username if connected
- [ ] Can disconnect with confirmation
- [ ] Spotify settings reflected in chat/voice

### Error Handling
- [ ] Error message displays for failed connections
- [ ] Error message displays for failed disconnects
- [ ] Lockout error prevents risky disconnections
- [ ] Rate limit errors handled gracefully

---

## 7. Billing Section Tests

### Plan Display
- [ ] Current plan shows (Free/Pro/Commissioner/All-Access)
- [ ] Plan badge displays with correct styling
- [ ] Status shows (active/grace/past_due/none)
- [ ] Status badge colored appropriately

### Dates Display
- [ ] Renewal date shows (if active)
- [ ] Expiration date shows (if applicable)
- [ ] Dates formatted correctly

### Buttons
- [ ] "View wallet" button visible
- [ ] Click "View wallet" → navigates to `/wallet`
- [ ] "Manage billing" button visible (if subscribed)
- [ ] Click "Manage billing" → opens billing portal
- [ ] "View plans" button visible
- [ ] Click "View plans" → navigates to `/pricing`

### Error States
- [ ] Past due notice displays if payment failed
- [ ] Grace period notice displays with deadline
- [ ] Error message if entitlements fail to load

---

## 8. Legal Section Tests

### Acceptance State Display
- [ ] Age verified status shows (yes/no)
- [ ] Disclaimer accepted status shows
- [ ] Terms accepted status shows
- [ ] Acceptance date/time shows (if set)
- [ ] Timestamp formatted in user's timezone

### Document Links
- [ ] "View disclaimer" link works
- [ ] "View terms" link works
- [ ] "View privacy" link works
- [ ] "View cookies" link works
- [ ] "View data deletion" link works
- [ ] Links open in new tab or navigate correctly

### Accessibility
- [ ] Legal text readable
- [ ] Colors meet contrast requirements
- [ ] Text size appropriate

---

## 9. Account Section Tests

### Account Info
- [ ] Plan display shows (Free/Pro/etc.)
- [ ] Member since date shows
- [ ] Date formatted correctly

### Sign Out
- [ ] "Sign out" button visible
- [ ] Click button → confirmation dialog (if configured)
- [ ] Sign out completes
- [ ] Redirects to home page
- [ ] Session cleared

### Delete Account
- [ ] "Start deletion" button visible (in danger zone)
- [ ] Button styled in red (warning color)
- [ ] Warning icon visible
- [ ] Danger zone has red border
- [ ] Click button → dialog appears

### Delete Confirmation
- [ ] Dialog asks for "DELETE" confirmation
- [ ] Text input field available
- [ ] Email button disabled until "DELETE" typed
- [ ] Type "DELETE" → button enables
- [ ] Click email button → mailto: link opens
- [ ] Email client opens with deletion request
- [ ] Support receives deletion request

### Danger Zone Design
- [ ] Red border visible
- [ ] Red/pink background
- [ ] Warning icon prominent
- [ ] Clear danger messaging
- [ ] Mobile: full-width and readable

---

## 10. AI Settings Section Tests

### Chimmy Settings
- [ ] Chimmy voice selection visible (if configured)
- [ ] Auto Coach settings visible (if available)
- [ ] AI memory settings visible
- [ ] Can toggle features on/off
- [ ] Settings save correctly

---

## 11. Legacy/Referral Section Tests

### Legacy Import
- [ ] Legacy import tools visible
- [ ] Can import from previous platforms
- [ ] Status shows if already imported

### Referral
- [ ] Referral code displays
- [ ] Can copy referral code
- [ ] Referral stats show (if applicable)
- [ ] Referral link works

---

## 12. Mobile Viewport Tests (< 640px)

### Layout
- [ ] No horizontal scrollbar needed
- [ ] Tabs scroll horizontally
- [ ] Content readable
- [ ] Form fields full-width
- [ ] Buttons touch-friendly (min 44px)

### Navigation
- [ ] Tabs accessible without scroll
- [ ] Back button accessible
- [ ] Menu items readable

### Forms
- [ ] Form labels readable
- [ ] Input fields full-width
- [ ] Placeholders visible
- [ ] Error messages clear
- [ ] Success messages visible

### Spacing
- [ ] No cramped layout
- [ ] Touch targets appropriately sized
- [ ] No content overlap
- [ ] Margins/padding appropriate

### Dialogs
- [ ] Delete dialog scales properly
- [ ] Dialog text readable
- [ ] Buttons accessible
- [ ] Close button works

---

## 13. Error Handling Tests

### Network Errors
- [ ] Offline → error message appears
- [ ] Failed save → error message appears
- [ ] Failed upload → error message appears
- [ ] API timeout → error message appears

### Validation Errors
- [ ] Invalid email → error message
- [ ] Weak password → error message
- [ ] Mismatched passwords → error message
- [ ] Invalid phone format → error message
- [ ] Form prevents submission if invalid

### State Errors
- [ ] Missing required fields → error message
- [ ] Duplicate email → error message
- [ ] Duplicate phone → error message
- [ ] Locked out operation → error message

### Recovery
- [ ] Can retry failed operations
- [ ] Can correct validation errors
- [ ] Can dismiss error messages
- [ ] Page remains usable after error

---

## 14. Performance Tests

### Load Time
- [ ] Page loads in < 2 seconds
- [ ] Tab switches are instant
- [ ] No loading spinners unless necessary
- [ ] No layout shifts

### Form Responsiveness
- [ ] Typing in fields is smooth
- [ ] No lag when selecting options
- [ ] Scrolling smooth on mobile
- [ ] No jank or stuttering

### File Upload
- [ ] Upload starts immediately
- [ ] Progress indication visible
- [ ] Preview updates smoothly
- [ ] No page freeze during upload

---

## 15. Accessibility Tests

### Keyboard Navigation
- [ ] Tab key navigates between fields
- [ ] Enter key submits forms
- [ ] Escape closes dialogs
- [ ] All buttons keyboard accessible

### Screen Reader
- [ ] Form labels associated with inputs
- [ ] Buttons have descriptive labels
- [ ] Error messages announced
- [ ] Status changes announced

### Color Contrast
- [ ] All text meets WCAG standards
- [ ] Icons have sufficient contrast
- [ ] Links visually distinct
- [ ] Error colors clear

### ARIA Attributes
- [ ] aria-labels present where needed
- [ ] aria-checked on toggles
- [ ] aria-modal on dialogs
- [ ] aria-hidden on decorative elements

---

## 16. Browser Compatibility

### Desktop Browsers
- [ ] Chrome latest
- [ ] Firefox latest
- [ ] Safari latest
- [ ] Edge latest

### Mobile Browsers
- [ ] Safari iOS
- [ ] Chrome Android
- [ ] Firefox mobile
- [ ] Samsung Internet

### Rendering
- [ ] Fonts render correctly
- [ ] Colors display correctly
- [ ] Gradients smooth
- [ ] Icons visible

---

## 17. Language/Localization Tests

### English
- [ ] All labels in English
- [ ] All button text in English
- [ ] All messages in English
- [ ] All placeholders in English

### Spanish
- [ ] All labels in Spanish
- [ ] All button text in Spanish
- [ ] All messages in Spanish
- [ ] All placeholders in Spanish
- [ ] Special characters display (ñ, á, etc.)

### Language Toggle
- [ ] Switching languages updates UI
- [ ] No page reload needed
- [ ] Settings persist when switching
- [ ] Timezone shows in correct language

---

## 18. Data Persistence Tests

### Profile Section
- [ ] Display name persists after refresh
- [ ] Avatar selection persists
- [ ] Custom image URL persists

### Preferences Section
- [ ] Language preference persists
- [ ] Timezone selection persists
- [ ] Theme preference persists
- [ ] Sport selection persists

### Security Section
- [ ] Email changes persist
- [ ] Phone changes persist
- [ ] Password changes persist
- [ ] Session timeout persists

### Notifications
- [ ] Notification preferences persist
- [ ] Category selections persist
- [ ] Delivery method choices persist

---

## 19. Edge Cases

### Empty State
- [ ] Page works with no display name set
- [ ] Page works with no avatar selected
- [ ] Page works with no timezone set
- [ ] Handles null/undefined gracefully

### Boundary Values
- [ ] Very long display name (> 100 chars)
- [ ] Very long timezone name
- [ ] Multiple rapid saves
- [ ] Rapid tab switching
- [ ] Fast internet connection
- [ ] Slow internet connection

### Session Edge Cases
- [ ] Settings page works after auth
- [ ] Settings page after token refresh
- [ ] Settings after session timeout (if configured)

---

## 20. Visual Design Verification

### Header
- [ ] Title and subtitle visible
- [ ] Proper spacing between elements
- [ ] Icons properly rendered
- [ ] Back button styled correctly

### Tabs
- [ ] Active tab highlighted
- [ ] Inactive tabs properly styled
- [ ] Icons aligned with labels
- [ ] Hover states visible
- [ ] Active border/background correct color (cyan)

### Form Fields
- [ ] Labels properly positioned
- [ ] Input fields properly styled
- [ ] Borders visible
- [ ] Placeholder text visible
- [ ] Focus states visible
- [ ] Disabled states obvious

### Buttons
- [ ] Primary buttons have gradient
- [ ] Secondary buttons have border style
- [ ] Danger buttons are red
- [ ] Hover states clear
- [ ] Disabled states obvious
- [ ] Loading states visible

### Danger Zone
- [ ] Red border visible
- [ ] Warning icon visible
- [ ] Background color appropriate
- [ ] Text clearly warns of consequences
- [ ] Mobile: prominent and readable

### Success/Error Messages
- [ ] Success messages green
- [ ] Error messages red
- [ ] Messages clearly written
- [ ] Messages actionable
- [ ] Messages auto-dismiss (if configured)

---

## Sign-Off

**Tester Name:** ________________  
**Test Date:** ________________  
**Environment:** Desktop / Mobile / Both  
**Browser:** ________________  
**OS:** ________________  

**Issues Found:** ☐ None ☐ Minor ☐ Major  

**Notes:**  
___________________________________________________________________  
___________________________________________________________________  

**Approved for Production:** ☐ Yes ☐ No  

**Signature:** ________________  
