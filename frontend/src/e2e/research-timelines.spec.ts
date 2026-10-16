import { expect,test,type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { selectWorkspaceReviewer } from "./research-review-helpers";
test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE,"Requires controlled local UI/Gateway/queue/provider peers, not hosted identities.");
async function plan(page:Page,question:string,theme:string,subquestion?:string) {
  const actor=randomUUID(),reviewer=randomUUID();await page.goto(`/?actor=${actor}&reviewer=${reviewer}&theme=${theme}`);
  await page.getByRole("combobox",{name:"Mode",exact:true}).selectOption("TIMELINE");
  await page.getByRole("textbox",{name:"Question",exact:true}).fill(question);
  await page.getByRole("textbox",{name:"Completion criteria",exact:true}).fill("Inspect original dates, precision and roles; obtain separate review.");
  if(subquestion)await page.getByRole("textbox",{name:"Subquestions",exact:true}).fill(subquestion);
  await page.getByRole("checkbox",{name:"Timeline policy.txt",exact:true}).check();
  await page.getByRole("checkbox",{name:"Timeline amendment.txt",exact:true}).check();
  await page.getByRole("button",{name:"Save plan",exact:true}).click();
  await page.getByRole("checkbox",{name:/I confirm that all questions/}).check();return {actor,reviewer};
}
for(const theme of ["light","dark"])for(const width of [null,320])test(`${theme}${width?` ${width}px`:""}: persist chronology, exact source dates and independent finding review`,async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));if(width)await page.setViewportSize({width,height:900});
  const question=`Timeline synthetic policy ${randomUUID()}`,{reviewer}=await plan(page,question,theme);
  await page.getByRole("button",{name:"Start research",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("1 of 1 batches saved");
  const chronology=page.getByRole("region",{name:"Saved chronology",exact:true});
  await expect(chronology.getByRole("listitem")).toHaveCount(4);
  await expect(chronology.getByRole("listitem").nth(0)).toContainText("Open period 2024/2025.");
  await expect(chronology.getByRole("listitem").nth(1)).toContainText("Issued 2024-02.");
  await expect(chronology.getByRole("listitem").nth(2)).toContainText("Effective 2024-02-29.");
  await expect(chronology.getByRole("listitem").nth(3)).toContainText("Unresolved date; retained verbatim");
  await chronology.getByRole("link",{name:"[S1]",exact:true}).first().click();
  await expect(page.locator("details:focus")).toContainText("SHA256");
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();await page.getByRole("button",{name:/Open execution/}).click();
  await expect(chronology.getByRole("listitem")).toHaveCount(4);
  await expect(page.locator("html")).toHaveClass(theme==="dark"?/dark/:/^$/);
  const save=page.getByRole("button",{name:"Save as finding",exact:true});await save.click();await expect(page.getByRole("alert")).toContainText("not confirmed");await save.click();
  const link=page.getByRole("link",{name:"Open saved finding",exact:true}),href=await link.getAttribute("href");await link.click();
  await expect(page.getByText("Saved timeline · criterion 1 · batch 1 · not automatically verified",{exact:true})).toBeVisible();
  await expect(page.getByRole("list",{name:"Source events",exact:true}).getByRole("listitem")).toHaveCount(4);
  await selectWorkspaceReviewer(page,reviewer);await page.getByRole("button",{name:"Share for review",exact:true}).click();
  await page.goto(`${href}&actor=${reviewer}&theme=${theme}`);await page.getByRole("textbox",{name:"Review comment",exact:true}).fill("Checked source dates, uncertain order and original evidence.");
  await page.getByRole("button",{name:"Approve revision",exact:true}).click();await page.reload();
  await expect(page.getByText("approved: Checked source dates, uncertain order and original evidence.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Export JSON-LD & receipt",exact:true})).toBeDisabled();
  for(const name of ["Findings workbench","Finding editor","Evidence and reviews"]) {
    const bounds=await page.getByRole("region",{name,exact:true}).evaluate(e=>({width:e.clientWidth,content:e.scrollWidth,right:e.getBoundingClientRect().right,viewport:window.innerWidth}));
    expect(bounds.content).toBeLessThanOrEqual(bounds.width);expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
  }
  expect(errors).toEqual([]);
  await page.getByText("Saved timeline · criterion 1 · batch 1 · not automatically verified",{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath(`timeline-finding-${theme}.png`)});
  await page.getByText("approved: Checked source dates, uncertain order and original evidence.",{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath(`timeline-review-${theme}.png`)});
});
test("resuming an interrupted timeline retains earlier events and one execution",async({page})=>{
  const id=randomUUID();await plan(page,`Timeline synthetic ${id}`,"light",`Synthetic interrupted timeline ${id}`);
  await page.getByRole("button",{name:"Start research",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution interrupted"})).toContainText("1 of 2 batches saved");
  await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 batches saved");
  await expect(page.getByRole("region",{name:"Saved chronology",exact:true}).getByRole("listitem")).toHaveCount(8);
  await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
});
