import { env } from 'cloudflare:workers';
import { teamApi } from '../../../lib/team-service.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return teamApi(request,env.DB);}
export async function POST(request:Request){return teamApi(request,env.DB);}
