import type { Metadata } from "next";

/**
 * ⚠ THIS IMPORT IS THE FIX FOR "THE PAGE LOSES ITS STYLING AFTER YOU USE IT ONCE".
 *
 * af-import.css was imported ONLY from components/core-app/screens/ImportV4.tsx, which is
 * a 'use client' component. On Next 14.2.x, CSS pulled in that way can be dropped during a
 * client-side navigation and never re-added, so the screen renders unstyled after the first
 * soft nav -- and on browser Back.
 *
 * Reported as "reverts back to the previous visuals after using it once", and reproduced in
 * a fresh incognito window, which rules out a stale cache: a first load is styled, the next
 * render is not.
 *
 * Importing it from this layout -- a SERVER component -- puts the stylesheet in the route's
 * own CSS payload, where client-side navigation cannot drop it. The import in ImportV4 is
 * deliberately LEFT IN PLACE: that component also renders under /core/[[...screen]], which
 * has no layout of its own, and the bundler dedupes the duplicate.
 *
 * ⚠ THE SAME BUG IS LATENT ACROSS /core. AuthV4, Career, Dashboard34, DashboardV2 and
 * DraftHq all import their own CSS from client components and app/core/ has NO layout.tsx
 * at all. Fixing that means adding one, which is a wider change than this screen.
 */
import "@/components/core-app/af-import.css";

export const metadata: Metadata = {
  title: "Import Your League \u2013 AllFantasy",
  description:
    "Import your fantasy league from Sleeper or ESPN to get rankings and insights. Coverage varies by provider.",
};

export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
