import {expect,test,type Page} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";

test.skip(!process.env.E2E_RADAR_SQL_FIXTURE,"Requires actual disposable-SQL projections and controlled storage transport; not hosted verification.");
test.describe.configure({mode:"serial"});
test.use({trace:"retain-on-failure",screenshot:"only-on-failure"});

async function allowExistingRateWindow(page:Page){
  // This automated workflow is faster than human input. Respect the actual
  // unchanged sixty-request/minute Gateway limit rather than overriding buckets.
  await expect.poll(async()=>(await (await page.request.get("/__fixture__/quota-window")).json()).remaining_ms,
    {timeout:65_000,intervals:[2_000]}).toBe(0);
}

async function capture(page:Page,document:string){
  const region=page.getByRole("region",{name:"Capture supplied snapshot",exact:true});
  await region.getByRole("combobox",{name:"Retained document",exact:true}).selectOption(document);
  await region.locator('ul input[type="checkbox"]').first().check();
  await region.getByRole("textbox",{name:"Permission for supplied evidence",exact:true}).fill("Synthetic author owns supplied test originals; no permission to fetch or process with AI.");
  const save=region.getByRole("button",{name:"Save selected snapshot",exact:true});await save.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Snapshot revision"})).toHaveCount(0);
  await save.click();
}

