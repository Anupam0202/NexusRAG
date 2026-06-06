import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_UPLOAD_LIMITS, UploadZone } from "./UploadZone";

describe("UploadZone", () => {
  it("exposes the signed-out upload control as disabled", () => {
    render(
      <UploadZone
        onUpload={vi.fn()}
        uploading={false}
        limits={DEFAULT_UPLOAD_LIMITS}
        disabledReason="Sign in to upload documents"
      />
    );

    expect(screen.getByLabelText("Upload NexusRAG documents")).toBeDisabled();
    expect(screen.getByText("Sign in to upload documents").closest("[role]")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });
});
