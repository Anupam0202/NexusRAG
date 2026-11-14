import {expect,test,type Page,type Locator} from "@playwright/test";
import {readFile} from "node:fs/promises";
// SQL durability and record authority are separately verified by real PostgreSQL.
// This browser executes real UI/client/Gateway with controlled SQL projections.
test.skip(!process.env.E2E_OBLIGATION_SQL_FIXTURE,"Requires actual disposable-SQL projections; no hosted/private-user acceptance.");
test.describe.configure({mode:"serial"});
test.use({trace:"retain-on-failure",screenshot:"only-on-failure"});
let controlObservations:Array<Record<string,unknown>>=[];
test.beforeEach(()=>{controlObservations=[];});
test.afterEach(async({page},info)=>{await info.attach("controlled-window-observations",{body:JSON.stringify(controlObservations,null,2),contentType:"application/json"});
  if(info.status!=="passed")await info.attach("controlled-failed-page-url",{body:page.url(),contentType:"text/plain"});});
async function waitForExistingWindow(page:Page){await expect.poll(async()=>{
  const start=Date.now(),observation=`window-${start}-${controlObservations.length}`;
  try{const response=await page.request.get("/__fixture__/quota-window",{headers:{"x-fixture-observation-id":observation}}),value=await response.json();
    controlObservations.push({observation,started_at_utc:new Date(start).toISOString(),elapsed_ms:Date.now()-start,status:response.status(),remaining_ms:value.remaining_ms});return value.remaining_ms;
  }catch(error){controlObservations.push({observation,started_at_utc:new Date(start).toISOString(),elapsed_ms:Date.now()-start,error:error instanceof Error?error.message:"Control request failed"});throw error;}
},{timeout:65_000,intervals:[2_000]}).toBe(0);}
async function fillPolicy(panel:Locator,policy:{decision:string;basis:string;rationale:string;evidence_reference:string;attribution:string;duties:string[];review_by:string|null}){
  await panel.getByRole("checkbox",{name:"Select all versions with retained hashes",exact:true}).check();
  await panel.getByRole("combobox",{name:"Serving decision",exact:true}).selectOption(policy.decision);await panel.getByRole("combobox",{name:"Serving rights basis",exact:true}).selectOption(policy.basis);
  await panel.getByLabel("Serving review rationale",{exact:true}).fill(policy.rationale);await panel.getByLabel("Serving rights evidence",{exact:true}).fill(policy.evidence_reference);
  await panel.getByLabel("Serving attribution",{exact:true}).fill(policy.attribution);await panel.getByLabel("Serving duties (one per line)",{exact:true}).fill(policy.duties.join("\n"));
  if(policy.review_by!==null){
    const instant=new Date(policy.review_by).toISOString();
    // Native datetime-local canonicalizes zero fractions/seconds. Playwright
    // rejects a noncanonical fill even when it names the same exact instant.
    const local=instant.slice(0,-1).replace(/\.000$/,"").replace(/(\.\d*?)0+$/,"$1").replace(/:00$/,"");
    expect(new Date(`${local}Z`).toISOString()).toBe(instant); // Browser timezone is explicitly UTC.
    await panel.getByLabel("Serving review by",{exact:true}).fill(local);
  }
}
async function recordWithLostReply(panel:Locator){const save=panel.getByRole("button",{name:"Save serving rights review",exact:true});await save.click();
  await expect(panel.getByRole("alert")).toBeVisible();await expect(panel.getByText("The latest serving decision is unconfirmed. Retry the same decision or reload current rights.",{exact:true})).toBeVisible();
  await expect(panel.getByRole("status").filter({hasText:"Serving decision recorded"})).toHaveCount(0);await save.click();await expect(panel.getByRole("status").filter({hasText:"Serving decision recorded"})).toBeVisible();}
