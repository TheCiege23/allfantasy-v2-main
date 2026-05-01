import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"

const NFL_GRAPHQL_QUERY = `query { nflRoster { id } }`

type RestResult = {
  url: string
  status: number
  ok: boolean
}

type GraphqlResult = {
  ok: boolean
  status: number
  count: number
  endpoint: string
  error?: string
}

type RiProbePayload = {
  ok: boolean
  sport: string
  dataType: string
  rest: {
    candidatesTested: number
    successes: number
    results: RestResult[]
  }
  graphql: GraphqlResult
  hints: {
    tokenConfigured: boolean
    restBaseConfigured?: boolean
    graphqlEndpointConfigured?: boolean
  }
  generatedAt: number
}

export async function GET(req: Request): Promise<NextResponse<RiProbePayload | { ok: boolean; error: string }>> {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.res as unknown as NextResponse<{ ok: boolean; error: string }>

  const token = process.env.ROLLING_INSIGHTS_RSC_TOKEN
  if (!token) {
    return NextResponse.json({ ok: false, error: "ROLLING_INSIGHTS_RSC_TOKEN is not configured" }, { status: 400 })
  }

  const url = new URL(req.url)
  const sport = (url.searchParams.get("sport") ?? "nfl").toUpperCase()
  const dataType = url.searchParams.get("dataType") ?? "players"
  const graphqlEndpoint =
    url.searchParams.get("graphql") ?? process.env.ROLLING_INSIGHTS_GRAPHQL_URL ?? ""
  const restBase =
    url.searchParams.get("bases") ?? process.env.ROLLING_INSIGHTS_REST_BASE_URL ?? ""

  const restCandidates: string[] = restBase
    ? [`${restBase}/${sport.toLowerCase()}/${dataType}`]
    : []

  const restResults: RestResult[] = []
  for (const candidateUrl of restCandidates) {
    try {
      const res = await fetch(candidateUrl, {
        headers: { Authorization: `Bearer ${token}` },
      })
      restResults.push({ url: candidateUrl, status: res.status, ok: res.ok })
    } catch (e) {
      restResults.push({ url: candidateUrl, status: 0, ok: false })
    }
  }

  let graphqlResult: GraphqlResult = {
    ok: false,
    status: 0,
    count: 0,
    endpoint: graphqlEndpoint,
    error: "No graphql endpoint configured",
  }

  if (graphqlEndpoint) {
    try {
      const res = await fetch(graphqlEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: NFL_GRAPHQL_QUERY }),
      })
      const json = (await res.json()) as { data?: Record<string, unknown[]> }
      const firstKey = json.data ? Object.keys(json.data)[0] : null
      const count = firstKey && Array.isArray(json.data?.[firstKey]) ? (json.data![firstKey] as unknown[]).length : 0
      graphqlResult = {
        ok: res.ok,
        status: res.status,
        count,
        endpoint: graphqlEndpoint,
      }
    } catch (e) {
      graphqlResult = {
        ok: false,
        status: 0,
        count: 0,
        endpoint: graphqlEndpoint,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  const payload: RiProbePayload = {
    ok: true,
    sport,
    dataType,
    rest: {
      candidatesTested: restResults.length,
      successes: restResults.filter((r) => r.ok).length,
      results: restResults,
    },
    graphql: graphqlResult,
    hints: {
      tokenConfigured: Boolean(token),
      restBaseConfigured: Boolean(restBase),
      graphqlEndpointConfigured: Boolean(graphqlEndpoint),
    },
    generatedAt: Date.now(),
  }

  return NextResponse.json(payload)
}
