/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../test/setup-dom";
import AdminPanel, { type AdminUser } from "./AdminPanel";
import type { Session } from "../data/supabaseAuth";

const session = {
  accessToken: "jwt-token",
  refreshToken: "r",
  user: { id: "admin-id", email: "costinfl@gmail.com" },
} as unknown as Session;

const USERS: AdminUser[] = [
  {
    id: "admin-id",
    email: "costinfl@gmail.com",
    createdAt: "2026-01-01T00:00:00Z",
    lastSignInAt: "2026-07-01T00:00:00Z",
    disabled: false,
    ownedTrips: 3,
    isAdmin: true,
  },
  {
    id: "u2",
    email: "friend@example.com",
    createdAt: "2026-02-01T00:00:00Z",
    lastSignInAt: null,
    disabled: false,
    ownedTrips: 1,
    isAdmin: false,
  },
];

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => body }) as unknown as Response;

let fetchFn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
    if (body.action === "list") return jsonResponse({ users: USERS });
    return jsonResponse({ ok: true });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const renderPanel = () =>
  render(
    <AdminPanel
      session={session}
      onClose={vi.fn()}
      endpoint="https://example.test/admin-users"
      fetchFn={fetchFn as unknown as typeof fetch}
    />
  );

describe("AdminPanel", () => {
  it("lists users with the admin JWT and hides actions on the admin row", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("friend@example.com")).toBeTruthy());
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-token");
    expect(JSON.parse(String(init.body))).toEqual({ action: "list" });
    expect(screen.getByText("admin")).toBeTruthy();
    // One user row is actionable (the non-admin), so exactly one Disable button.
    expect(screen.getAllByText("Disable")).toHaveLength(1);
  });

  it("disables a user and refreshes the list", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("Disable")).toBeTruthy());
    fireEvent.click(screen.getByText("Disable"));
    await waitFor(() => {
      const actions = fetchFn.mock.calls.map(
        (c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)) as {
          action: string;
          userId?: string;
        }
      );
      expect(actions).toContainEqual({ action: "disable", userId: "u2" });
      expect(actions.filter((a) => a.action === "list").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("deletes only after both confirmations", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(true).mockReturnValueOnce(false);
    renderPanel();
    await waitFor(() => expect(screen.getByText("Delete + trips")).toBeTruthy());
    fireEvent.click(screen.getByText("Delete + trips"));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    const actions = fetchFn.mock.calls.map(
      (c) => (JSON.parse(String((c as unknown as [string, RequestInit])[1].body)) as { action: string }).action
    );
    expect(actions).not.toContain("delete");

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByText("Delete + trips"));
    await waitFor(() => {
      const after = fetchFn.mock.calls.map(
        (c) => (JSON.parse(String((c as unknown as [string, RequestInit])[1].body)) as { action: string }).action
      );
      expect(after).toContain("delete");
    });
  });

  it("surfaces server errors", async () => {
    fetchFn.mockResolvedValue(jsonResponse({ error: "Not authorized" }, 403));
    renderPanel();
    await waitFor(() => expect(screen.getByText("Not authorized")).toBeTruthy());
  });
});
