import {expect,test,type Page} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {selectWorkspaceReviewer} from "./research-review-helpers";
import type {ResearchRun} from "../lib/research-run";
import type {ResearchPlanRecord} from "../lib/research-plan";

test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE,"Requires actual pages/Gateway/executor with controlled synthetic peers,not hosted identity or model quality.");
test.use({trace:"retain-on-failure",screenshot:"only-on-failure"});
async function fillPlan(page:Page,question:string,subquestions:string[]=[],maximum=false) {
  await page.getByRole("combobox",{name:"Mode",exact:true}).selectOption("PRODUCT_PASSPORT");
  for(const [name,value] of Object.entries({"Product identifier":maximum?"X".repeat(128):"P-42",
    "Product name":maximum?"\u{1f4ca}".repeat(256):"Synthetic sensor","Product version":maximum?"v".repeat(128):"2.1",
    "Supplier":maximum?"\u{1f4ca}".repeat(256):"Example Components"}))await page.getByRole("textbox",{name,exact:true}).fill(value);
  await page.getByRole("textbox",{name:"Question",exact:true}).fill(question);
  await page.getByRole("textbox",{name:"Subquestions",exact:true}).fill(subquestions.join("\n"));
  await page.getByRole("textbox",{name:"Completion criteria",exact:true}).fill("Independently review product version,source dates,qualifications and applicability;not certification.");
}
async function start(page:Page,question:string,subquestions:string[]=[],maximum=false) {
  await fillPlan(page,question,subquestions,maximum);
  if(maximum){
    await page.getByRole("searchbox",{name:"Find private documents",exact:true}).fill("Synthetic product evidence");
    await page.getByRole("checkbox",{name:"Select matching documents",exact:true}).check();
    await expect(page.getByRole("region",{name:"Available private documents",exact:true}).getByRole("checkbox",{checked:true})).toHaveCount(60);
  }else for(let i=1;i<=2;i++)await page.getByRole("checkbox",{name:`Synthetic product evidence ${i}.txt`,exact:true}).check();
  await page.getByRole("button",{name:"Save plan",exact:true}).click();
  await page.getByRole("checkbox",{name:/I confirm that all questions/}).check();
  await page.getByRole("button",{name:"Start research",exact:true}).click();
}
for(const theme of ["light","dark"])test(`${theme}: execute declared-product criteria,inspect evidence,copy,reload and independently review a Finding`,async({page},info)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const actor=randomUUID(),reviewer=randomUUID(),question=`Synthetic multi-query passport ${randomUUID()}`;
  let completed:ResearchRun|undefined;const responseErrors:string[]=[];
  page.on("response",async response=>{
    if(!/\/api\/v2\/research\/plans\/[^/]+\/runs\/[^/?]+(?:\?|$)/.test(response.url())||response.status()!==200)return;
    try{const value=await response.json();if(value.state==="completed"&&value.results?.length)completed=value;}catch(error){responseErrors.push(String(error));}
  });
  await page.addInitScript(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async(text:string)=>{
    (window as unknown as {syntheticCopiedText:string}).syntheticCopiedText=text;
  }}}));
  await page.goto(`/?actor=${actor}&reviewer=${reviewer}&theme=${theme}`);
  await start(page,question,Array.from({length:12},(_,i)=>`Synthetic multi-query passport criterion ${i+1}`));
  const reports=page.getByRole("region",{name:"Product passport claims",exact:true});
  for(let i=0;i<13;i++)await expect(reports.nth(i)).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("13 of 13 questions saved");
  await expect(reports.last()).toContainText("applicability not verified");await expect(reports.last()).toContainText("Later reports and amendments not established.");
  await reports.last().getByRole("link",{name:"[S1]",exact:true}).click();
  const sourceId=await page.locator("details:focus").getAttribute("id");expect(sourceId).not.toBeNull();
  const source=page.locator(`details[id="${sourceId}"]`);await source.locator("summary").click();await expect(source.getByText(/SHA256/)).toBeVisible();
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();
  completed=undefined;await page.getByRole("button",{name:/Open execution/}).click();await expect.poll(()=>completed?.state).toBe("completed");
  await page.getByRole("button",{name:"Copy results",exact:true}).click();await expect(page.getByRole("button",{name:"Copied",exact:true})).toBeVisible();
  const copied=await page.evaluate(()=>(window as unknown as {syntheticCopiedText:string}).syntheticCopiedText);
  expect(copied).toContain(JSON.stringify(completed!.results[12].passport,null,2));
  const article=page.getByRole("article").filter({has:page.getByRole("heading",{name:"Synthetic multi-query passport criterion 12",exact:true})});
  const save=article.getByRole("button",{name:"Save as finding",exact:true});await save.click();await expect(page.getByRole("alert")).toContainText("not confirmed");await save.click();
  const finding=article.getByRole("link",{name:"Open saved finding",exact:true}),href=await finding.getAttribute("href");await finding.click();
  await expect(page.getByRole("region",{name:"Product passport claims",exact:true})).toContainText("proposed asserted by supplier");
  await selectWorkspaceReviewer(page,reviewer);await page.getByRole("button",{name:"Share for review",exact:true}).click();
  await page.goto(`${href}&actor=${reviewer}&theme=${theme}`);await page.getByRole("textbox",{name:"Review comment",exact:true}).fill("Reviewed exact product source wording;applicability remains unverified.");
  await page.getByRole("button",{name:"Approve revision",exact:true}).click();await page.reload();
  await expect(page.getByText("approved: Reviewed exact product source wording;applicability remains unverified.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Export JSON-LD & receipt",exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);expect(responseErrors).toEqual([]);
  await page.screenshot({path:info.outputPath(`passport-reviewed-${theme}.png`)});
});
test("interrupted Passport resumes with saved claims rather than a duplicate execution",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await start(page,`Synthetic passport recovery ${randomUUID()}`,[`Synthetic interrupted passport ${randomUUID()}`]);
  await expect(page.getByRole("status").filter({hasText:"Execution interrupted"})).toContainText("1 of 2 questions saved");
  await expect(page.getByRole("region",{name:"Product passport claims",exact:true})).toHaveCount(1);
  await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 questions saved");
  await expect(page.getByRole("region",{name:"Product passport claims",exact:true})).toHaveCount(2);
  await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
});
test("queued Passport cancellation resumes the same execution and declared version",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await start(page,`Synthetic cancel passport ${randomUUID()}`,["Inspect source qualifications."]);
  await page.getByRole("button",{name:"Cancel execution",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution cancelled"})).toContainText("0 of 2 questions saved");
  await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
  await expect(page.getByRole("region",{name:"Product passport claims",exact:true}).first()).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 questions saved");
  await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
  await expect(page.getByRole("region",{name:"Product passport claims",exact:true}).last()).toContainText("2.1");
});
test("empty Passport claims abstain honestly rather than certifying a clean product",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await start(page,`Synthetic empty passport ${randomUUID()}`);
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("1 of 1 questions saved");
  await expect(page.getByRole("region",{name:"Product passport claims",exact:true})).toContainText("0 proposed claims");
  await expect(page.getByText(/No source-anchored claims were returned from the bounded excerpts/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Save as finding",exact:true})).toBeDisabled();
});
test("maximum Passport fields and Unicode declared identity survive reload at320pixels",async({page},info)=>{
  await page.setViewportSize({width:320,height:900});const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const question=`Synthetic multi-query maximum-field passport ${randomUUID()}`;await page.goto(`/?actor=${randomUUID()}&theme=dark`);
  await start(page,question,Array.from({length:12},(_,i)=>`Synthetic multi-query maximum-field passport criterion ${i+1}`),true);
  const reports=page.getByRole("region",{name:"Product passport claims",exact:true});
  for(let i=0;i<13;i++)await expect(reports.nth(i)).toBeVisible();
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();await page.getByRole("button",{name:/Open execution/}).click();
  await expect(reports).toHaveCount(13);const report=reports.last();
  await expect(report.getByRole("heading",{name:/^Synthetic property/})).toHaveCount(12);
  await expect(report.getByText("Qualifications and applicability",{exact:true})).toHaveCount(12);
  await report.getByText("Consulted source scope (60)",{exact:true}).click();await expect(report.getByText("Synthetic product evidence 60.txt",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  await report.getByText("Unresolved product evidence gaps",{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath("passport-maximum-fields.png")});
});
test("all sixty Passport sources remain individually selectable and save as one exact durable scope",async({page})=>{
  const question=`Synthetic individual maximum-source passport ${randomUUID()}`;await page.goto(`/?actor=${randomUUID()}`);
  await fillPlan(page,question,[],true);
  for(let i=1;i<=60;i++)await page.getByRole("checkbox",{name:`Synthetic product evidence ${i}.txt`,exact:true}).check();
  await expect(page.getByRole("region",{name:"Available private documents",exact:true}).getByRole("checkbox",{checked:true})).toHaveCount(60);
  const response=page.waitForResponse(value=>new URL(value.url()).pathname==="/api/v2/research/plans"&&value.request().method()==="POST");
  await page.getByRole("button",{name:"Save plan",exact:true}).click();
  const stored=await(await response).json() as ResearchPlanRecord;
  expect(stored.plan.private_source_ids).toHaveLength(60);expect(new Set(stored.plan.private_source_ids).size).toBe(60);
  await expect(page.getByRole("region",{name:"Stored research plan",exact:true}).getByText(question,{exact:true})).toBeVisible();
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();
  await page.getByRole("button",{name:"Copy to a new plan",exact:true}).click();
  await expect(page.getByRole("region",{name:"Available private documents",exact:true}).getByRole("checkbox",{checked:true})).toHaveCount(60);
});
