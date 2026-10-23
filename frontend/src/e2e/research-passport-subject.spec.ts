import {expect,test} from "@playwright/test";
import {randomUUID} from "node:crypto";

test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE,"Requires controlled synthetic UI/Gateway peers, not a hosted origin.");
const subject={"Product identifier":"synthetic-sensor-42","Product name":"Synthetic sensor","Product version":"2.1","Supplier":"Synthetic supplier"};
async function fill(page: import("@playwright/test").Page,question:string,theme="light"){
  await page.goto(`/?actor=${randomUUID()}&theme=${theme}`);await expect(page.getByRole("button",{name:"Save plan",exact:true})).toBeEnabled();
  await page.getByLabel("Mode",{exact:true}).selectOption("PRODUCT_PASSPORT");
  for(const [label,value] of Object.entries(subject))await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByLabel("Question",{exact:true}).fill(question);await page.getByLabel("Completion criteria").fill("Inspect the exact supplied evidence");
}
for(const theme of ["light","dark"])test(`${theme}: declared passport identity saves, reloads and copies into a distinct version`,async({page},info)=>{
  const question=`Synthetic passport subject ${theme} ${info.project.name}`;await fill(page,question,theme);
  const background=theme==="dark"?"rgb(10, 14, 26)":"rgb(255, 255, 255)";
  await expect(page.locator("body")).toHaveCSS("background-color",background);
  await page.getByRole("button",{name:"Save plan",exact:true}).click();
  const declared=page.getByRole("region",{name:"Declared product",exact:true});
  await expect(declared).toBeVisible();for(const value of Object.values(subject))await expect(declared.getByText(value,{exact:true})).toBeVisible();
  await expect(page.getByText("Execution is not implemented for this mode. The saved plan remains available.",{exact:true})).toBeVisible();
  await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();
  await expect(page.locator("body")).toHaveCSS("background-color",background);
  await expect(declared.getByText("2.1",{exact:true})).toBeVisible();await page.getByRole("button",{name:"Copy to a new plan"}).click();
  for(const [label,value] of Object.entries(subject))await expect(page.getByLabel(label,{exact:true})).toHaveValue(value);
  await page.getByLabel("Question",{exact:true}).fill(`${question} version 3`);await page.getByLabel("Product version",{exact:true}).fill("3.0");
  await page.getByRole("button",{name:"Save plan",exact:true}).click();await expect(declared.getByText("3.0",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();await expect(declared.getByText("2.1",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("passport-subject-stored.png"),fullPage:true});
});
test("an interrupted passport save keeps the product and retries one durable intent",async({page},info)=>{
  const creates:Array<{key:string|undefined;body:unknown}>=[];
  page.on("request",request=>{if(request.method()==="POST"&&new URL(request.url()).pathname==="/api/v2/research/plans")creates.push({key:request.headers()["idempotency-key"],body:request.postDataJSON()});});
  const question=`Synthetic interrupted save passport ${info.project.name}`;await fill(page,question);
  await page.getByRole("button",{name:"Save plan",exact:true}).click();await expect(page.getByRole("alert")).toBeVisible();
  for(const [label,value] of Object.entries(subject))await expect(page.getByLabel(label,{exact:true})).toHaveValue(value);
  await page.getByRole("button",{name:"Save plan",exact:true}).click();await expect(page.getByRole("region",{name:"Declared product",exact:true})).toBeVisible();
  expect(creates).toHaveLength(2);expect(creates[0]).toEqual(creates[1]);
  await page.reload();await expect(page.getByRole("button",{name:`Open research plan: ${question}`,exact:true})).toHaveCount(1);
});
test("long Unicode product fields preserve the declared identity without layout overflow",async({page},info)=>{
  await fill(page,`Synthetic Unicode passport ${info.project.name}`);
  const name="\u{1f4ca}".repeat(256),identifier="X".repeat(128);
  await page.getByLabel("Product name",{exact:true}).fill(name);await page.getByLabel("Product identifier",{exact:true}).fill(identifier);
  await page.getByRole("button",{name:"Save plan",exact:true}).click();const declared=page.getByRole("region",{name:"Declared product",exact:true});
  await expect(declared.getByText(name,{exact:true})).toBeVisible();await expect(declared.getByText(identifier,{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("passport-subject-long.png"),fullPage:true});
});
