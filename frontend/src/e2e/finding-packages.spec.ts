import {expect,test} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";

test.skip(!process.env.E2E_PACKAGE_SQL_FIXTURE,"Requires real disposable SQL output and controlled Gateway transport, not hosted data.");
for(const theme of ["light","dark"])test(`${theme}: rights review, interrupted package retry, exact download and revocation`,async({page},testInfo)=>{
  const packageFixture=JSON.parse(await readFile(process.env.E2E_PACKAGE_SQL_FIXTURE!,"utf8"));
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`/findings?finding=${packageFixture.finding_id}&actor=${randomUUID()}&theme=${theme}`);
  await expect(page.getByLabel("Title",{exact:true})).toHaveValue("Exported synthetic answer");
  const region=page.getByRole("region",{name:"Evidence packages",exact:true});
  await expect(region.getByRole("button",{name:"Export JSON-LD & receipt",exact:true})).toBeDisabled();
  await region.getByRole("button",{name:"Load export rights & packages",exact:true}).click();
  await expect(region.getByText(/Source-version rights are unknown/)).toBeVisible();
  await region.getByRole("checkbox",{name:"owned-source.txt",exact:true}).check();
  await region.getByRole("combobox",{name:"Decision",exact:true}).selectOption("ALLOW");
  await region.getByRole("combobox",{name:"Rights basis",exact:true}).selectOption("OWNED_CONTENT");
  await region.getByLabel("Review rationale",{exact:true}).fill("Synthetic author owns this fixture.");
  await region.getByLabel("Rights evidence reference",{exact:true}).fill("urn:fixture:owned61");
  await region.getByLabel("Attribution",{exact:true}).fill("Synthetic fixture author");
  await region.getByLabel("Duties",{exact:true}).fill("Retain qualifications");
  await region.getByLabel("Review by",{exact:true}).fill("2027-01-01T12:00");
  await region.getByRole("button",{name:"Save version rights review",exact:true}).click();
  await expect(region.getByText("Export rights review saved for the selected source versions.",{exact:true})).toBeVisible();
  const exporting=region.getByRole("button",{name:"Export JSON-LD & receipt",exact:true});
  await exporting.click();
  // The fixture interrupts only its first committed package response across this owned server.
  const first=await Promise.race([region.getByRole("alert").waitFor().then(()=>({interrupted:true,download:null})),page.waitForEvent("download").then(download=>({interrupted:false,download}))]);
  let download=first.download;
  if(first.interrupted){
    const pending=page.waitForEvent("download");await exporting.click();download=await pending;
  }
  await expect(region.getByRole("button",{name:"Download revision 1 package",exact:true})).toBeVisible();
  if(download){const file=await download.path();const bytes=JSON.parse(await readFile(file!,"utf8"));
    expect(bytes.manifest_text).toBe(packageFixture.manifest_text);expect(createHash("sha256").update(bytes.manifest_text).digest("hex")).toBe(bytes.manifest_hash);
    expect(bytes.manifest.analysis.coverage.completeness).toBe("NOT_EXHAUSTIVE");}
  await page.reload();await region.getByRole("button",{name:"Load export rights & packages",exact:true}).click();
  const pending=page.waitForEvent("download");await region.getByRole("button",{name:"Download revision 1 package",exact:true}).click();await pending;
  await region.getByRole("checkbox",{name:"owned-source.txt",exact:true}).check();
  await region.getByRole("combobox",{name:"Decision",exact:true}).selectOption("REVOKED");
  await region.getByLabel("Review rationale",{exact:true}).fill("Withdrawn synthetic permission.");
  await region.getByRole("button",{name:"Save version rights review",exact:true}).click();
  await expect(exporting).toBeDisabled();
  await region.getByRole("button",{name:"Load export rights & packages",exact:true}).click();
  await expect(region.getByText(/Revision 1 · expired · RIGHTS_BLOCKED/)).toBeVisible();
  await expect(region.getByRole("button",{name:"Download revision 1 package",exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);
  await region.getByText(/Revision 1 · expired · RIGHTS_BLOCKED/).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath(`finding-packages-receipt-${theme}.png`)});
});
