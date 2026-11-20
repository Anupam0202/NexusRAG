import assert from "node:assert/strict";
import {access,mkdtemp,writeFile,rm} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {startLocalWorker} from "./local-worker-harness.mjs";

const frontend=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const cwd=process.cwd(),sentinel="synthetic-parent-only";
const previousWriteLogs=process.env.WRANGLER_WRITE_LOGS;
process.env.NEXUS_LOCAL_FIXTURE_PARENT_SENTINEL=sentinel;
process.env.WRANGLER_WRITE_LOGS="true";
const directory=await mkdtemp(join(tmpdir(),"nexusrag-owned-lifecycle-"));
const entry=join(directory,"entry.mjs"),configPath=join(directory,"wrangler.json");
await writeFile(entry,'export default {fetch(){return new Response("synthetic ordinary response");}};');
await writeFile(configPath,JSON.stringify({name:"nexusrag-owned-lifecycle",main:entry,compatibility_date:"2026-09-20"}));
const markers=[];
for(const failOrdinaryCallback of [false,true]) {
  let runtime,observed;
  try {
    runtime=await startLocalWorker({frontend,directory,configPath});
    assert.equal(process.env.NEXUS_LOCAL_FIXTURE_PARENT_SENTINEL,undefined);
    assert.equal(process.env.WRANGLER_WRITE_LOGS,"false");
    assert.equal(process.cwd(),directory);
    assert.equal(await(await fetch(new URL("/ordinary",runtime.url))).text(),"synthetic ordinary response");
    markers.push(runtime.marker);
    if(failOrdinaryCallback)throw Error("ordinary fixture callback failed");
  }catch(error){observed=error;}
  finally{if(runtime){const first=runtime.close();assert.equal(runtime.close(),first);await first;}}
  assert.equal(observed?.message,failOrdinaryCallback?"ordinary fixture callback failed":undefined);
  assert.equal(process.env.NEXUS_LOCAL_FIXTURE_PARENT_SENTINEL,sentinel);
  assert.equal(process.env.WRANGLER_WRITE_LOGS,"true");
  assert.equal(process.cwd(),cwd);
  await assert.rejects(access(join(directory,".config/.wrangler/logs")),{code:"ENOENT"});
  assert.ok(runtime);
  let ownResponse=false;
  try{ownResponse=(await(await fetch(new URL(runtime.probePath,runtime.url),{signal:AbortSignal.timeout(1000)})).text())===runtime.marker;}
  catch{/* Connection refusal after close is expected; the exact port must still rebind below. */}
  assert.equal(ownResponse,false);
  const released=createServer();
  await new Promise((resolve,reject)=>{released.once("error",reject);released.listen(runtime.port,"127.0.0.1",resolve);});
  await new Promise(resolve=>released.close(resolve));
}
assert.notEqual(markers[0],markers[1]);
delete process.env.NEXUS_LOCAL_FIXTURE_PARENT_SENTINEL;
if(previousWriteLogs===undefined)delete process.env.WRANGLER_WRITE_LOGS;
else process.env.WRANGLER_WRITE_LOGS=previousWriteLogs;
await rm(directory,{recursive:true,force:true});
await assert.rejects(access(directory),{code:"ENOENT"});
console.log("ACTUAL_LOCAL_WORKER_LIFECYCLE_PASS cases=2 ordinary_callback_failure_cleanup=true repeated_close_single_promise=true owned_port_rebind=true disk_logger_disabled=true parent_logging_restored=true owned_directory_removed=true");
