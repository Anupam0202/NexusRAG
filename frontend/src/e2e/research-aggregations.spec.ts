import {expect,test} from "@playwright/test";
import {randomUUID} from "node:crypto";
test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE,"Requires isolated synthetic UI/API/Gateway transport, not a hosted origin.");
for(const theme of ["light","dark"])test(`${theme}: weighted grouped series retries, reloads and preserves exclusions`,async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`/?theme=${theme}&actor=${randomUUID()}`);let unexpectedNavigations=0;
  page.on("framenavigated",frame=>{if(frame===page.mainFrame())unexpectedNavigations++;});
  const question=`Synthetic aggregate ${theme} ${testInfo.project.name}`;
  await page.getByLabel("Mode").selectOption("CALCULATION");await page.getByLabel("Question",{exact:true}).fill(question);
  await page.getByLabel("Completion criteria").fill("Review weighted calculation and excluded inputs");await page.getByRole("button",{name:"Save plan",exact:true}).click();
  await page.getByRole("radio",{name:"Series",exact:true}).check();
  const execute=page.getByRole("button",{name:"Calculate and save series",exact:true});await expect(execute).toBeEnabled();
  await page.getByLabel("Series operation").selectOption("WEIGHTED_AVERAGE");await page.getByLabel("Series decimal places").fill("2");
  await page.getByLabel("Missing values").selectOption("EXCLUDE");await page.getByLabel("Group results").check();await page.getByRole("button",{name:"Add value",exact:true}).click();
  for(let index=1;index<=3;index++){
    await page.getByLabel(`Series value ${index}`,{exact:true}).fill(index===1?"0.1":index===2?"0.2":"");
    await page.getByLabel(`Series unit ${index}`,{exact:true}).fill("USD");await page.getByLabel(`Series group ${index}`,{exact:true}).fill("A");
    await page.getByLabel(`Series weight ${index}`,{exact:true}).fill(index===1?"1":index===2?"3":"0");
    await page.getByLabel(`Series evidence references ${index}`,{exact:true}).fill(`synthetic-series-${index}`);
  }
  const keys:string[]=[];page.on("request",request=>{if(request.method()==="POST" && new URL(request.url()).pathname.endsWith("/aggregations"))keys.push(request.headers()["idempotency-key"]);});
  await execute.click();await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByLabel("Series weight 2")).toHaveValue("3");
  await expect(page.getByLabel("Aggregate value")).toHaveCount(0);await execute.click();
  await expect(page.getByLabel("Aggregate value")).toHaveText("0.18 USD");await expect(page.getByText("2 included; 1 excluded",{exact:true})).toBeVisible();
  await expect(page.getByText("Excluded inputs: 3",{exact:true})).toBeVisible();
  expect(keys).toHaveLength(2);expect(keys[0]).toBeTruthy();expect(keys[0]).toBe(keys[1]);
  await page.getByText("Expression & references",{exact:true}).click();await expect(page.getByText("weighted_average(0.1,0.2;weights=1,3)",{exact:true})).toBeVisible();
  expect(unexpectedNavigations).toBe(0);await page.reload();await page.getByRole("button",{name:`Open research plan: ${question}`,exact:true}).click();
  await page.getByRole("radio",{name:"Series",exact:true}).check();await page.getByRole("button",{name:"weighted average; 1 group",exact:true}).click();
  await expect(page.getByLabel("Aggregate value")).toHaveText("0.18 USD");await expect(page.getByLabel("Aggregate value")).toHaveCount(1);
  await page.getByRole("button",{name:"Use inputs",exact:true}).click();await expect(page.getByLabel("Series value 1")).toBeFocused();
  await expect(page.getByLabel("Series value 3")).toHaveValue("");await expect(page.getByLabel("Series weight 2")).toHaveValue("3");
  await page.getByLabel("Aggregate value").scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);await page.screenshot({path:testInfo.outputPath("aggregate-stored.png")});
});
