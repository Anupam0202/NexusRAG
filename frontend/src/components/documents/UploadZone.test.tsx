import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("requires an explicit non-sensitive attestation before submitting a file", async () => {
    const onUpload = vi.fn().mockResolvedValue({
      success: true,
      message: "accepted",
      document: { chunk_count: 1 },
    });
    render(
      <UploadZone
        onUpload={onUpload}
        uploading={false}
        limits={DEFAULT_UPLOAD_LIMITS}
      />
    );

    const input = screen.getByLabelText("Upload NexusRAG documents");
    const attestation = screen.getByRole("checkbox", {
      name: /I confirm this document contains no personal, confidential, regulated, or other sensitive data/i,
    });
    expect(attestation).not.toBeChecked();
    expect(input).toBeDisabled();

    fireEvent.click(attestation);
    expect(input).toBeEnabled();

    const file = new File(
      ["synthetic public validation fixture; no personal or confidential data"],
      "nexusrag-synthetic-validation.txt",
      { type: "text/plain" }
    );
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalledWith(file, "non_sensitive");
    });
  });
});
