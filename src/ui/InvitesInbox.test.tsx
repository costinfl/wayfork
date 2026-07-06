/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../test/setup-dom";
import { InvitesInbox } from "./InvitesInbox";
import type { TripInvite } from "../data/collab";

const invite = (over: Partial<TripInvite> = {}): TripInvite => ({
  id: "i1",
  trip_owner: "o1",
  trip_id: "t1",
  trip_name: "Lisbon · Sep 2026",
  email: "me@example.com",
  role: "editor",
  invited_by_email: "ana@example.com",
  status: "pending",
  created_at: "2026-07-01",
  ...over,
});

describe("InvitesInbox", () => {
  it("names the inviter and the trip, and accepts", async () => {
    const onAccept = vi.fn();
    render(<InvitesInbox invites={[invite()]} busyId={null} error={null} onAccept={onAccept} />);
    expect(screen.getByText(/ana@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/Lisbon · Sep 2026/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalledWith("i1");
  });

  it("shows a viewer invite as view-only and disables the accepting row", () => {
    render(
      <InvitesInbox
        invites={[invite({ role: "viewer" })]}
        busyId="i1"
        error={null}
        onAccept={() => {}}
      />
    );
    expect(screen.getByText(/view only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accepting…" })).toBeDisabled();
  });

  it("surfaces an error", () => {
    render(<InvitesInbox invites={[invite()]} busyId={null} error="HTTP 403" onAccept={() => {}} />);
    expect(screen.getByText(/HTTP 403/)).toBeInTheDocument();
  });
});
