import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

// Standalone fixture processes only: do not inherit account/provider configuration.
export async function startLocalWorker({frontend,directory,configPath}) {
  const require=createRequire(import.meta.url),modulePath=require.resolve("wrangler",{paths:[frontend]});
  const config=JSON.parse(await readFile(configPath,"utf8"));
  const previousDirectory=process.cwd(),previousEnvironment={...process.env};
  const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>
    ["path","systemroot","windir","temp","tmp","comspec"].includes(key.toLowerCase())));
  Object.assign(environment,{HOME:directory,USERPROFILE:directory,WRANGLER_SEND_METRICS:"false",CI:"true"});
  const marker=randomUUID(),probePath=`/__nexus_owned_fixture/${marker}`,entry=join(directory,"owned-runtime-entry.mjs");
  await writeFile(entry,`import worker from ${JSON.stringify(config.main.replaceAll("\\","/"))};
export default {...worker,fetch(request,...args){
 if(new URL(request.url).pathname===${JSON.stringify(probePath)})return new Response(${JSON.stringify(marker)});
 return worker.fetch(request,...args);
}};`);
  const restore=()=>{
    for(const key of Object.keys(process.env))delete process.env[key];
    Object.assign(process.env,previousEnvironment);process.chdir(previousDirectory);
  };
  for(const key of Object.keys(process.env))delete process.env[key];
  Object.assign(process.env,environment);process.chdir(directory);
  let server,closing;
  try {
    const {createTestHarness}=await import(pathToFileURL(modulePath).href);
    server=createTestHarness({root:directory,workers:[{config:{...config,main:entry,
      dev:{ip:"127.0.0.1",port:0,inspector_port:0}}}]});
    const {url}=await server.listen();
    assert.equal(url.hostname,"127.0.0.1");assert.ok(Number(url.port)>0);
    const response=await fetch(new URL(probePath,url),{signal:AbortSignal.timeout(3000)});
    assert.equal(response.status,200);assert.equal(await response.text(),marker);
    return {port:Number(url.port),url,probePath,marker,close(){
      if(!closing)closing=(async()=>{try{await server.close();}finally{restore();}})();
      return closing;
    }};
  }catch(error){
    try{if(server)await server.close();}finally{restore();}
    throw error;
  }
}
