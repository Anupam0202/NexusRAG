import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { navigateStatic } from "@/lib/static-navigation";

import UpdatePasswordPage from "./page";

vi.mock("@/lib/static-navigation", () => ({ navigateStatic: vi.fn() }));

describe("UpdatePasswordPage", () => {
  it("renders a static sign-in redirect and a usable fallback link", () => {
    render(<UpdatePasswordPage />);

    expect(screen.getByRole("link", { name: "continue" })).toHaveAttribute(
      "href",
      "/auth/login"
    );
    expect(navigateStatic).toHaveBeenCalledWith("/auth/login");
  });
});
