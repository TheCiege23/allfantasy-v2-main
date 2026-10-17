import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isOffensiveUsername } from "@/lib/moderation/offensiveName"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeUsername(u: string) {
  return u.trim().replace(/[^A-Za-z0-9_]/g, "")
}

function isValidUsername(username: string): boolean {
  return username.length >= 3 && username.length <= 30 && /^[A-Za-z0-9_]+$/.test(username) && !isOffensiveUsername(username)
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const base = normalizeUsername(searchParams?.get("base") || searchParams?.get("username") || "")

  if (!base || base.length < 2) {
    return NextResponse.json({ ok: true, suggestion: null })
  }

  const candidates: string[] = []
  const stem = base.slice(0, 26)
  for (let i = 1; i <= 99; i++) {
    const s = `${stem}_${i}`
    if (s.length <= 30) candidates.push(s)
  }
  if ((stem + "2").length <= 30) candidates.push(stem + "2")
  if ((stem + "42").length <= 30) candidates.push(stem + "42")
  if ((base + "af").length <= 30) candidates.push(base + "af")

  for (const candidate of candidates) {
    if (!isValidUsername(candidate)) continue
    const existing = await prisma.appUser.findFirst({
      where: { username: { equals: candidate, mode: "insensitive" } },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ ok: true, suggestion: candidate })
    }
  }

  return NextResponse.json({ ok: true, suggestion: null })
}

