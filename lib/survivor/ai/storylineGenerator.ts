/**
 * AF Commissioner Subscription — Survivor episode / season narratives.
 */

import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'
import type { NextResponse } from 'next/server'

export type SurvivorStoryline = {
  title: string
  body: string
  week?: number
}

export async function generateEpisodeRecap(
  leagueId: string,
  week: number,
): Promise<SurvivorStoryline | NextResponse> {
  const gate = await requireAfSub()
  if (typeof gate !== 'string') return gate
  return {
    title: `AllFantasy Survivor — Week ${week}`,
    body: 'Episode recap will be generated from tribe results, challenges, and Elimination Council once events are logged.',
    week,
  }
}

export async function generateBetrayalArc(
  leagueId: string,
  councilId: string,
): Promise<SurvivorStoryline | NextResponse> {
  const gate = await requireAfSub()
  if (typeof gate !== 'string') return gate
  return {
    title: `The Blindside — council ${councilId.slice(0, 8)}`,
    body: 'Narrative from vote reveal + relationships (AI).',
  }
}

export async function generateRivalryArc(
  leagueId: string,
  player1Id: string,
  player2Id: string,
): Promise<SurvivorStoryline | NextResponse> {
  const gate = await requireAfSub()
  if (typeof gate !== 'string') return gate
  return {
    title: `${player1Id.slice(0, 6)} vs ${player2Id.slice(0, 6)}`,
    body: 'Rivalry arc when cross-vote pattern is detected.',
  }
}

export async function generateFinaleRecap(leagueId: string): Promise<SurvivorStoryline | NextResponse> {
  const gate = await requireAfSub()
  if (typeof gate !== 'string') return gate
  return {
    title: 'Season retrospective',
    body: 'Full-season story when finale completes.',
  }
}
