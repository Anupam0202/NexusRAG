import {expect,test,type Page} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {selectWorkspaceReviewer} from "./research-review-helpers";

test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE,"Requires controlled local production page/Gateway/queue/provider peers; not hosted identities.");
async function savedPlan(page:Page,question:string,subquestions:string[]=[]) {
  await page.getByRole("combobox",{name:"Mode",exact:true}).selectOption("OBLIGATION_ANALYSIS");
  await page.getByRole("textbox",{name:"Question",exact:true}).fill(question);
  await page.getByRole("textbox",{name:"Subquestions",exact:true}).fill(subquestions.join("\n"));
  await page.getByRole("textbox",{name:"Completion criteria",exact:true}).fill("Inspect source clauses, qualifiers and unknown applicability; retain independent review.");
  await page.getByRole("checkbox",{name:"Obligation policy.txt",exact:true}).check();await page.getByRole("checkbox",{name:"Obligation definitions.txt",exact:true}).check();
  await page.getByRole("button",{name:"Save plan",exact:true}).click();
  await page.getByRole("checkbox",{name:/I confirm that all questions/}).check();await page.getByRole("button",{name:"Start research",exact:true}).click();
}
for(const theme of ["light","dark"])test(`${theme}: execute11obligation criteria, inspect source qualifiers, reload and independently review a Finding`,async({page},testInfo)=>{
  await page.setViewportSize({width:320,height:900});
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const actor=randomUUID(),reviewer=randomUUID(),question=`Synthetic multi-query obligations ${randomUUID()}`;
  await page.goto(`/?actor=${actor}&reviewer=${reviewer}&theme=${theme}`);
  await savedPlan(page,question,Array.from({length:10},(_,index)=>`Synthetic multi-query obligation criterion ${index+1}`));
  for(let index=0;index<11;index++)await expect(page.getByRole("region",{name:"Obligation candidates",exact:true}).nth(index)).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("11 of 11 questions saved");
  let report=page.getByRole("region",{name:"Obligation candidates",exact:true}).last();
  await expect(report.getByText("except public summaries",{exact:true})).toBeVisible();await expect(report.getByText('"Report" means a synthetic inspection record.',{exact:true})).toBeVisible();
  await expect(report).toContainText("applicability undetermined");await expect(report).toContainText("Not implemented or certified");
  await report.getByRole("link",{name:"[S2]",exact:true}).first().click();await expect(page.locator("details:focus")).toContainText("SHA256");
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();await page.getByRole("button",{name:/Open execution/}).click();
  report=page.getByRole("region",{name:"Obligation candidates",exact:true}).last();await expect(report.getByText("Replaces section 2.",{exact:true})).toBeVisible();
  const article=page.getByRole("article").filter({has:page.getByRole("heading",{name:"Synthetic multi-query obligation criterion 10",exact:true})});
  await expect(article).toHaveCount(1);await article.getByText("Search queries (8 of 8 completed)",{exact:true}).click();
  const save=article.getByRole("button",{name:"Save as finding",exact:true});await save.click();await expect(page.getByRole("alert")).toContainText("not confirmed");await save.click();
  const finding=article.getByRole("link",{name:"Open saved finding",exact:true}),href=await finding.getAttribute("href");await finding.click();
  await expect(page.getByRole("region",{name:"Obligation candidates",exact:true})).toContainText("except public summaries");
  await selectWorkspaceReviewer(page,reviewer);await page.getByRole("button",{name:"Share for review",exact:true}).click();
  await page.goto(`${href}&actor=${reviewer}&theme=${theme}`);await page.getByRole("textbox",{name:"Review comment",exact:true}).fill("Inspected exact clauses and exceptions; applicability remains undetermined.");
  await page.getByRole("button",{name:"Approve revision",exact:true}).click();await page.reload();
  await expect(page.getByText("approved: Inspected exact clauses and exceptions; applicability remains undetermined.",{exact:true})).toBeVisible();
  report=page.getByRole("region",{name:"Obligation candidates",exact:true});await expect(report).toContainText("applicability undetermined");
  await expect(page.getByRole("button",{name:"Export JSON-LD & receipt",exact:true})).toBeDisabled();
  const bounds=await report.evaluate(element=>({width:element.clientWidth,content:element.scrollWidth,right:element.getBoundingClientRect().right,viewport:window.innerWidth}));
  expect(bounds.content).toBeLessThanOrEqual(bounds.width);expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);expect(errors).toEqual([]);
  await report.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`obligation-review-${theme}.png`)});
});
test("interrupted obligation execution resumes its saved question without losing earlier candidates",async({page})=>{
  const question=`Synthetic obligation recovery ${randomUUID()}`;
  await page.goto(`/?actor=${randomUUID()}`);await savedPlan(page,question,[`Synthetic interrupted obligation ${randomUUID()}`]);
  await expect(page.getByRole("status").filter({hasText:"Execution interrupted"})).toContainText("1 of 2 questions saved");
  await expect(page.getByRole("region",{name:"Obligation candidates",exact:true})).toHaveCount(1);
  await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 questions saved");
  await expect(page.getByRole("region",{name:"Obligation candidates",exact:true})).toHaveCount(2);await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
});
test("ordinary queued cancellation resumes the same obligation run and its remaining questions",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await savedPlan(page,`Synthetic cancel obligation ${randomUUID()}`,["Inspect the exception clause."]);
  await page.getByRole("button",{name:"Cancel execution",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Execution cancelled"})).toContainText("0 of 2 questions saved");
  await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
  await expect(page.getByRole("region",{name:"Obligation candidates",exact:true}).first()).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 questions saved");
  await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
});
test("no obligation candidate is an explicit evidence gap, not compliance or an exportable finding",async({page})=>{
  await page.goto(`/?actor=${randomUUID()}`);await savedPlan(page,`Synthetic empty obligation ${randomUUID()}`);
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("1 of 1 questions saved");
  await expect(page.getByText(/This does not establish that no obligations apply/)).toBeVisible();
  await expect(page.getByRole("region",{name:"Obligation candidates",exact:true})).toContainText("0 candidates");
  await expect(page.getByRole("button",{name:"Save as finding",exact:true})).toBeDisabled();
});

test("maximum-field obligation result renders, reopens and retains every qualifier on a narrow screen",async({page},testInfo)=>{
  await page.setViewportSize({width:320,height:900});const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const question=`Synthetic maximum-field obligations ${randomUUID()}`;
  await page.goto(`/?actor=${randomUUID()}&theme=dark`);
  await page.getByRole("combobox",{name:"Mode",exact:true}).selectOption("OBLIGATION_ANALYSIS");
  await page.getByRole("textbox",{name:"Question",exact:true}).fill(question);
  await page.getByRole("textbox",{name:"Subquestions",exact:true}).fill(Array.from({length:10},(_,i)=>`Synthetic maximum-field criterion ${i+1}`).join("\n"));
  await page.getByRole("textbox",{name:"Completion criteria",exact:true}).fill("Retain all literal qualifying anchors and unknown applicability.");
  for(let i=1;i<=50;i++)await page.getByRole("checkbox",{name:`Synthetic capacity policy ${i}.txt`,exact:true}).check();
  await page.getByRole("button",{name:"Save plan",exact:true}).click();await page.getByRole("checkbox",{name:/I confirm that all questions/}).check();
  await page.getByRole("button",{name:"Start research",exact:true}).click();
  for(let index=0;index<11;index++)await expect(page.getByRole("region",{name:"Obligation candidates",exact:true}).nth(index)).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("11 of 11 questions saved");
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();
  await page.getByRole("button",{name:/Open execution/}).click();
  const reports=page.getByRole("region",{name:"Obligation candidates",exact:true});await expect(reports).toHaveCount(11);
  await expect(reports.locator("dl")).toHaveCount(11);
  const report=reports.last();await expect(report.locator("details").filter({has:page.locator("summary").filter({hasText:/^Candidate \d+:/})})).toHaveCount(12);
  for(let index=2;index<=12;index++)await report.locator("summary").filter({hasText:new RegExp(`^Candidate ${index}:`)}).click();
  await expect(report.getByText("Proposed control",{exact:true})).toHaveCount(12);await expect(report.getByRole("heading",{name:"Limitations",exact:true})).toHaveCount(12);
  await expect(report.getByText("Not implemented or certified",{exact:true})).toHaveCount(12);
  await report.getByText("Consulted source scope (50)",{exact:true}).click();await expect(report.getByText("Synthetic capacity policy 50.txt",{exact:true})).toBeVisible();
  const bounds=await report.evaluate(element=>({width:element.clientWidth,content:element.scrollWidth,right:element.getBoundingClientRect().right,viewport:window.innerWidth}));
  expect(bounds.content).toBeLessThanOrEqual(bounds.width);expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);expect(errors).toEqual([]);
  await report.getByText("Proposed control",{exact:true}).last().scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath("obligation-maximum-field.png")});
});
