import {expect,test,type Page} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {selectWorkspaceReviewer} from "./research-review-helpers";
import type {ResearchRun} from "../lib/research-run";

test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE,"Requires production pages/Gateway/queue with controlled synthetic peers,not hosted identity or model quality.");
async function start(page:Page,question:string,subquestions:string[]=[],maximum=false) {
  await page.getByRole("combobox",{name:"Mode",exact:true}).selectOption("DUE_DILIGENCE");
  await page.getByRole("textbox",{name:"Question",exact:true}).fill(question);
  await page.getByRole("textbox",{name:"Subquestions",exact:true}).fill(subquestions.join("\n"));
  await page.getByRole("textbox",{name:"Entity scope",exact:true}).fill(maximum?Array.from({length:100},(_,i)=>`Subject ${i+1}`).join("\n"):"Example Works 1\nExample Holdings 2");
  await page.getByRole("textbox",{name:"Completion criteria",exact:true}).fill("Retain precise evidence,qualifications and follow-up gaps for independent review,not a verified identity or adverse decision.");
  for(let i=1;i<=(maximum?60:2);i++)await page.getByRole("checkbox",{name:`Synthetic ${maximum?"capacity diligence":"diligence"} ${i}.txt`,exact:true}).check();
  await page.getByRole("button",{name:"Save plan",exact:true}).click();
  await page.getByRole("checkbox",{name:/I confirm that all questions/}).check();await page.getByRole("button",{name:"Start research",exact:true}).click();
}
for(const theme of ["light","dark"])test(`${theme}: execute diligence criteria,inspect evidence,copy,reload and independently review a Finding`,async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const actor=randomUUID(),reviewer=randomUUID(),question=`Synthetic multi-query diligence ${randomUUID()}`;
  let completed:ResearchRun|undefined;const responseErrors:string[]=[];
  page.on("response",async response=>{
    if(!/\/api\/v2\/research\/plans\/[^/]+\/runs\/[^/?]+(?:\?|$)/.test(response.url())||response.status()!==200)return;
    try{const value=await response.json();if(value.state==="completed"&&value.results?.length)completed=value;}catch(error){responseErrors.push(String(error));}
  });
  await page.addInitScript(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async(text:string)=>{
    (window as unknown as {syntheticCopiedText:string}).syntheticCopiedText=text;
  }}}));
  await page.goto(`/?actor=${actor}&reviewer=${reviewer}&theme=${theme}`);
  await start(page,question,Array.from({length:12},(_,i)=>`Synthetic multi-query diligence criterion ${i+1}`));
  const reports=page.getByRole("region",{name:"Due diligence observations",exact:true});
  for(let i=0;i<13;i++)await expect(reports.nth(i)).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("13 of 13 questions saved");
  let report=reports.last();await expect(report).toContainText("no automatic adverse decision");
  await expect(report).toContainText("later amendments not established");await expect(report).toContainText("identity unresolved");
  await report.getByRole("link",{name:"[S1]",exact:true}).first().click();const source=page.locator("details:focus");
  await expect(source).toContainText("SHA256");const sourceId=await source.getAttribute("id");expect(sourceId).not.toBeNull();
  const savedSource=page.locator(`details[id="${sourceId}"]`);await savedSource.locator("summary").click();await expect(savedSource.getByText(/SHA256/)).toBeVisible();
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();
  completed=undefined;await page.getByRole("button",{name:/Open execution/}).click();await expect.poll(()=>completed?.state).toBe("completed");
  await page.getByRole("button",{name:"Copy results",exact:true}).click();await expect(page.getByRole("button",{name:"Copied",exact:true})).toBeVisible();
  const copied=await page.evaluate(()=>(window as unknown as {syntheticCopiedText:string}).syntheticCopiedText);
  expect(copied).toContain(JSON.stringify(completed!.results[12].diligence,null,2));
  const article=page.getByRole("article").filter({has:page.getByRole("heading",{name:"Synthetic multi-query diligence criterion 12",exact:true})});
  await article.getByText("Search queries (8 of 8 completed)",{exact:true}).click();
  const save=article.getByRole("button",{name:"Save as finding",exact:true});await save.click();await expect(page.getByRole("alert")).toContainText("not confirmed");await save.click();
  const finding=article.getByRole("link",{name:"Open saved finding",exact:true}),href=await finding.getAttribute("href");await finding.click();
  report=page.getByRole("region",{name:"Due diligence observations",exact:true});await expect(report).toContainText("identity unresolved");
  await selectWorkspaceReviewer(page,reviewer);await page.getByRole("button",{name:"Share for review",exact:true}).click();
  await page.goto(`${href}&actor=${reviewer}&theme=${theme}`);await page.getByRole("textbox",{name:"Review comment",exact:true}).fill("Reviewed qualified source evidence;identity and later amendments remain unresolved.");
  await page.getByRole("button",{name:"Approve revision",exact:true}).click();await page.reload();
  await expect(page.getByText("approved: Reviewed qualified source evidence;identity and later amendments remain unresolved.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Export JSON-LD & receipt",exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);expect(responseErrors).toEqual([]);
  await page.getByRole("region",{name:"Due diligence observations",exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath(`diligence-reviewed-${theme}.png`)});
});
test("interrupted diligence resumes without losing saved observations or creating a second execution",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await start(page,`Synthetic diligence recovery ${randomUUID()}`,[`Synthetic interrupted diligence ${randomUUID()}`]);
  await expect(page.getByRole("status").filter({hasText:"Execution interrupted"})).toContainText("1 of 2 questions saved");
  await expect(page.getByRole("region",{name:"Due diligence observations",exact:true})).toHaveCount(1);
  await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
  await expect(page.getByRole("region",{name:"Due diligence observations",exact:true}).first()).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 questions saved");
  await expect(page.getByRole("region",{name:"Due diligence observations",exact:true})).toHaveCount(2);await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
});
test("queued diligence cancellation resumes the same saved execution",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await start(page,`Synthetic cancel diligence ${randomUUID()}`,["Inspect source qualifications."]);
  await page.getByRole("button",{name:"Cancel execution",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution cancelled"})).toContainText("0 of 2 questions saved");
  await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
  await expect(page.getByRole("region",{name:"Due diligence observations",exact:true}).first()).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 questions saved");
  await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
});
test("empty diligence proposals preserve honest gaps instead of a clean bill of health",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await start(page,`Synthetic empty diligence ${randomUUID()}`);
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("1 of 1 questions saved");
  await expect(page.getByText(/This is not a complete background check/)).toBeVisible();
  await expect(page.getByRole("region",{name:"Due diligence observations",exact:true})).toContainText("0 observations");
  await expect(page.getByRole("button",{name:"Save as finding",exact:true})).toBeDisabled();
});
test("maximum-field diligence retains all observations,gaps and60sources after reload on a narrow display",async({page},testInfo)=>{
  await page.setViewportSize({width:320,height:900});const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const question=`Synthetic maximum-field diligence ${randomUUID()}`;await page.goto(`/?actor=${randomUUID()}&theme=dark`);
  await start(page,question,Array.from({length:12},(_,i)=>`Synthetic maximum-field diligence criterion ${i+1}`),true);
  const reports=page.getByRole("region",{name:"Due diligence observations",exact:true});
  for(let i=0;i<13;i++)await expect(reports.nth(i)).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("13 of 13 questions saved");
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();await page.getByRole("button",{name:/Open execution/}).click();
  await expect(reports).toHaveCount(13);const report=reports.last();
  await expect(report.getByRole("heading",{name:/^Synthetic provisional observation/})).toHaveCount(12);
  await expect(report.getByText("Qualifications and limitations",{exact:true})).toHaveCount(12);
  await report.getByText("Requested subjects (100)",{exact:true}).click();await expect(report.getByText("Subject 100",{exact:true})).toBeVisible();
  await report.getByText("Consulted source scope (60)",{exact:true}).click();await expect(report.getByText("Synthetic capacity diligence 60.txt",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);
  await report.getByText("Unresolved evidence gaps",{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("diligence-maximum-fields.png")});
});
