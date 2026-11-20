import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { reconcileCutover } from '@/lib/league-import/fantrax/reconcileCutover'

export const maxDuration = 240

export async function POST(req:Request,{params}:{params:Promise<{leagueId:string}>}) {
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}} | null
  const actor=session?.user?.id
  if(!actor)return NextResponse.json({error:'Sign in to verify this period.'},{status:401})
  const {leagueId}=await params
  try { await assertCommissionerAccess(leagueId,actor,'league') }
  catch { return NextResponse.json({error:'Commissioner access required.'},{status:403}) }
  if(!req.body || !req.headers.get('content-type')?.startsWith('text/csv'))return NextResponse.json({error:'Choose a dated CSV file.'},{status:415})
  const reader=req.body.getReader(),chunks:Uint8Array[]=[]
  let size=0
  try{
    while(true){
      const {done,value}=await reader.read()
      if(done)break
      size+=value.length
      if(size>12_000_000){await reader.cancel();return NextResponse.json({error:'Choose a file under 12 MB.'},{status:413})}
      chunks.push(value)
    }
    const result=await reconcileCutover(leagueId,actor,Buffer.concat(chunks).toString('utf8'))
    return NextResponse.json(result)
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Period verification is pending.'},{status:409})}
}
