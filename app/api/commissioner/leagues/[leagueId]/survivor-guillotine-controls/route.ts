import {NextRequest,NextResponse} from 'next/server'
import {getServerSession} from 'next-auth'
import {authOptions} from '@/lib/auth'
import {RedraftControlsError} from '@/lib/survivor-guillotine/commissionerUtils'
import {loadSGCommissioner,saveSGCommissioner} from '@/lib/survivor-guillotine/commissionerService'
export const dynamic='force-dynamic'
type Context={params:Promise<{leagueId:string}>}
async function handle(req:NextRequest,ctx:Context,save:boolean){
 const session=await getServerSession(authOptions);if(!session?.user?.id)return NextResponse.json({error:'Unauthorized'},{status:401})
 try{const {leagueId}=await ctx.params;const body=save?await req.json():null;if(save&&(!body||typeof body!=='object'||Array.isArray(body)))throw new RedraftControlsError('Invalid request.')
 return NextResponse.json(save?await saveSGCommissioner(leagueId,session.user.id,body):await loadSGCommissioner(leagueId,session.user.id))
 }catch(e){if(e instanceof Response)return e;return NextResponse.json({error:e instanceof RedraftControlsError?e.message:'Unable to load or save commissioner controls.'},{status:e instanceof RedraftControlsError?e.status:e instanceof SyntaxError?400:500})}
}
export const GET=(req:NextRequest,ctx:Context)=>handle(req,ctx,false)
export const PUT=(req:NextRequest,ctx:Context)=>handle(req,ctx,true)
