"use client"

import { usePathname } from "next/navigation"
import { ModeToggle } from "@/components/theme/ModeToggle"

export function GlobalModeToggle() {
  const pathname = usePathname() ?? ""
  if (pathname?.startsWith("/admin")) return null

  /** Right-rail profile footer (username + settings) sits bottom-right; fixed toggle covered the gear. */
  if (pathname?.startsWith("/dashboard") || pathname?.startsWith("/league/")) return null

  /** Dashboard v2 carries its own appearance control inside the settings popup
   *  under the user's name (see dash-v2/PanelUserMenu). While the v2 preview is
   *  still reachable at /core/dashboard-v2 this toggle would be a SECOND switch
   *  for one setting — the panel one top-left, this one bottom-right, both on
   *  screen together. Scoped to that exact segment rather than all of /core,
   *  because every other /core screen still relies on this control. */
  if (pathname === "/core/dashboard-v2" || pathname.startsWith("/core/dashboard-v2/")) return null

  /** Bug-stab: draft room mounts WarRoomPopup at fixed bottom-4 right-4 z-[60].
   *  This toggle sits at fixed bottom-4 right-4 z-40 — same coordinates, lower
   *  z-index — so the AF/light-dark button visually overlaps the War Room
   *  trigger and steals user clicks at narrow widths. The draft route has its
   *  own theme controls in DraftTopBar; the global toggle is redundant here. */
  if (pathname?.startsWith("/draft/") || pathname?.startsWith("/draft-room/")) return null

  /** Canonical `/create-league`; legacy `/leagues/create` and `/create-league/v2` redirect but may flash on client. */
  const createLeagueRoute =
    pathname.startsWith('/create-league') || pathname === '/leagues/create'

  /*
   * `bottom-20` (80px) is clearance for a phone bottom bar, and on the marketing
   * landing page there is no bottom bar to clear — so it parked this pill in the
   * middle of the content instead. Measured at 375x812 on `/`: it covered the
   * word "projections" in the pricing paragraph, and at the foot of the page it
   * sat on top of the state-restriction legal line.
   *
   * ⚠ SCOPED TO `/` ON PURPOSE, NOT "everything that isn't /core". Several other
   * routes DO have their own fixed mobile bottom bar that this clearance is
   * carrying — `/survivor/[leagueId]`, `/tournament/[tournamentId]`,
   * `/world-cup`, `/brackets/*` and the IDP draft filters — so inverting the
   * default would tuck the toggle underneath each of them. `/core` keeps it too:
   * that is `.af-core .af-tabbar`, the one this value was chosen for.
   *
   * ⚠ THAT CLEARANCE SURVIVES THE MOVE TO `--af-fab-slot-1` BELOW, WHICH IS THE
   * THING TO CHECK BEFORE TOUCHING EITHER. Those routes do not load af-core.css,
   * so they take the literal fallback — 86px, six more than the 80 they were
   * tuned against, never fewer. No bar this clearance was carrying gets closer.
   */
  const marketingLanding = pathname === '/'

  /*
   * 🛑 SLOT 1, NOT `bottom-20`. `bottom-20` is 80px, and so was BackToTop's, and
   * the comms launcher's 56px bubble occupies 76–132px from the bottom on a
   * phone — so all three controls were stacked in one corner and this pill, at
   * z-40, was the one underneath both. Reported as the chat bubble and back-to-
   * top sitting on top of each other; this one was not even visible to report.
   *
   * `--af-fab-slot-1` is the first step above the comms launcher and already
   * tracks the phone tab bar's real height, home indicator included, so this
   * file does not have to know any of that. The fallback matters: /pricing and
   * the other routes this renders on do not load af-core.css, and an unresolved
   * `var()` in a `bottom` would drop the pill to the top of the page.
   *
   * ⚠ `lg:bottom-4` IS GONE AND NOTHING REPLACES IT. It existed to undo the
   * phone clearance on desktop; the token does that by itself now — it is
   * `--af-fab-inset` (18px) above 720px — so a Tailwind override would only
   * reintroduce a second opinion about the same number.
   */
  const stacked = !createLeagueRoute && !marketingLanding

  return (
    <div
      className={
        createLeagueRoute
          ? 'fixed right-4 top-4 z-40 sm:top-5'
          : marketingLanding
            ? 'fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40'
            : 'fixed z-40'
      }
      style={
        stacked
          ? { right: 'var(--af-fab-inset, 18px)', bottom: 'var(--af-fab-slot-1, 86px)' }
          : undefined
      }
    >
      {/*
        The 44px thumb floor, phone only.

        `px-3 py-2 text-xs` computes to 52x34 — measured on `/` and `/pricing` in
        Mobile Chrome and Mobile Safari. It is a FIXED control sitting over page
        content, so a missed tap lands on whatever is underneath it.

        Phone-scoped because 34px already clears the WCAG 2.5.8 AA floor of 24px
        on a precise pointer, and this pill is on every route — widening it
        everywhere is a visual change well outside what the phone gate asks for.
        720px matches the band the rest of this repair used, not Tailwind's `sm`.

        The flex utilities come with the min-height: without them the label sits
        against the top of a box that is now taller than its text.
      */}
      <ModeToggle className="rounded-xl border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur max-[720px]:inline-flex max-[720px]:min-h-[44px] max-[720px]:min-w-[44px] max-[720px]:items-center max-[720px]:justify-center"
      />
    </div>
  )
}
