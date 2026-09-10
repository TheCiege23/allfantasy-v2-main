import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LeagueHealthView } from "@/components/commissioner-os/league-health/LeagueHealthView"
import { stubLeagueHealthClient } from "@/lib/commissioner-ui/league-health/decision-os-client/stub"
import { demoLeagueHealthClient } from "@/lib/commissioner-ui/league-health/decision-os-client/demo"
import { liveLeagueHealthClient } from "@/lib/commissioner-ui/league-health/decision-os-client/live"
import type { LeagueHealthDetail } from "@/lib/commissioner-ui/league-health/decision-os-client"

/*
 * 🛑 THE HEALTH-DETAIL CONTRACT WAS REPLACED, DELIBERATELY, BY `6158b1fed`.
 *
 *   removed   baseline · deductions[] · subScores{engagement,retention,…}
 *   added     retentionRisk · commissionerWorkload · participation · completeness
 *
 * Five tests here asserted the old shape and went red on the change. They are RE-AIMED at the
 * new contract rather than deleted: the old "deductions sum to the score" invariant is not
 * merely unmet, it is unexpressible — there is no breakdown left to sum — but the thing it was
 * really protecting (a client cannot hand the view numbers that contradict each other) still
 * exists, and is asserted below against every client.
 *
 * ⚠ AND "View Evidence" IS GONE ON PURPOSE, NOT BROKEN. `LeagueHealthView` says so where the
 * dialog used to stand: it hid the league's narrative behind a click, that narrative is now the
 * primary content of "What drives this score", and `completeness` took its slot because it was
 * the one real field the page fetched and never rendered. Restoring the old assertion would be
 * demanding a regression, so this file asserts the replacement instead — and that the dialog has
 * not crept back.
 */

async function loadAll(client: typeof stubLeagueHealthClient) {
  return Promise.all([client.getHealthDetail(), client.getRisks(), client.getEvidence(), client.getRecommendations()])
}

/** A complete detail in the CURRENT shape, so a future contract change breaks one place. */
const healthyDetail: LeagueHealthDetail = {
  score: 100,
  tier: 'positive',
  retentionRisk: 'positive',
  commissionerWorkload: 'positive',
  participation: { activeManagers: 12, totalManagers: 12 },
  completeness: 100,
}

describe("commissioner-os — League Health client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    const methods = ["getHealthDetail", "getRisks", "getEvidence", "getRecommendations"] as const
    for (const method of methods) {
      expect(typeof stubLeagueHealthClient[method]).toBe("function")
      expect(typeof demoLeagueHealthClient[method]).toBe("function")
      expect(typeof liveLeagueHealthClient[method]).toBe("function")
    }
  })

  /*
   * Both fixture clients held to the same invariants — which is what makes stub/demo parity mean
   * something, rather than being two fixtures that merely happen to render.
   */
  it.each([
    ['stub', stubLeagueHealthClient],
    ['demo', demoLeagueHealthClient],
  ])("%s health detail is internally consistent", async (_name, client) => {
    const detail = (await client.getHealthDetail()).data!

    // The one real computed number, and its documented range.
    expect(detail.score).toBeGreaterThanOrEqual(0)
    expect(detail.score).toBeLessThanOrEqual(100)

    /*
     * `completeness` is a property of the INPUTS, not confidence in any single finding — the type
     * says so explicitly. It is still a percentage and still has to be one.
     */
    expect(detail.completeness).toBeGreaterThanOrEqual(0)
    expect(detail.completeness).toBeLessThanOrEqual(100)

    /*
     * ⚠ `totalManagers` IS NOT THE ROSTER SIZE. It counts managers with at least one event inside
     * the intelligence lookback window, so the denominator slides as that window moves. Active can
     * never exceed it regardless, and a fixture that breaks this renders "13 of 12" on the page.
     */
    expect(detail.participation.activeManagers).toBeGreaterThanOrEqual(0)
    expect(detail.participation.activeManagers).toBeLessThanOrEqual(detail.participation.totalManagers)

    /*
     * Banded, not scored, on purpose: Decision OS bands retention risk rather than scoring it, and
     * rendering either of these as a number would invent precision the pipeline does not have.
     */
    expect(typeof detail.retentionRisk).toBe('string')
    expect(typeof detail.commissionerWorkload).toBe('string')
  })

  it("live placeholder returns an honest error, never fixture data", async () => {
    const response = await liveLeagueHealthClient.getHealthDetail()
    expect(response.data).toBeNull()
    expect(response.error?.category).toBe("upstream_unavailable")
    expect(response.source).toBe("live")
  })
})

