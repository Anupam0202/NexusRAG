import {expect,test,type Page} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {selectWorkspaceReviewer} from "./research-review-helpers";
import type {ResearchRun} from "../lib/research-run";

test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE,"Requires controlled production pages/Gateway/queue with synthetic peers, not hosted identity or model quality.");
async function start(page:Page,question:string,subquestions:string[]=[],maximum=false) {
  await page.getByRole("combobox",{name:"Mode",exact:true}).selectOption("ENTITY_INVESTIGATION");
  await page.getByRole("textbox",{name:"Question",exact:true}).fill(question);
  await page.getByRole("textbox",{name:"Subquestions",exact:true}).fill(subquestions.join("\n"));
  await page.getByRole("textbox",{name:"Entity scope",exact:true}).fill(maximum?Array.from({length:100},(_,i)=>`Target ${i+1}`).join("\n"):"Example Works 1\nExample Holdings 2");
  await page.getByRole("textbox",{name:"Completion criteria",exact:true}).fill("Retain exact source statements and unresolved identities for independent review.");
  for(let i=1;i<=(maximum?50:2);i++)await page.getByRole("checkbox",{name:`Synthetic ${maximum?"capacity entity":"entity"} ${i}.txt`,exact:true}).check();
  await page.getByRole("button",{name:"Save plan",exact:true}).click();
  await page.getByRole("checkbox",{name:/I confirm that all questions/}).check();await page.getByRole("button",{name:"Start research",exact:true}).click();
}
for(const theme of ["light","dark"])test(`${theme}: execute entity criteria, inspect originals, copy, reload and independently review a Finding`,async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const actor=randomUUID(),reviewer=randomUUID(),question=`Synthetic multi-query entities ${randomUUID()}`;
  let completed:ResearchRun|undefined;const responseErrors:string[]=[];
  page.on("response",async response=>{
    if(!/\/api\/v2\/research\/plans\/[^/]+\/runs\/[^/?]+(?:\?|$)/.test(response.url())||response.status()!==200)return;
    try{const value=await response.json();if(value.state==="completed"&&value.results?.length)completed=value;}catch(error){responseErrors.push(String(error));}
  });
  await page.addInitScript(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async(text:string)=>{
    (window as unknown as {syntheticCopiedText:string}).syntheticCopiedText=text;
  }}}));
  await page.goto(`/?actor=${actor}&reviewer=${reviewer}&theme=${theme}`);
  await start(page,question,Array.from({length:10},(_,i)=>`Synthetic multi-query entity criterion ${i+1}`));
  const reports=page.getByRole("region",{name:"Entity candidates",exact:true});
  for(let i=0;i<11;i++)await expect(reports.nth(i)).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("11 of 11 questions saved");
  let report=reports.last();await expect(report).toContainText("identities unresolved");await expect(report.getByText("EX-1",{exact:true})).toBeVisible();
  await expect(report.getByText("is owned by",{exact:true})).toBeVisible();await expect(report).toContainText("confidence not calibrated");
  await report.getByRole("link",{name:"[S1]",exact:true}).first().click();await expect(page.locator("details:focus")).toContainText("SHA256");
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();
  completed=undefined;await page.getByRole("button",{name:/Open execution/}).click();await expect.poll(()=>completed?.state).toBe("completed");
  await page.getByRole("button",{name:"Copy results",exact:true}).click();await expect(page.getByRole("button",{name:"Copied",exact:true})).toBeVisible();
  const copied=await page.evaluate(()=>(window as unknown as {syntheticCopiedText:string}).syntheticCopiedText);
  expect(copied).toContain(JSON.stringify(completed!.results[10].entities,null,2));
  const article=page.getByRole("article").filter({has:page.getByRole("heading",{name:"Synthetic multi-query entity criterion 10",exact:true})});
  await article.getByText("Search queries (8 of 8 completed)",{exact:true}).click();
  const save=article.getByRole("button",{name:"Save as finding",exact:true});await save.click();await expect(page.getByRole("alert")).toContainText("not confirmed");await save.click();
  const finding=article.getByRole("link",{name:"Open saved finding",exact:true}),href=await finding.getAttribute("href");await finding.click();
  report=page.getByRole("region",{name:"Entity candidates",exact:true});await expect(report.getByText("EX-1",{exact:true})).toBeVisible();
  await selectWorkspaceReviewer(page,reviewer);await page.getByRole("button",{name:"Share for review",exact:true}).click();
  await page.goto(`${href}&actor=${reviewer}&theme=${theme}`);await page.getByRole("textbox",{name:"Review comment",exact:true}).fill("Reviewed literal wording, not verified identity or ownership.");
  await page.getByRole("button",{name:"Approve revision",exact:true}).click();await page.reload();
  await expect(page.getByText("approved: Reviewed literal wording, not verified identity or ownership.",{exact:true})).toBeVisible();
  report=page.getByRole("region",{name:"Entity candidates",exact:true});await expect(report).toContainText("identities unresolved");
  await expect(page.getByRole("button",{name:"Export JSON-LD & receipt",exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);expect(responseErrors).toEqual([]);
  await report.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`entity-reviewed-${theme}.png`)});
});
test("interrupted entity execution resumes without losing already saved candidates",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await start(page,`Synthetic entity recovery ${randomUUID()}`,[`Synthetic interrupted entity ${randomUUID()}`]);
  await expect(page.getByRole("status").filter({hasText:"Execution interrupted"})).toContainText("1 of 2 questions saved");
  await expect(page.getByRole("region",{name:"Entity candidates",exact:true})).toHaveCount(1);
  await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 questions saved");
  await expect(page.getByRole("region",{name:"Entity candidates",exact:true})).toHaveCount(2);await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
});
test("queued entity cancellation resumes the same saved execution",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await start(page,`Synthetic cancel entity ${randomUUID()}`,["Inspect source identity wording."]);
  await page.getByRole("button",{name:"Cancel execution",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution cancelled"})).toContainText("0 of 2 questions saved");
  await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
  await expect(page.getByRole("region",{name:"Entity candidates",exact:true}).first()).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 questions saved");
  await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
});
test("empty entity candidates preserve an honest evidence gap instead of resolved identity",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await start(page,`Synthetic empty entity ${randomUUID()}`);
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("1 of 1 questions saved");
  await expect(page.getByText(/This does not establish entity absence/)).toBeVisible();
  await expect(page.getByRole("region",{name:"Entity candidates",exact:true})).toContainText("0 candidates");
  await expect(page.getByRole("button",{name:"Save as finding",exact:true})).toBeDisabled();
});
test("maximum-field entity results retain every candidate and relationship after reload on a narrow display",async({page},testInfo)=>{
  await page.setViewportSize({width:320,height:900});const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const question=`Synthetic maximum-field entity ${randomUUID()}`;await page.goto(`/?actor=${randomUUID()}&theme=dark`);
  await start(page,question,Array.from({length:10},(_,i)=>`Synthetic maximum-field entity criterion ${i+1}`),true);
  const reports=page.getByRole("region",{name:"Entity candidates",exact:true});
  for(let i=0;i<11;i++)await expect(reports.nth(i)).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("11 of 11 questions saved");
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();await page.getByRole("button",{name:/Open execution/}).click();
  await expect(reports).toHaveCount(11);const report=reports.last();
  for(let i=2;i<=12;i++)await report.locator("summary").filter({hasText:new RegExp(`^Candidate ${i}:`)}).click();
  await expect(report.getByRole("heading",{name:"Source-asserted relationship candidates",exact:true})).toHaveCount(12);
  await expect(report.getByText("Subject",{exact:true})).toHaveCount(48);
  await report.getByText("Requested entity targets (100)",{exact:true}).click();await expect(report.getByText("Target 100",{exact:true})).toBeVisible();
  await report.getByText("Consulted source scope (50)",{exact:true}).click();await expect(report.getByText("Synthetic capacity entity 50.txt",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);
  await report.getByText("Subject",{exact:true}).last().scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("entity-maximum-fields.png")});
});
