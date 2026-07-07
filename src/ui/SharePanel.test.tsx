/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../test/setup-dom";
import { SharePanel } from "./SharePanel";
import type { TripInvite, TripMember } from "../data/collab";

const member = (over: Partial<TripMember> = {}): TripMember => ({
  trip_owner: "o",
  trip_id: "t",
  user_id: "u-bob",
  email: "bob@example.com",
  role: "editor",
  added_at: "2026-07-01",
  ...over,
});
const invite = (over: Partial<TripInvite> = {}): TripInvite => ({
  id: "i1",
  trip_owner: "o",
  trip_id: "t",
  trip_name: "Rome",
  email: "cara@example.com",
  role: "viewer",
  invited_by_email: "me@example.com",
  status: "pending",
  created_at: "2026-07-01",
  ...over,
});

const noop = () => {};

describe("SharePanel", () => {
  it("invites with the selected role", async () => {
    const onInvite = vi.fn();
    render(
      <SharePanel tripName="Rome" invites={[]} members={[]} busy={false} error={null} onInvite={onInvite} onRevoke={noop} onRemoveMember={noop} onClose={noop} />
    );
    await userEvent.type(screen.getByPlaceholderText("friend@example.com"), "v@example.com");
    await userEvent.selectOptions(screen.getByRole("combobox"), "viewer");
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(onInvite).toHaveBeenCalledWith("v@example.com", "viewer");
  });

  it("lists members with a remove control and pending invites", async () => {
    const onRemoveMember = vi.fn();
    render(
      <SharePanel
        tripName="Rome"
        invites={[invite()]}
        members={[member()]}
        busy={false}
        error={null}
        onInvite={noop}
        onRevoke={noop}
        onRemoveMember={onRemoveMember}
        onClose={noop}
      />
    );
    expect(screen.getByText("bob@example.com")).toBeInTheDocument(); // roster
    expect(screen.getByText("cara@example.com")).toBeInTheDocument(); // pending
    await userEvent.click(screen.getAllByRole("button", { name: "✕" })[0]);
    expect(onRemoveMember).toHaveBeenCalledWith("u-bob");
  });

  it("hides the owner from the roster", () => {
    render(
      <SharePanel
        tripName="Rome"
        invites={[]}
        members={[member({ role: "owner", email: "owner@example.com" })]}
        busy={false}
        error={null}
        onInvite={noop}
        onRevoke={noop}
        onRemoveMember={noop}
        onClose={noop}
      />
    );
    expect(screen.queryByText("owner@example.com")).toBeNull();
  });
});