for(const [theme,width] of [["light",1280],["dark",320]] as const)test(`${theme}: independently reviewed API and MCP rights, exact retry, current withholding and rate window at ${width}px`,async({page},info)=>{
  test.setTimeout(240_000);
  const fixture=JSON.parse(await readFile(process.env.E2E_OBLIGATION_SQL_FIXTURE!,"utf8")),errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));await page.setViewportSize({width,height:900});expect((await page.request.post("/__fixture__/reset")).status()).toBe(200);await waitForExistingWindow(page);
  const path=`/evidence-api?finding=${fixture.finding.id}&revision=${fixture.finding.revision}&actor=${fixture.actor_id}&theme=${theme}`;
  await page.goto(path);await expect(page.getByRole("heading",{name:"Evidence API",exact:true})).toBeVisible();
  const selected=page.getByRole("region",{name:"Selected obligation evidence",exact:true}),rights=selected.getByRole("region",{name:"API and MCP serving rights",exact:true});
  await expect(selected.getByText(/Content is withheld/)).toBeVisible();await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toHaveCount(0);
  await rights.getByRole("button",{name:"Load REST API rights",exact:true}).click();await expect(rights.getByRole("checkbox",{name:"Select all versions with retained hashes",exact:true})).toBeVisible();
  await expect(rights.getByRole("list",{name:"Source serving decisions",exact:true}).getByRole("listitem")).toHaveCount(50);
  await fillPolicy(rights,fixture.review_command_api.policy);await recordWithLostReply(rights);
  await selected.getByRole("button",{name:"Recheck selected evidence",exact:true}).click();await expect(selected.getByRole("heading",{name:fixture.detail_api.title,exact:true})).toBeVisible();
  const evidence=selected.getByRole("region",{name:"Original source evidence",exact:true});await expect(evidence.getByRole("link",{name:"Inspect source document",exact:true})).toHaveCount(50);
  await expect(selected.getByRole("region",{name:"Obligation candidates",exact:true})).toContainText("12 candidates / independent review required / applicability undetermined");
  await selected.getByText("Serving attribution and duties (50 source versions)",{exact:true}).click();await expect(selected.getByText(fixture.review_command_api.policy.attribution,{exact:true})).toHaveCount(50);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`obligation-ready-${theme}-${width}.png`)});
  // Keyboard activation follows an exact citation to its full retained original.
  const cite=selected.locator(`a[href="#obligation-${fixture.finding.id}-S1"]`).first();await cite.focus();await page.keyboard.press("Enter");await expect.poll(()=>page.evaluate(()=>location.hash)).toBe(`#obligation-${fixture.finding.id}-S1`);
  await expect(selected.locator(`#obligation-${fixture.finding.id}-S1`)).toBeFocused();
  await page.reload();await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toBeVisible();
  await page.getByRole("combobox",{name:"Reader action",exact:true}).selectOption("SERVE_MCP");await expect(selected.getByText(/Content is withheld/)).toBeVisible();
  await rights.getByRole("button",{name:"Load Custom MCP rights",exact:true}).click();await fillPolicy(rights,fixture.review_command_mcp.policy);await recordWithLostReply(rights);
  await selected.getByRole("button",{name:"Recheck selected evidence",exact:true}).click();await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toBeVisible();
  // The real SQL fixture captured this branch in a rolled-back lifecycle
  // transaction. An authoritative rights read must immediately invalidate known
  // withdrawn content, before the reader makes any separate detail recheck.
  expect((await page.request.post("/__fixture__/source-lifecycle")).status()).toBe(200);
  await rights.getByRole("button",{name:"Load Custom MCP rights",exact:true}).click();await expect(selected.getByText("Serving rights changed. Recheck this Finding before viewing its content.",{exact:true})).toBeVisible();
  await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toHaveCount(0);await expect(selected.getByRole("region",{name:"Obligation candidates",exact:true})).toHaveCount(0);
  await expect(rights.getByText("WITHDRAWN BY SOURCE LIFECYCLE",{exact:true})).toHaveCount(50);await expect(rights.getByText("Inspect rights decision",{exact:true})).toHaveCount(0);
  await rights.getByRole("combobox",{name:"Serving action",exact:true}).selectOption("SERVE_API");await rights.getByRole("button",{name:"Load REST API rights",exact:true}).click();
  await expect(rights.getByText("WITHDRAWN BY SOURCE LIFECYCLE",{exact:true})).toHaveCount(50);await expect(rights.getByText("Inspect rights decision",{exact:true})).toHaveCount(0);
  expect((await page.request.post("/__fixture__/rollback-source-lifecycle")).status()).toBe(200);
  await selected.getByRole("button",{name:"Recheck selected evidence",exact:true}).click();await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toBeVisible();
  // Exhaust the real unchanged Gateway bucket, without resetting its state.
  let limited=false;for(let count=0;count<65;count++){const response=await page.request.get("/api/v2/obligations?limit=1",{headers:{Authorization:`Bearer synthetic-obligation-browser:${fixture.actor_id}`,"x-workspace-id":fixture.workspace_id}});if(response.status()===429){limited=true;break;}expect(response.status()).toBe(200);}expect(limited).toBe(true);
  await selected.getByRole("button",{name:"Recheck selected evidence",exact:true}).click();await expect(page.getByRole("alert")).toContainText("Per-user request limit reached.");
  await expect(page.getByRole("button",{name:"Retry current request",exact:true})).toBeDisabled();await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toHaveCount(0);
  await waitForExistingWindow(page);await expect(page.getByRole("button",{name:"Retry current request",exact:true})).toBeEnabled();await page.getByRole("button",{name:"Retry current request",exact:true}).click();await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toBeVisible();
  expect((await page.request.post("/__fixture__/review-required")).status()).toBe(200);await selected.getByRole("button",{name:"Recheck selected evidence",exact:true}).click();await expect(selected.getByText(/Content is withheld/)).toBeVisible();await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toHaveCount(0);
  expect((await page.request.post("/__fixture__/review-current")).status()).toBe(200);await selected.getByRole("button",{name:"Recheck selected evidence",exact:true}).click();await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toBeVisible();
  await page.getByRole("combobox",{name:"Reader action",exact:true}).selectOption("SERVE_API");await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toBeVisible();
  await rights.getByRole("button",{name:"Load REST API rights",exact:true}).click();await fillPolicy(rights,fixture.revoke_command_api.policy);await recordWithLostReply(rights);
  await expect(selected.getByText("Serving rights changed. Recheck this Finding before viewing its content.",{exact:true})).toBeVisible();await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toHaveCount(0);
  await selected.getByRole("button",{name:"Recheck selected evidence",exact:true}).click();await expect(selected.getByText(/Content is withheld/)).toBeVisible();
  await page.getByRole("combobox",{name:"Reader action",exact:true}).selectOption("SERVE_MCP");await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toBeVisible();
  expect((await page.request.post("/__fixture__/source-unavailable")).status()).toBe(200);await page.reload();await page.getByRole("combobox",{name:"Reader action",exact:true}).selectOption("SERVE_MCP");await expect(selected.getByText(/Source evidence unavailable/)).toBeVisible();await expect(selected.getByRole("region",{name:"Original source evidence",exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  const summary=await(await page.request.get("/__fixture__/summary")).json();expect(summary).toMatchObject({commits:3,distinct_intents:3,api:"revoked",mcp:"allowed",source_unavailable:true});expect(summary.attempts).toHaveLength(6);
  expect(summary.controlled_sql_lifecycle_branch).toEqual({observed:true,rolled_back:true});
  for(let index=0;index<6;index+=2)expect(summary.attempts[index].key).toBe(summary.attempts[index+1].key);
  await info.attach("controlled-obligation-transport-summary",{body:JSON.stringify(summary,null,2),contentType:"application/json"});await page.screenshot({path:info.outputPath(`obligation-withheld-${theme}-${width}.png`)});
});
