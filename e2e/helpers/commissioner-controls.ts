import { expect, type Page } from '@playwright/test'

/**
 * Open the draft room's Commissioner Control Center.
 *
 * ⚠ SIX SPECS CLICKED `draft-open-commissioner-controls` DIRECTLY AND THAT TESTID
 * DOES NOT EXIST. Verified against app/ and components/: the control center itself
 * is real (CommissionerControlCenterModal.tsx carries every inner testid those
 * specs go on to use), but nothing renders that entry-point id. The two buttons
 * that actually open it are `draft-topbar-set-order` and
 * `draft-topbar-open-settings`, and both live INSIDE the overflow menu, so even
 * the right id fails until `draft-topbar-menu-toggle` has been clicked.
 *
 * An unguarded click on a locator that matches nothing throws, and in each of
 * those specs it was the first line of the commissioner block — so it took every
 * assertion after it down too. That is a large share of the "element(s) not
 * found" failures on the core shards.
 *
 * This is `draft-room-click-audit.spec.ts`'s own helper, moved here unchanged
 * rather than reimplemented. It was already correct: it probes for the dedicated
 * gear with `.count()` (so a missing id is a fallback, never a throw), then the
 * primary CTA, then opens the overflow menu. One implementation, seven callers.
 *
 * Note the dedicated-gear branch is deliberately KEPT even though the id is
 * currently absent: draft-room-click-audit asserts `toHaveCount(0)` for it in
 * e2eRoom mode, which means its presence is a real per-layout variation rather
 * than dead code.
 */

export async function openCommissionerControls(page: Page) {
  const dedicatedGear = page.getByTestId('draft-open-commissioner-controls')
  const primaryCta = page.getByTestId('draft-topbar-commissioner-primary')
  const modal = page.getByTestId('draft-commissioner-modal')
  const overlay = page.getByTestId('draft-commissioner-overlay')
  const dialogFallback = page.getByRole('dialog', { name: /Commissioner control center/i })

  const isControlsVisible = async () =>
    (await modal.isVisible().catch(() => false)) ||
    (await dialogFallback.isVisible().catch(() => false)) ||
    (await overlay.isVisible().catch(() => false))

  const assertControlsVisible = async () => {
    const modalVisible = await modal.isVisible().catch(() => false)
    const dialogVisible = await dialogFallback.isVisible().catch(() => false)
    if (!modalVisible && !dialogVisible) {
      await expect(dialogFallback).toBeVisible({ timeout: 15_000 })
      return
    }
    if (modalVisible) {
      await expect(modal).toBeVisible({ timeout: 15_000 })
      return
    }
    await expect(dialogFallback).toBeVisible({ timeout: 15_000 })
  }

  /** When `onOpenDraftRoomSettings` is set, the header gear is draft settings — use primary CTA or overflow instead. */
  const clickCommissionerEntry = async () => {
    if ((await dedicatedGear.count()) > 0) {
      await dedicatedGear.click()
      return
    }
    if ((await primaryCta.count()) > 0) {
      await primaryCta.click()
      return
    }
    await page.keyboard.press('Escape').catch(() => {})
    const menu = page.getByTestId('draft-topbar-menu')
    if (!(await menu.isVisible().catch(() => false))) {
      await page.getByTestId('draft-topbar-menu-toggle').click()
    }
    await expect(menu).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('draft-topbar-open-settings').click()
  }

  if (await isControlsVisible()) {
    await assertControlsVisible()
    return
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await isControlsVisible()) {
      await assertControlsVisible()
      return
    }
    await clickCommissionerEntry()
    await expect.poll(async () => await isControlsVisible(), { timeout: 10_000 }).toBe(true)
    if (await isControlsVisible()) {
      await assertControlsVisible()
      return
    }
    await page.waitForTimeout(200)
  }

  await assertControlsVisible()
}
