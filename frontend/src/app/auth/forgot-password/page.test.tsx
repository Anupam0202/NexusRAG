import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { navigateStatic } from "@/lib/static-navigation";

import ForgotPasswordPage from "./page";

vi.mock("@/lib/static-navigation", () => ({ navigateStatic: vi.fn() }));

describe("ForgotPasswordPage", () => {
  it("renders a static sign-in redirect and a usable fallback link", () => {
    render(<ForgotPasswordPage />);

    expect(screen.getByRole("link", { name: "continue" })).toHaveAttribute(
      "href",
      "/auth/login"
    );
    expect(navigateStatic).toHaveBeenCalledWith("/auth/login");
  });
});
