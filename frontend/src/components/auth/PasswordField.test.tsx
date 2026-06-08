import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PasswordField } from "./PasswordField";
import { PasswordRequirements } from "./PasswordRequirements";

describe("PasswordField", () => {
  it("uses an accessible label and the requested autocomplete value", () => {
    render(
      <PasswordField
        id="password"
        label="Password"
        value=""
        onChange={() => {}}
        autoComplete="current-password"
      />
    );

    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("toggles password visibility with an accessible icon button", () => {
    render(
      <PasswordField
        id="new-password"
        label="New password"
        value="SecurePass1!"
        onChange={() => {}}
        autoComplete="new-password"
      />
    );

    const input = screen.getByLabelText("New password");
    expect(input).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeVisible();
  });
});

describe("PasswordRequirements", () => {
  it("announces requirement state without exposing the password", () => {
    render(<PasswordRequirements password="SecurePass1!" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("12-128 characters");
    expect(status).toHaveTextContent("Uppercase letter");
    expect(status).not.toHaveTextContent("SecurePass1!");
  });
});
