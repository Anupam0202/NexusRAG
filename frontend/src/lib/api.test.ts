import { describe, expect, it } from "vitest";

import { formatApiErrorDetail } from "./api";

describe("formatApiErrorDetail", () => {
  it("describes structured workspace cleanup failures", () => {
    expect(
      formatApiErrorDetail(
        {
          message: "Workspace deletion stopped because data cleanup was incomplete.",
          failures: [
            {
              resource: "workspaces",
              message: "The workspace owner membership cannot be changed or removed.",
            },
          ],
        },
        "HTTP 502"
      )
    ).toBe(
      "Workspace deletion stopped because data cleanup was incomplete. " +
        "workspaces: The workspace owner membership cannot be changed or removed."
    );
  });
});