describe("commissioner-os — League Health view", () => {
  it("renders the health score and the fields that replaced the sub-scores", async () => {
    const [detail, risks, evidence, recommendations] = await loadAll(demoLeagueHealthClient)
    const d = detail.data!
    render(
      <LeagueHealthView
        detail={d}
        risks={risks.data!}
        evidence={evidence.data!}
        recommendations={recommendations.data!}
        dataMode="demo"
      />
    )

    expect(screen.getAllByText(String(d.score)).length).toBeGreaterThanOrEqual(1)

    /*
     * ⚠ `getAllByText`, NOT `getByText`, AND THAT IS THE WHOLE POINT OF THIS LINE.
     * The old assertion was `getByText('Healthy')` and it now throws "Found multiple elements" —
     * because the view renders THREE independently-banded severities (overall tier, retention
     * risk, commissioner load) through one `SEVERITY_LABELS` map. A healthy league says "Healthy"
     * three times, correctly. Asserting uniqueness would be asserting that two of those three
     * bands had gone missing.
     */
    expect(screen.getAllByText('Healthy').length).toBeGreaterThanOrEqual(1)

    // Participation renders as a ratio; the denominator is window-scoped — see the note above.
    expect(
      screen.getByText(`${d.participation.activeManagers} of ${d.participation.totalManagers}`)
    ).toBeInTheDocument()
  })

  it("renders the risk table with severity labels", async () => {
    const [detail, risks, evidence, recommendations] = await loadAll(demoLeagueHealthClient)
    render(
      <LeagueHealthView
        detail={detail.data!}
        risks={risks.data!}
        evidence={evidence.data!}
        recommendations={recommendations.data!}
        dataMode="demo"
      />
    )
    for (const risk of risks.data!) {
      expect(screen.getByText(risk.description)).toBeInTheDocument()
    }
  })

  it("shows the healthy empty state when there are no risks", async () => {
    render(
      <LeagueHealthView
        detail={healthyDetail}
        risks={[]}
        evidence={[]}
        recommendations={[]}
        dataMode="demo"
      />
    )
    expect(screen.getByText('No active risks.')).toBeInTheDocument()
    expect(screen.getByText('No open recommendations.')).toBeInTheDocument()
  })

  /*
   * 🛑 REPLACES "evidence is reachable via the View Evidence trigger".
   *
   * That button was removed on purpose and the component explains why where it stood. Re-adding
   * the old assertion would demand a regression; simply deleting the test would leave the page's
   * data-quality caveat — the thing the removal promoted into its place — unguarded. So this
   * asserts the replacement renders AND that the dialog has not crept back.
   */
  it("shows data quality in place of the removed View Evidence dialog", async () => {
    const [detail, risks, evidence, recommendations] = await loadAll(demoLeagueHealthClient)
    render(
      <LeagueHealthView
        detail={detail.data!}
        risks={risks.data!}
        evidence={evidence.data!}
        recommendations={recommendations.data!}
        dataMode="demo"
      />
    )
    expect(screen.getByText('Inputs available')).toBeInTheDocument()
    expect(screen.getByText(`${detail.data!.completeness}%`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View Evidence' })).toBeNull()
  })
})
