import { expect, test } from '@playwright/test'

test('shared controls fit a narrow Android screen and a tall dialog remains scrollable', async ({ page }) => {
  await page.setViewportSize({width:360,height:800})
  await page.goto('/e2e/android-mobile')
  await expect(page.getByRole('heading', {name:'Android controls preview'})).toBeVisible()
  for (const name of ['Review lineup','Add player','Review trade']) {
    const box = await page.getByRole('button',{name,exact:true}).boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(47.5)
    expect(box?.width).toBeGreaterThanOrEqual(47.5)
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button',{name:'Review trade',exact:true}).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y+box!.height).toBeLessThanOrEqual(800)
  await dialog.getByRole('button',{name:'Save preview'}).scrollIntoViewIfNeeded()
  await expect(dialog.getByRole('button',{name:'Save preview'})).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button',{name:'Review trade',exact:true})).toBeFocused()
})
