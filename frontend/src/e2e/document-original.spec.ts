import { expect,test,type Download } from "@playwright/test";
import { createHash,randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE,"Requires controlled original-object and SQL peers, not hosted private data.");
const documentId="64646464-6464-4464-8464-646464646464";
const sourceText="\u{1f4ca} mass: 1.005 kg; other mass 9 kg";
const expected=Buffer.from(`\uFEFFSynthetic large policy.txt\r\n${[sourceText,...Array(398).fill("Unrelated appendix material."),"Final appendix record. Reference END-400."].join("\r\n")}\r\nOriginal-file-only footer.\r\n`);
const digest=createHash("sha256").update(expected).digest("hex");
async function verifiedFile(download:Download) {
  expect(await download.failure()).toBeNull();expect(download.suggestedFilename()).toBe("Synthetic large policy.txt");
  const path=await download.path();expect(path).not.toBeNull();
  const actual=await readFile(path!);expect(actual.equals(expected)).toBe(true);expect(createHash("sha256").update(actual).digest("hex")).toBe(digest);
}
for(const theme of ["light","dark"])test(`${theme}: download the complete original from detail and drawer, not reconstructed chunks`,async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`/documents/${documentId}?actor=${randomUUID()}&theme=${theme}`);
  const [response,download]=await Promise.all([
    page.waitForResponse(r=>new URL(r.url()).pathname===`/api/v1/documents/${documentId}/original`),
    page.waitForEvent("download"),page.getByRole("button",{name:"Download original",exact:true}).click(),
  ]);
  expect(response.status()).toBe(200);expect(response.headers()["x-nexus-original-sha256"]).toBe(digest);
  await verifiedFile(download);await expect(page.getByRole("status")).toHaveText("Original verified; download started.");
  await page.reload();await expect(page.getByRole("button",{name:"Download original",exact:true})).toBeEnabled();
  await page.getByRole("link",{name:"Documents",exact:true}).click();
  await page.getByRole("button",{name:"Preview Synthetic large policy.txt",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Synthetic large policy.txt",exact:true});
  const [drawerDownload]=await Promise.all([page.waitForEvent("download"),dialog.getByRole("button",{name:"Download original",exact:true}).click()]);
  await verifiedFile(drawerDownload);await expect(dialog.getByRole("status")).toHaveText("Original verified; download started.");
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  expect(errors).toEqual([]);await dialog.screenshot({path:testInfo.outputPath(`original-download-${theme}.png`)});
});
test("cancel an actual pending transfer, then explicitly retry without exporting partial bytes",async({page})=>{
  await page.goto(`/documents/${documentId}?actor=${randomUUID()}`);
  let count=0;page.on("download",()=>count++);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/v1/documents/${documentId}/original`);
  await page.getByRole("button",{name:"Download original",exact:true}).click();await response;
  await page.getByRole("button",{name:"Cancel original download",exact:true}).click();
  await expect(page.getByRole("status")).toHaveText("Download cancelled. Transfer quota may still have been charged.");
  expect(count).toBe(0);
  const [download]=await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"Download original",exact:true}).click()]);
  await verifiedFile(download);expect(count).toBe(1);
});
test("an interrupted original request reports failure and allows retry without fabricated completion",async({page})=>{
  await page.goto(`/documents/${documentId}?actor=${randomUUID()}`);
  let count=0;page.on("download",()=>count++);
  await page.route(`**/api/v1/documents/${documentId}/original?*`,route=>route.abort("connectionfailed"),{times:1});
  await page.getByRole("button",{name:"Download original",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("original connection was interrupted");expect(count).toBe(0);
  const [download]=await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"Download original",exact:true}).click()]);
  await verifiedFile(download);expect(count).toBe(1);
});
