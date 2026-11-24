import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function checkHealth(address='http://127.0.0.1:3100/health',{fetchImpl=fetch,timeoutMs=8000}={}){
  try{
    const url=new URL(address);
    if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/health'||url.search||url.hash)return false;
    const response=await fetchImpl(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeoutMs)});
    if(response.status!==200)return false;
    const body=await response.json();
    return body?.status==='ok';
  }catch{return false}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!await checkHealth(process.argv[2]))process.exitCode=1;
}
