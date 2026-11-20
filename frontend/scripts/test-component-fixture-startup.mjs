import assert from "node:assert/strict";
import {spawn,execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtemp,readFile} from "node:fs/promises";
import {createServer,connect} from "node:net";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {chromium} from "playwright";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),run=promisify(execFile);
const cache=await mkdtemp(join(tmpdir(),"nexusrag-fixture-cold-")),reports=[],lifecycles=[];
const browser=await chromium.launch({headless:true});
async function freePort(){
  const server=createServer();await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const port=server.address().port;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return port;
}
async function closedPort(port){
  await new Promise((resolve,reject)=>{
    const socket=connect({host:"127.0.0.1",port});socket.setTimeout(2000);
    socket.once("connect",()=>{socket.destroy();reject(new Error("Owned fixture listener remains"));});
    socket.once("error",error=>error.code==="ECONNREFUSED"?resolve():reject(error));
    socket.once("timeout",()=>{socket.destroy();reject(new Error("Owned listener shutdown is unconfirmed"));});
  });
}
async function phase(kind){
  const script=resolve(root,"scripts",kind==="research"?"research-browser-fixture.mjs":"summary-browser-fixture.mjs"),port=await freePort();
  const child=spawn(process.execPath,[script,String(port)],{cwd:root,windowsHide:true,env:{...process.env,NEXUSRAG_FIXTURE_CACHE_DIR:cache},stdio:["ignore","pipe","pipe"]});
  const closed=new Promise(resolve=>child.once("close",resolve)),output=[];let spawnError,identity;
  child.once("error",error=>{spawnError=error;});child.stdout.on("data",data=>output.push(data));child.stderr.on("data",data=>output.push(data));
  const fingerprint=async()=>JSON.parse((await run("powershell.exe",["-NoProfile","-Command",`Get-CimInstance Win32_Process -Filter "ProcessId=${child.pid}" | Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress`],{windowsHide:true})).stdout);
  try{
    if(process.platform==="win32")identity=await fingerprint();
    const until=Date.now()+30000;let ready=false;
    while(Date.now()<until){
      if(spawnError)throw spawnError;if(child.exitCode!==null)throw Error("Owned fixture exited before readiness");
      try{const response=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(1500)});if(response.status===200){ready=true;break;}}catch{
        // The owned listener may not be bound yet; the readiness deadline still applies.
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready,"Fixture HTTP readiness failed");
    const observe=async(index)=>{
      const started=Date.now(),deadline=started+30000,remaining=()=>Math.max(1,deadline-Date.now());
      const context=await browser.newContext({viewport:index?{width:393,height:852}:{width:1280,height:720}}),page=await context.newPage();
      const events=[],navigations=[];let observing=true;
      page.on("pageerror",error=>{if(observing)events.push({kind:"pageerror",message:error.message});});
      page.on("requestfailed",request=>{if(observing)events.push({kind:"requestfailed",path:new URL(request.url()).pathname,error:request.failure()?.errorText});});
      page.on("response",response=>{if(observing&&response.status()>=400)events.push({kind:"http",path:new URL(response.url()).pathname,status:response.status()});});
      page.on("framenavigated",frame=>{if(observing&&frame===page.mainFrame()&&frame.url().startsWith(`http://127.0.0.1:${port}/`))navigations.push(new URL(frame.url()).pathname);});
      try{
        await page.goto(`http://127.0.0.1:${port}/`,{timeout:remaining()});
        if(kind==="chat"){
          await page.getByRole("button",{name:"Selected",exact:true}).click({timeout:remaining()});
          await page.getByRole("button",{name:"Filters",exact:true}).click({timeout:remaining()});
          await page.getByRole("checkbox",{name:"Resume.txt",exact:true}).waitFor({state:"visible",timeout:remaining()});
        }else{
          await page.getByRole("combobox",{name:"Mode",exact:true}).waitFor({state:"visible",timeout:remaining()});
          await page.getByRole("textbox",{name:"Question",exact:true}).fill("Synthetic startup only; no execution.",{timeout:remaining()});
        }
        assert.ok(Date.now()<=deadline,"Ordinary startup exceeded30seconds");
        assert.deepEqual(events,[],"Startup assets must not be invalidated or fail while the user opens the fixture");
        assert.equal(navigations.length,1,"Initial interaction must not be replaced by a dependency-optimizer reload");
        return {kind,index,elapsed_ms:Date.now()-started,navigations:navigations.length,failed_requests:0};
      }catch(error){console.error(JSON.stringify({kind,index,events,navigations,error:error.message}));throw error;}
      finally{observing=false;await context.close();}
    };
    reports.push(...await Promise.all([observe(0),observe(1)]));
  }finally{
    if(child.exitCode===null&&child.signalCode===null){
      if(process.platform==="win32"){
        const current=await fingerprint();assert.ok(identity&&current.ProcessId===identity.ProcessId&&current.CreationDate===identity.CreationDate&&current.CommandLine?.includes(script),"Owned fixture identity changed");
        await run("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true});
      }else child.kill("SIGTERM");
    }
    await closed;await closedPort(port);
    lifecycles.push({kind,owned_pid:child.pid,port,stopped:true,source_sha256:createHash("sha256").update(await readFile(script)).digest("hex")});
    if(child.exitCode!==0&&child.signalCode===null&&process.platform!=="win32")console.error(Buffer.concat(output).toString());
  }
}
try{await phase("research");await phase("chat");}
finally{await browser.close();console.log(JSON.stringify({marker:"COMPONENT_FIXTURE_OWNED_LISTENERS_RELEASED",lifecycles,provider_processing:false}));}
assert.equal(reports.length,4);
console.log(JSON.stringify({marker:"COMPONENT_FIXTURE_COLD_START_PASS",cache_was_new:true,shared_cache_switch:true,contexts:4,reports,provider_processing:false,hosted_acceptance:false}));
