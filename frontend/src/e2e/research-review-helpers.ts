import { expect,type Page } from "@playwright/test";

export async function selectWorkspaceReviewer(page:Page,reviewer:string) {
  const members=page.getByRole("combobox",{name:"Workspace member",exact:true});
  const option=members.locator(`option[value="${reviewer}"]`);
  for(let i=0;i<10&&!await option.count();i++) {
    const count=await members.locator("option").count();
    await page.getByRole("button",{name:"Load more workspace members",exact:true}).click();
    await expect(members.locator("option")).not.toHaveCount(count);
  }
  await expect(option).toHaveCount(1);
  await members.selectOption(reviewer);
}
