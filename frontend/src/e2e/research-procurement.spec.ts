import {expect,test,type Page} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {selectWorkspaceReviewer} from "./research-review-helpers";
import type {ResearchRun} from "../lib/research-run";

test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE,"Requires actual pages/Gateway/executor with controlled synthetic peers,not hosted identity or model quality.");
test.use({trace:"retain-on-failure",screenshot:"only-on-failure"});
async function start(page:Page,question:string,subquestions:string[]=[],maximum=false) {
  await page.getByRole("combobox",{name:"Mode",exact:true}).selectOption("PROCUREMENT_RESEARCH");
  await page.getByRole("textbox",{name:"Question",exact:true}).fill(question);
  await page.getByRole("textbox",{name:"Subquestions",exact:true}).fill(subquestions.join("\n"));
  await page.getByRole("textbox",{name:"Completion criteria",exact:true}).fill("Independently review notice versions,value wording,deadlines and qualifications;no eligibility or award decision.");
  if(maximum){
    await page.getByRole("searchbox",{name:"Find private documents",exact:true}).fill("Synthetic procurement");
    await page.getByRole("checkbox",{name:"Select matching documents",exact:true}).check();
    await expect(page.getByRole("region",{name:"Available private documents",exact:true}).getByRole("checkbox",{checked:true})).toHaveCount(50);
  }else for(let i=1;i<=2;i++)await page.getByRole("checkbox",{name:`Synthetic procurement ${i}.txt`,exact:true}).check();
  await page.getByRole("button",{name:"Save plan",exact:true}).click();
  await page.getByRole("checkbox",{name:/I confirm that all questions/}).check();
  await page.getByRole("button",{name:"Start research",exact:true}).click();
}
for(const theme of ["light","dark"])test(`${theme}: execute Procurement criteria,inspect exact fields,copy,reload and independently review a Finding`,async({page},info)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const actor=randomUUID(),reviewer=randomUUID(),question=`Synthetic multi-query procurement ${randomUUID()}`;
  let completed:ResearchRun|undefined;const responseErrors:string[]=[];
  page.on("response",async response=>{
    if(!/\/api\/v2\/research\/plans\/[^/]+\/runs\/[^/?]+(?:\?|$)/.test(response.url())||response.status()!==200)return;
    try{const value=await response.json();if(value.state==="completed"&&value.results?.length)completed=value;}catch(error){responseErrors.push(String(error));}
  });
  await page.addInitScript(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async(text:string)=>{
    (window as unknown as {syntheticCopiedText:string}).syntheticCopiedText=text;
  }}}));
  await page.goto(`/?actor=${actor}&reviewer=${reviewer}&theme=${theme}`);
  await start(page,question,Array.from({length:10},(_,i)=>`Synthetic multi-query procurement criterion ${i+1}`));
  const reports=page.getByRole("region",{name:"Procurement records",exact:true});
  for(let i=0;i<11;i++)await expect(reports.nth(i)).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("11 of 11 questions saved");
  const report=reports.last();await report.locator("ol > li > details > summary").first().click();
  await expect(report.getByText("Value wording",{exact:true}).first()).toBeVisible();
  await expect(report.getByText("Value wording",{exact:true}).first().locator("..").locator("dd blockquote")).toHaveText("value USD 9007199254740993.25 [S1]");
  await expect(report.getByText("Deadline wording",{exact:true}).first().locator("..").locator("dd blockquote")).toHaveText("2026-12-01T12:00:00Z [S1]");
  await expect(report).toContainText("current eligibility require independent review");
  await report.getByRole("link",{name:"[S1]",exact:true}).first().click();
  const sourceId=await page.locator("details:focus").getAttribute("id");expect(sourceId).not.toBeNull();
  const source=page.locator(`details[id="${sourceId}"]`);await source.locator("summary").click();await expect(source.getByText(/SHA256/)).toBeVisible();
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();
  completed=undefined;await page.getByRole("button",{name:/Open execution/}).click();await expect.poll(()=>completed?.state).toBe("completed");
  await page.getByRole("button",{name:"Copy results",exact:true}).click();await expect(page.getByRole("button",{name:"Copied",exact:true})).toBeVisible();
  const copied=await page.evaluate(()=>(window as unknown as {syntheticCopiedText:string}).syntheticCopiedText);
  expect(copied).toContain(JSON.stringify(completed!.results[10].procurement,null,2));
  const article=page.getByRole("article").filter({has:page.getByRole("heading",{name:"Synthetic multi-query procurement criterion 10",exact:true})});
  const save=article.getByRole("button",{name:"Save as finding",exact:true});await save.click();await expect(page.getByRole("alert")).toContainText("not confirmed");await save.click();
  const finding=article.getByRole("link",{name:"Open saved finding",exact:true}),href=await finding.getAttribute("href");await finding.click();
  await expect(page.getByRole("region",{name:"Procurement records",exact:true})).toContainText("proposed records");
  await page.getByRole("textbox",{name:"Authored finding",exact:true}).fill("Independent notice follow-up remains required.");
  await page.getByRole("button",{name:"Save finding",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Revision 2 · owner",exact:true})).toBeVisible();
  await selectWorkspaceReviewer(page,reviewer);await page.getByRole("button",{name:"Share for review",exact:true}).click();
  await page.goto(`${href}&actor=${reviewer}&theme=${theme}`);await page.getByRole("textbox",{name:"Review comment",exact:true}).fill("Reviewed source-worded amount,notice version and qualifications;no eligibility decision.");
  await page.getByRole("button",{name:"Approve revision",exact:true}).click();await page.reload();
  await expect(page.getByText("approved: Reviewed source-worded amount,notice version and qualifications;no eligibility decision.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Export JSON-LD & receipt",exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);expect(responseErrors).toEqual([]);
  await page.screenshot({path:info.outputPath(`procurement-reviewed-${theme}.png`)});
});
test("interrupted Procurement resumes with saved records rather than a duplicate execution",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await start(page,`Synthetic procurement recovery ${randomUUID()}`,[`Synthetic interrupted procurement ${randomUUID()}`]);
  await expect(page.getByRole("status").filter({hasText:"Execution interrupted"})).toContainText("1 of 2 questions saved");
  await expect(page.getByRole("region",{name:"Procurement records",exact:true})).toHaveCount(1);
  await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
  await expect(page.getByRole("region",{name:"Procurement records",exact:true}).first()).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 questions saved");
  await expect(page.getByRole("region",{name:"Procurement records",exact:true})).toHaveCount(2);
  await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
});
test("queued Procurement cancellation resumes the same execution",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await start(page,`Synthetic cancel procurement ${randomUUID()}`,["Inspect notice qualifications."]);
  await page.getByRole("button",{name:"Cancel execution",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution cancelled"})).toContainText("0 of 2 questions saved");
  await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
  await expect(page.getByRole("region",{name:"Procurement records",exact:true}).first()).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 questions saved");
  await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
});
test("empty Procurement abstains rather than claiming no opportunities or confirmed eligibility",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await start(page,`Synthetic empty procurement ${randomUUID()}`);
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("1 of 1 questions saved");
  await expect(page.getByRole("region",{name:"Procurement records",exact:true})).toContainText("0 proposed records");
  await expect(page.getByText(/not a complete market search or proof of no opportunities/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Save as finding",exact:true})).toBeDisabled();
});
test("all thirteen maximum fields and fifty consulted sources survive reload at320pixels",async({page},info)=>{
  await page.setViewportSize({width:320,height:900});const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const question=`Synthetic multi-query maximum-field procurement ${randomUUID()}`;await page.goto(`/?actor=${randomUUID()}&theme=dark`);
  await start(page,question,Array.from({length:10},(_,i)=>`Synthetic multi-query maximum-field procurement criterion ${i+1}`),true);
  const reports=page.getByRole("region",{name:"Procurement records",exact:true});
  for(let i=0;i<11;i++)await expect(reports.nth(i)).toBeVisible();
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();await page.getByRole("button",{name:/Open execution/}).click();
  await expect(reports).toHaveCount(11);const report=reports.last();
  await expect(report.locator("ol > li > details > summary")).toHaveCount(12);
  const record=report.locator("ol > li > details").last();await record.locator("summary").click();
  await expect(record.locator("dt")).toHaveCount(13);await expect(record.getByText("Qualifications and limitations",{exact:true})).toBeVisible();
  await expect(record.getByRole("link",{name:"[S12]",exact:true})).toHaveCount(13);
  await report.getByText("Consulted source scope (50)",{exact:true}).click();
  await expect(report.locator("details").last().getByText("Synthetic procurement 50.txt",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  await report.getByText("Unresolved procurement evidence gaps",{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath("procurement-maximum-fields.png")});
});
