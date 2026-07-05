/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../test/setup-dom";
import { AuthBar } from "./AuthBar";
import type { Session } from "../data/supabaseAuth";

describe("AuthBar", () => {
  it("signed out: sends a magic link and then confirms via the email", async () => {
    const onSignIn = vi.fn().mockResolvedValue(undefined);
    render(<AuthBar session={null} onSignIn={onSignIn} onSignOut={() => {}} />);

    await userEvent.type(screen.getByPlaceholderText("you@example.com"), "traveler@example.com");
    await userEvent.click(screen.getByRole("button", { name: /Email me a link/ }));

    expect(onSignIn).toHaveBeenCalledWith("traveler@example.com");
    expect(await screen.findByText(/Check/)).toBeInTheDocument();
    expect(screen.getByText("traveler@example.com")).toBeInTheDocument();
  });

  it("signed out: shows the reason when sending the link fails", async () => {
    const onSignIn = vi.fn().mockRejectedValue(new Error("HTTP 429"));
    render(<AuthBar session={null} onSignIn={onSignIn} onSignOut={() => {}} />);

    await userEvent.type(screen.getByPlaceholderText("you@example.com"), "x@y.z");
    await userEvent.click(screen.getByRole("button", { name: /Email me a link/ }));

    expect(await screen.findByText(/HTTP 429/)).toBeInTheDocument();
  });

  it("signed in: shows the account email and signs out", async () => {
    const onSignOut = vi.fn();
    const session: Session = {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 0,
      user: { id: "u", email: "me@example.com" },
    };
    render(<AuthBar session={session} onSignIn={async () => {}} onSignOut={onSignOut} />);

    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
