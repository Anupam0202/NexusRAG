import {expect,test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {selectWorkspaceReviewer} from "./research-review-helpers";

test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE,"Requires controlled local UI/Gateway/queue/provider peers, not hosted identities.");
for(const theme of ["light","dark"])test(`${theme}: eight searched variants survive execution, reload and Finding lineage`,async({page},testInfo)=>{
  await page.setViewportSize({width:320,height:900});
  const actor=randomUUID(),question=`Synthetic multi-query mass context ${randomUUID()}`;
  await page.goto(`/?actor=${actor}&theme=${theme}`);
  await page.getByRole("combobox",{name:"Mode",exact:true}).selectOption("CONTRADICTION_ANALYSIS");
  await page.getByRole("textbox",{name:"Question",exact:true}).fill(question);
  await page.getByRole("textbox",{name:"Completion criteria",exact:true}).fill("Inspect original evidence and actual query coverage.");
  await page.getByRole("checkbox",{name:"Synthetic policy.txt",exact:true}).check();await page.getByRole("checkbox",{name:"Synthetic second policy.txt",exact:true}).check();
  await page.getByRole("button",{name:"Save plan",exact:true}).click();await page.getByRole("checkbox",{name:/I confirm that all questions/}).check();
  await page.getByRole("button",{name:"Start research",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("1 of 1");
  await page.getByText("Search queries (8 of 8 completed)",{exact:true}).click();
  let coverage=page.locator("details").filter({has:page.getByText("Search queries (8 of 8 completed)",{exact:true})});
  await expect(coverage.locator("li")).toHaveCount(8);await expect(coverage).toContainText("Search queries are not evidence");
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();await page.getByRole("button",{name:/Open execution/}).click();
  await page.getByText("Search queries (8 of 8 completed)",{exact:true}).click();await expect(coverage.locator("li")).toHaveCount(8);
  const save=page.getByRole("button",{name:"Save as finding",exact:true});await save.click();await expect(page.getByRole("alert")).toContainText("not confirmed");await save.click();
  await page.getByRole("link",{name:"Open saved finding",exact:true}).click();
  await page.getByText("Search queries (8 of 8 completed)",{exact:true}).click();
  coverage=page.locator("details").filter({has:page.getByText("Search queries (8 of 8 completed)",{exact:true})});
  await expect(coverage.locator("li")).toHaveCount(8);await expect(coverage).toContainText(question);
  const bounds=await coverage.evaluate(e=>({width:e.clientWidth,content:e.scrollWidth,right:e.getBoundingClientRect().right,viewport:window.innerWidth}));
  expect(bounds.content).toBeLessThanOrEqual(bounds.width);expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
  await coverage.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`query-coverage-${theme}.png`)});
});
for(const theme of ["light","dark"])for(const width of [null,320])test(`${theme}${width?` ${width}px`:""}: execute, reload and independently review exact source-paired statements`,async({page},testInfo)=>{
  if(width)await page.setViewportSize({width,height:900});
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const actor=randomUUID(),reviewer=randomUUID(),question=`Synthetic mass context ${randomUUID()}`;
  await page.goto(`/?actor=${actor}&reviewer=${reviewer}&theme=${theme}`);
  await page.getByRole("combobox",{name:"Mode",exact:true}).selectOption("CONTRADICTION_ANALYSIS");
  await page.getByRole("textbox",{name:"Question",exact:true}).fill(question);
  await page.getByRole("textbox",{name:"Completion criteria",exact:true}).fill("Inspect exact paired quotes and missing context; request independent review.");
  await page.getByRole("checkbox",{name:"Synthetic policy.txt",exact:true}).check();
  await page.getByRole("checkbox",{name:"Synthetic second policy.txt",exact:true}).check();
  await page.getByRole("button",{name:"Save plan",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Contradiction Analysis",exact:true})).toBeFocused();
  await page.screenshot({path:testInfo.outputPath(`contradiction-plan-${theme}.png`)});
  await page.getByRole("checkbox",{name:/I confirm that all questions/}).check();
  await page.getByRole("button",{name:"Start research",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("1 of 1");
  const analysis=page.getByRole("region",{name:"Source-paired analysis",exact:true});
  await expect(analysis.locator("blockquote")).toHaveCount(2);
  await expect(analysis).toContainText("1.005 kg");await expect(analysis).toContainText("2.005 kg");
  await expect(analysis).toContainText("Review required");
  await analysis.getByRole("link",{name:"[S1]",exact:true}).click();
  await expect(page.locator("details:focus")).toContainText("SHA256");
  await analysis.getByText("Consulted scope (2 documents)",{exact:true}).click();
  await expect(analysis.getByRole("link",{name:"Synthetic policy.txt",exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();
  await page.getByRole("button",{name:/Open execution/}).click();
  await expect(analysis.locator("blockquote")).toHaveCount(2);
  const save=page.getByRole("button",{name:"Save as finding",exact:true});
  await save.click();await expect(page.getByRole("alert")).toContainText("not confirmed");await save.click();
  const finding=page.getByRole("link",{name:"Open saved finding",exact:true}),href=await finding.getAttribute("href");await finding.click();
  await expect(page.getByText("Saved contradiction analysis \u00b7 criterion 1 \u00b7 not automatically verified",{exact:true})).toBeVisible();
  await expect(analysis.locator("blockquote")).toHaveCount(2);
  await selectWorkspaceReviewer(page,reviewer);await page.getByRole("button",{name:"Share for review",exact:true}).click();
  await page.goto(`${href}&actor=${reviewer}&theme=${theme}`);
  await page.getByRole("textbox",{name:"Review comment",exact:true}).fill("Checked exact quotes; context and equivalence are not established automatically.");
  await page.getByRole("button",{name:"Approve revision",exact:true}).click();await page.reload();
  await expect(page.getByText("approved: Checked exact quotes; context and equivalence are not established automatically.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Export JSON-LD & receipt",exact:true})).toBeDisabled();
  for(const name of ["Findings workbench","Finding editor","Evidence and reviews"]) {
    const bounds=await page.getByRole("region",{name,exact:true}).evaluate(e=>({width:e.clientWidth,content:e.scrollWidth,right:e.getBoundingClientRect().right,viewport:window.innerWidth}));
    expect(bounds.content).toBeLessThanOrEqual(bounds.width);expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
  }
  expect(errors).toEqual([]);
  await analysis.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`contradiction-review-${theme}.png`)});
});

for(const kind of ["interrupted","empty"])test(`${kind} contradiction execution preserves results and honest limitations`,async({page})=>{
  const question=`Synthetic ${kind} contradiction ${randomUUID()}`;
  await page.goto(`/?actor=${randomUUID()}`);await page.getByRole("combobox",{name:"Mode",exact:true}).selectOption("CONTRADICTION_ANALYSIS");
  await page.getByRole("textbox",{name:"Question",exact:true}).fill(kind==="interrupted"?`First criterion ${randomUUID()}`:question);
  if(kind==="interrupted")await page.getByRole("textbox",{name:"Subquestions",exact:true}).fill(question);
  await page.getByRole("textbox",{name:"Completion criteria",exact:true}).fill("Inspect original evidence and gaps.");
  await page.getByRole("checkbox",{name:"Synthetic policy.txt",exact:true}).check();await page.getByRole("checkbox",{name:"Synthetic second policy.txt",exact:true}).check();
  await page.getByRole("button",{name:"Save plan",exact:true}).click();await page.getByRole("checkbox",{name:/I confirm that all questions/}).check();
  await page.getByRole("button",{name:"Start research",exact:true}).click();
  if(kind==="interrupted") {
    await expect(page.getByRole("status").filter({hasText:"Execution interrupted"})).toContainText("1 of 2 questions saved");
    await expect(page.getByRole("region",{name:"Source-paired analysis",exact:true}).locator("blockquote")).toHaveCount(2);
    await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
    await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 questions saved");
    await expect(page.getByRole("region",{name:"Source-paired analysis",exact:true})).toHaveCount(2);
    await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
  } else {
    await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("1 of 1");
    const analysis=page.getByRole("region",{name:"Source-paired analysis",exact:true});
    await expect(analysis).toContainText("No source-anchored pairs returned. This does not establish consistency.");
    await expect(analysis.locator("blockquote")).toHaveCount(0);await expect(page.getByRole("button",{name:"Save as finding",exact:true})).toBeDisabled();
  }
});
