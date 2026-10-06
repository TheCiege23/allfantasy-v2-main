import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import { reconcileLeagueTasks,readLeagueTasks } from '@/lib/commissioner-workspace/taskStore'
export const dynamic='force-dynamic'
async function handle(req:Request){
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null,userId=session?.user?.id
  if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401})
  const leagueId=new URL(req.url).searchParams.get('league')??''
  try{await assertCommissioner(leagueId,userId)}catch{return NextResponse.json({error:'Commissioner only'},{status:403})}
  if(req.method==='GET'){
    await reconcileLeagueTasks(leagueId)
    return NextResponse.json({tasks:(await readLeagueTasks(leagueId)).filter(t=>t.sourceKey.startsWith('operational:')),checkedAt:new Date().toISOString()},{headers:{'Cache-Control':'private, no-store'}})
  }
  let body:Record<string,unknown>
  try{body=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
  const statuses=['open','in_progress','waiting_on_manager','completed','archived']
  if(typeof body.id!=='string'||typeof body.expectedStatus!=='string'||typeof body.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(body.expectedUpdatedAt))||typeof body.status!=='string'||!statuses.includes(body.status))return NextResponse.json({error:'Invalid task update'},{status:400})
  const updated=await prisma.$transaction(async tx=>{
    const count=await tx.commissionerWorkspaceTask.updateMany({where:{id:body.id as string,leagueId,status:body.expectedStatus as string,updatedAt:new Date(body.expectedUpdatedAt as string),sourceKey:{startsWith:'operational:'}},data:{status:body.status as string,resolvedAt:body.status==='completed'?new Date():null}})
    if(count.count!==1)return false
    await tx.leagueAuditLog.create({data:{leagueId,userId,actionType:'workspace.task_status_changed',entityType:'workspace_task',entityId:body.id as string,beforeState:{status:body.expectedStatus as string},afterState:{status:body.status as string}}})
    return true
  })
  return updated?NextResponse.json({updated:true}):NextResponse.json({error:'Task changed. Reload the queue.'},{status:409})
}
export const GET=handle,PATCH=handle
