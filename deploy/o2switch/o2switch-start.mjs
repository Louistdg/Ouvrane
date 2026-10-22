import {readFileSync,existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";
const dir=dirname(fileURLToPath(import.meta.url));
const envPath=join(dir,"..",".env");
if(existsSync(envPath)){
  for(const line of readFileSync(envPath,"utf8").split(/\r?\n/)){
    const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");
  }
}
await import("./v5-start.mjs");
