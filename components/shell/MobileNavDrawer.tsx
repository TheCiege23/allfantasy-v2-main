"use client"

import type { ComponentProps } from "react"
import { MobileNavigationDrawer } from "./MobileNavigationDrawer"

/**
 * Spec-aligned responsive mobile navigation drawer wrapper.
 */
export function MobileNavDrawer(props: ComponentProps<typeof MobileNavigationDrawer>) {
  return <MobileNavigationDrawer {...props} />
}
