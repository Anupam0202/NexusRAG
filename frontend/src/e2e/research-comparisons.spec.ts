import { expect,test,type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE,"Requires isolated UI/Gateway/queue/provider peers, not hosted users.");
async function plan(page:Page,question:string,theme:string,subquestion?:string) {
  const actor=randomUUID(),reviewer=randomUUID();
  await page.goto(`/?actor=${actor}&reviewer=${reviewer}&theme=${theme}`);
  await expect(page.getByRole("button",{name:"Save plan",exact:true})).toBeEnabled();
  await page.getByRole("combobox",{name:"Mode",exact:true}).selectOption("COMPARE");
  await page.getByRole("textbox",{name:"Question",exact:true}).fill(question);
  await page.getByRole("textbox",{name:"Completion criteria",exact:true}).fill("Inspect each source and obtain independent review.");
  if(subquestion)await page.getByRole("textbox",{name:"Subquestions",exact:true}).fill(subquestion);
  await page.getByRole("checkbox",{name:"Synthetic policy.txt",exact:true}).check();
  await page.getByRole("checkbox",{name:"Synthetic second policy.txt",exact:true}).check();
  await page.getByRole("button",{name:"Save plan",exact:true}).click();
  await page.getByRole("checkbox",{name:/I confirm that all questions/}).check();
  return {actor,reviewer};
}
for(const theme of ["light","dark"])test(`${theme}: execute a separately cited comparison, inspect both originals and reload the matrix`,async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const question=`Compare synthetic masses ${randomUUID()}`;
  const {reviewer}=await plan(page,question,theme);await page.getByRole("button",{name:"Start research",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("1 of 1 batches saved");
  await expect(page.getByRole("rowheader",{name:"Synthetic policy.txt",exact:true})).toBeVisible();
  await expect(page.getByRole("rowheader",{name:"Synthetic second policy.txt",exact:true})).toBeVisible();
  await expect(page.getByText("The mass is 1.005 kg [S1].",{exact:true})).toBeVisible();
  await expect(page.getByText("The mass is 2.005 kg [S2].",{exact:true})).toBeVisible();
  await page.getByRole("link",{name:"[S1]",exact:true}).click();await expect(page.getByText(/SHA256 [a-f0-9]{64}/).first()).toBeVisible();
  await page.getByRole("link",{name:"[S2]",exact:true}).click();await expect(page.getByText("The synthetic second mass is 2.005 kg.",{exact:true})).toBeVisible();
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();await page.getByRole("button",{name:/Open execution/}).click();
  await expect(page.getByRole("rowheader",{name:"Synthetic second policy.txt",exact:true})).toBeVisible();
  await expect(page.getByRole("progressbar",{name:"Research progress"})).toHaveAttribute("value","1");
  await expect(page.locator("html")).toHaveClass(theme==="dark"?/dark/:/^$/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);
  await page.getByRole("region",{name:"Research executions",exact:true}).screenshot({path:testInfo.outputPath(`research-comparison-${theme}.png`)});
  const save=page.getByRole("button",{name:"Save as finding",exact:true});await save.click();await expect(page.getByRole("alert")).toContainText("not confirmed");await save.click();
  const open=page.getByRole("link",{name:"Open saved finding",exact:true});const href=await open.getAttribute("href");await open.click();
  await expect(page.getByText("Saved comparison · criterion 1 · batch 1 · not automatically verified",{exact:true})).toBeVisible();
  await expect(page.getByRole("rowheader",{name:"Synthetic second policy.txt",exact:true})).toBeVisible();
  await page.getByRole("combobox",{name:"Workspace member",exact:true}).selectOption(reviewer);
  await page.getByRole("button",{name:"Share for review",exact:true}).click();
  await page.goto(`${href}&actor=${reviewer}&theme=${theme}`);
  await page.getByRole("textbox",{name:"Review comment",exact:true}).fill("Reviewed each original comparison cell.");
  await page.getByRole("button",{name:"Approve revision",exact:true}).click();await page.reload();
  await expect(page.getByText("approved: Reviewed each original comparison cell.",{exact:true})).toBeVisible();
  await expect(page.locator("time[datetime]")).toBeVisible();
  await expect(page.getByRole("button",{name:"Export JSON-LD & receipt",exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole("region",{name:"Evidence and reviews",exact:true}).screenshot({path:testInfo.outputPath(`comparison-finding-review-${theme}.png`)});
});
test("an interrupted later criterion resumes without replacing the saved first matrix",async({page})=>{
  const id=randomUUID();await plan(page,`Compare synthetic masses ${id}`,"light",`Synthetic interrupted comparison ${id}`);
  await page.getByRole("button",{name:"Start research",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution interrupted"})).toContainText("1 of 2 batches saved");
  await page.getByRole("button",{name:"Resume remaining questions",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Execution finished"})).toContainText("2 of 2 batches saved");
  await expect(page.getByRole("region",{name:"Comparison evidence matrix",exact:true})).toHaveCount(2);
  await expect(page.getByRole("button",{name:/Open execution/})).toHaveCount(1);
});
