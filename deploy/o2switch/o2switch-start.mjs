import {readFileSync,existsSync,statSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";
const dir=dirname(fileURLToPath(import.meta.url));
const envPath=join(dir,"..",".env");
if(existsSync(envPath)){
  for(const line of readFileSync(envPath,"utf8").split(/\r?\n/)){
    const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");
  }
  // .env contient SOCLE_SESSION_SECRET : refus de demarrer si lisible au-dela du proprietaire.
  if(process.platform!=="win32"){
    const mode=statSync(envPath).mode&0o777;
    if(mode&0o044)throw Error(`OUVRANE: ${envPath} est lisible par le groupe ou les autres (mode ${mode.toString(8)}); faites chmod 600 avant de demarrer.`);
  }
}
await import("./v5-start.mjs");