for(const [theme,width] of [["light",1280],["dark",320]] as const)test(`${theme}: supplied snapshots, exact-pair and Finding review, rights, package and source-withdrawal history at ${width}px`,async({page},info)=>{
  test.setTimeout(180_000);
  const fixture=JSON.parse(await readFile(process.env.E2E_RADAR_SQL_FIXTURE!,"utf8"));
  const source=fixture.empty_source,actor=source.created_by,reviewer=fixture.approved_change.confirmed_review.reviewer_id;
  const change=fixture.changed_capture.change,errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.setViewportSize({width,height:900});
  expect((await page.request.post("/__fixture__/reset")).status()).toBe(200);
  await allowExistingRateWindow(page);
  await page.goto(`/radar?actor=${actor}&theme=${theme}`);
  await expect(page.getByRole("heading",{name:"Terms & Quota Radar",exact:true})).toBeVisible();
  await page.getByRole("combobox",{name:"Provider",exact:true}).selectOption(source.provider_id);
  await page.getByLabel("Source title",{exact:true}).fill(source.title);
  await page.getByLabel("Declared source URL",{exact:true}).fill(source.source_url);
  await page.getByRole("button",{name:"Save source",exact:true}).click();
  await expect(page.getByText("Source and manual monitor saved. No automatic retrieval is enabled.",{exact:true})).toBeVisible();
  await capture(page,fixture.chunks_before.document_id);
  await expect(page.getByRole("status").filter({hasText:"Snapshot revision 1 saved"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Save exact-pair review",exact:true})).toBeDisabled();
  await capture(page,fixture.chunks_after.document_id);
  await expect(page.getByRole("status").filter({hasText:"Snapshot revision 2 saved"})).toBeVisible();
  const selected=page.getByRole("region",{name:"Selected Radar change",exact:true});
  await expect(selected.getByText("CHANGED · OPERATIONAL · Review: PENDING",{exact:true})).toBeVisible();
  await expect(selected.getByText(change.before_text_preview,{exact:true})).toBeVisible();
  await expect(selected.getByText(change.after_text_preview,{exact:true})).toBeVisible();
  await expect(selected.getByRole("button",{name:"Save exact-pair review",exact:true})).toBeDisabled();
  const path=`/radar?source=${source.id}&change=${change.id}`;
  await page.reload();
  await expect(page.getByRole("button",{name:"Inspect snapshot revision 2",exact:true})).toBeVisible();
  await expect(selected.getByText(change.after_text_preview,{exact:true})).toBeVisible();
  await page.goto(`${path}&actor=${reviewer}&theme=${theme}`);
  await selected.getByLabel("Review comment",{exact:true}).fill(fixture.approved_change.confirmed_review.comment);
  await selected.getByRole("button",{name:"Save exact-pair review",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Review saved for this exact snapshot pair"})).toBeVisible();
  await page.goto(`${path}&actor=${actor}&theme=${theme}`);
  await selected.getByLabel("Finding title",{exact:true}).fill(fixture.finding.title);
  await selected.getByLabel("Finding qualifications",{exact:true}).fill(fixture.finding.authored_markdown);
  await selected.getByRole("button",{name:"Create reviewed-change Finding",exact:true}).click();
  const findingLink=selected.getByRole("link",{name:"Open source-linked Finding",exact:true});await expect(findingLink).toBeVisible();
  await findingLink.click();
  await expect(page.getByRole("region",{name:"Radar Finding origin",exact:true})).toContainText("Snapshot-pair review: APPROVED");
  await expect(page.getByText("2 source excerpts · 0 reviews of this revision",{exact:true})).toBeVisible();
  const packages=page.getByRole("region",{name:"Evidence packages",exact:true});
  await expect(packages.getByRole("button",{name:"Export JSON-LD & receipt",exact:true})).toBeDisabled();
  await page.getByRole("combobox",{name:"Workspace member",exact:true}).selectOption(reviewer);
  await page.getByRole("button",{name:"Share for review",exact:true}).click();
  await expect(page.getByRole("button",{name:"Revoke access",exact:true})).toBeVisible();
  const findingPath=`/findings?finding=${fixture.finding.id}`;
  await page.goto(`${findingPath}&actor=${reviewer}&theme=${theme}`);
  await page.getByLabel("Review comment",{exact:true}).fill(fixture.finding_reviewed.reviews[0].comment);
  await page.getByRole("button",{name:"Approve revision",exact:true}).click();
  await expect(page.getByText(`approved: ${fixture.finding_reviewed.reviews[0].comment}`,{exact:true})).toBeVisible();
  await page.goto(`${findingPath}&actor=${actor}&theme=${theme}`);
  const rightsReply=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith("/export-rights"));
  await packages.getByRole("button",{name:"Load export rights & packages",exact:true}).click();
  if((await rightsReply).status()===429){
    await expect(packages.getByRole("alert")).toHaveText("Per-user request limit reached.");
    await expect(packages.getByRole("button",{name:"Export JSON-LD & receipt",exact:true})).toBeDisabled();
    await allowExistingRateWindow(page);
    await packages.getByRole("button",{name:"Load export rights & packages",exact:true}).click();
  }
  await expect(packages.getByText(/Source-version rights are unknown/)).toBeVisible();
  for(const item of fixture.rights_initial.items)await packages.getByRole("checkbox",{name:item.filename,exact:true}).check();
  const policy=fixture.rights_approved.items[0].policy;
  await packages.getByRole("combobox",{name:"Decision",exact:true}).selectOption(policy.decision);
  await packages.getByRole("combobox",{name:"Rights basis",exact:true}).selectOption(policy.basis);
  await packages.getByLabel("Review rationale",{exact:true}).fill(policy.rationale);
  await packages.getByLabel("Rights evidence reference",{exact:true}).fill(policy.evidence_reference);
  await packages.getByLabel("Attribution",{exact:true}).fill(policy.attribution);
  await packages.getByLabel("Review by",{exact:true}).fill("2027-01-01T00:00");
  await packages.getByRole("button",{name:"Save version rights review",exact:true}).click();
  await expect(packages.getByText("Export rights review saved for the selected source versions.",{exact:true})).toBeVisible();
  const exporting=packages.getByRole("button",{name:"Export JSON-LD & receipt",exact:true});await exporting.click();
  await expect(packages.getByRole("alert")).toBeVisible();
  const downloading=page.waitForEvent("download");await exporting.click();
  const download=await downloading,downloadPath=await download.path();
  const bytes=JSON.parse(await readFile(downloadPath!,"utf8"));
  expect(bytes.manifest_text).toBe(fixture.package.manifest_text);
  expect(createHash("sha256").update(bytes.manifest_text).digest("hex")).toBe(fixture.package.manifest_hash);
  expect(bytes.manifest.evidence).toHaveLength(2);
  expect(bytes.manifest.analysis.coverage).toBe("SELECTED_CHUNKS_NOT_FULL_DOCUMENT");
  await page.reload();await packages.getByRole("button",{name:"Load export rights & packages",exact:true}).click();
  await expect(packages.getByRole("button",{name:"Download revision 1 package",exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await packages.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`radar-package-${theme}-${width}.png`)});
  expect((await page.request.post("/__fixture__/source-unavailable")).status()).toBe(200);await page.reload();
  await expect(page.getByText("Source evidence is unavailable. Generated content is withheld.",{exact:true})).toBeVisible();
  await packages.getByRole("button",{name:"Load export rights & packages",exact:true}).click();
  await expect(packages.getByText("Revision 1 · expired · SOURCE_UNAVAILABLE",{exact:true})).toBeVisible();
  await expect(packages.getByText(`SHA256 ${fixture.package.manifest_hash}`,{exact:true})).toBeVisible();
  await expect(packages.getByRole("button",{name:"Download revision 1 package",exact:true})).toBeDisabled();
  await page.goto(`${path}&actor=${actor}&theme=${theme}`);
  await expect(page.getByText("Source evidence is unavailable. Content and new actions are withheld.",{exact:true})).toBeVisible();
  await expect(page.getByRole("region",{name:"Selected Radar change",exact:true}).getByText(change.after_text_preview,{exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Inspect snapshot revision 1",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  const summary=await (await page.request.get("/__fixture__/summary")).json();
  expect(summary).toMatchObject({capture_commits:2,capture_distinct_keys:2,independent_pair_review:true,independent_finding_review:true,rights_review:true,package_saved:true,source_withheld:true});
  expect(summary.capture_attempts).toHaveLength(4);
  expect(summary.capture_attempts[0].key).toBe(summary.capture_attempts[1].key);
  expect(summary.capture_attempts[2].key).toBe(summary.capture_attempts[3].key);
  await info.attach("controlled-radar-transport-summary",{body:JSON.stringify(summary,null,2),contentType:"application/json"});
  await page.screenshot({path:info.outputPath(`radar-source-withheld-${theme}-${width}.png`)});
});
