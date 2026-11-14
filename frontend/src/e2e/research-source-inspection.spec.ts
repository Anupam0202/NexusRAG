import { expect,test } from "@playwright/test";
import { createHash,randomUUID } from "node:crypto";

test.skip(!process.env.E2E_RESEARCH_COMPONENT_FIXTURE,"Requires isolated UI/Gateway peers, not a hosted origin.");
const documentId="64646464-6464-4464-8464-646464646464";
const version="74747474-7474-4474-8474-747474747474";
const lastText="Final appendix record. Reference END-400.";
const lastHash=createHash("sha256").update(lastText).digest("hex");

for(const theme of ["light","dark"])test(`${theme}: inspect all400chunks, retry interruption, search beyond first page and use library drawer`,async({page},testInfo)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`/documents/${documentId}?actor=${randomUUID()}&theme=${theme}`);
  await expect(page.getByRole("heading",{name:"Synthetic large policy.txt",exact:true})).toBeVisible();
  await expect(page.getByText("400 indexed chunks · showing 80",{exact:true})).toBeVisible();
  expect(await page.locator("article").count()).toBe(80);
  let interruptions=0;
  const cursors:string[]=[];
  await page.route(`**/api/v1/documents/${documentId}/chunks?*`,async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.has("after")) {
      cursors.push(`${url.searchParams.get("after")}:${url.searchParams.get("version_id")}`);
      if(interruptions++===0)return route.abort("connectionfailed");
    }
    return route.continue();
  });
  await page.getByRole("button",{name:"Load more chunks",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Previously loaded previews are retained");
  await expect(page.getByText("Showing 80 chunk previews · total unverified",{exact:true})).toBeVisible();
  expect(await page.locator("article").count()).toBe(80);
  await page.getByRole("button",{name:"Retry loading more chunks",exact:true}).click();
  await expect(page.getByText("400 indexed chunks · showing 160",{exact:true})).toBeVisible();
  expect(cursors.slice(0,2)).toEqual([`79:${version}`,`79:${version}`]);
  for(const count of [240,320,400]) {
    await page.getByRole("button",{name:"Load more chunks",exact:true}).click();
    await expect(page.getByText(`400 indexed chunks · showing ${count}`,{exact:true})).toBeVisible();
  }
  await expect(page.locator("article")).toHaveCount(400);
  await expect(page.getByRole("button",{name:"Load more chunks",exact:true})).toHaveCount(0);
  expect(await page.locator("article").evaluateAll(items=>new Set(items.map(item=>item.querySelector("span")?.textContent)).size)).toBe(400);
  const search=page.getByRole("textbox",{name:"Search indexed chunks",exact:true});
  await search.fill("END-400");
  await expect(page.getByText("1 matching chunk · showing 1",{exact:true})).toBeVisible();
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.getByText(lastText,{exact:true})).toBeVisible();
  await page.getByText("Source receipt for chunk 400",{exact:true}).click();
  await expect(page.getByText(`SHA256 ${lastHash}`,{exact:true})).toBeVisible();
  await expect(page.getByText(`Version ${version}`,{exact:true})).toBeVisible();
  await expect(page.getByText("Page 3",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`document-source-${theme}.png`)});
  await search.fill("No such synthetic phrase");
  await expect(page.getByText("0 matching chunks · showing 0",{exact:true})).toBeVisible();
  await expect(page.getByText("No chunks matched",{exact:true})).toBeVisible();
  await search.fill("");
  await expect(page.getByText("400 indexed chunks · showing 80",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Refresh chunks",exact:true}).click();
  await expect(page.getByText("400 indexed chunks · showing 80",{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText("400 indexed chunks · showing 80",{exact:true})).toBeVisible();
  await page.getByRole("link",{name:"Documents",exact:true}).click();
  const preview=page.getByRole("button",{name:"Preview Synthetic large policy.txt",exact:true});
  await preview.click();
  const dialog=page.getByRole("dialog",{name:"Synthetic large policy.txt",exact:true});
  await expect(dialog.getByText("400 indexed chunks · showing 50",{exact:true})).toBeVisible();
  await dialog.getByRole("textbox",{name:"Search indexed chunks",exact:true}).fill("END-400");
  await expect(dialog.getByText("1 matching chunk · showing 1",{exact:true})).toBeVisible();
  await dialog.getByText("Source receipt for chunk 400",{exact:true}).click();
  await expect(dialog.getByText(`SHA256 ${lastHash}`,{exact:true})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(preview).toBeFocused();
  await preview.click();
  await page.getByRole("link",{name:"Open full details for Synthetic large policy.txt",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${documentId}$`));
  await expect(page.getByText("400 indexed chunks · showing 80",{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

for(const width of [320,768])for(const theme of ["light","dark"])test(`${width}px ${theme}: source receipt fits document detail and drawer`,async({page},testInfo)=>{
  test.skip(testInfo.project.name!=="mobile-chrome","Additional narrow/tablet views supplement both native project viewports.");
  await page.setViewportSize({width,height:900});
  await page.goto(`/documents/${documentId}?theme=${theme}`);
  await page.getByRole("textbox",{name:"Search indexed chunks",exact:true}).fill("END-400");
  await expect(page.getByText("1 matching chunk · showing 1",{exact:true})).toBeVisible();
  await page.getByText("Source receipt for chunk 400",{exact:true}).click();
  await expect(page.getByText(`SHA256 ${lastHash}`,{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const chunks=page.locator("section").filter({has:page.getByRole("heading",{name:"Indexed chunks",exact:true})});
  expect(await chunks.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.getByRole("link",{name:"Documents",exact:true}).click();
  await page.getByRole("button",{name:"Preview Synthetic large policy.txt",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Synthetic large policy.txt",exact:true});
  await dialog.getByRole("textbox",{name:"Search indexed chunks",exact:true}).fill("END-400");
  await expect(dialog.getByText("1 matching chunk · showing 1",{exact:true})).toBeVisible();
  await dialog.getByText("Source receipt for chunk 400",{exact:true}).click();
  await expect(dialog.getByText(`SHA256 ${lastHash}`,{exact:true})).toBeVisible();
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await dialog.screenshot({path:testInfo.outputPath(`source-drawer-${width}-${theme}.png`)});
});
