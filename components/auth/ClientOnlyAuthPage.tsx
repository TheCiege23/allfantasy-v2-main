"use client";

import { useEffect, useState, type ReactNode } from "react";
import "@/components/core-app/af-core.css";

/**
 * Defers the auth form to the client.
 *
 * ⚠ THE BOUNDARY STAYS. It exists to stop a real hydration crash on these
 * routes, and AuthV4's own Suspense boundary covers a different failure (a root
 * remount wiping the form mid-typing). Removing this is a separate decision with
 * its own verification, not a tidy-up.
 *
 * ⚠ WHAT DID CHANGE IS THE FALLBACK'S COLOUR. It was `bg-[#080611] text-white` —
 * hardcoded dark, outside the `.af-core` token layer, so a reader in light mode
 * got a near-black flash before the form painted white underneath it. The
 * fallback now uses the same tokens the card does and follows `html[data-mode]`
 * like everything else.
 *
 * Note this shell IS the entire server response for /login and /signup: the
 * served HTML contains only this markup. That is why it is worth it looking
 * deliberate rather than like a failed page.
 */
export function ClientOnlyAuthPage({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <main className="af-core af-au-boot">
        <div className="af-au-boot-inner">
          <div className="af-au-boot-wordmark">AllFantasy</div>
          {/* aria-live so a screen reader announces the wait rather than
              reaching an empty document and going silent. */}
          <div className="af-au-boot-note" role="status" aria-live="polite">
            Loading&hellip;
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
