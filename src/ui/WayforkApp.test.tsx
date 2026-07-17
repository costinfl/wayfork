/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../test/setup-dom";

// Keep the network out of component tests: the live-rates fetch rejects and
// the app stays on its built-in snapshot (the caller's documented fallback).
vi.mock("../domain/rates", () => ({
  fetchRatesEUR: vi.fn(async () => {
    throw new Error("offline");
  }),
}));

import WayforkApp from "./WayforkApp";
import { TripConflictError } from "../data/repository";
import type { TripStore } from "../data/repository";
import { newTrip, starterSlot } from "../domain/mutate";
import type { AuthClient, Session } from "../data/supabaseAuth";
import type { Trip } from "../domain/types";

// These tests exercise WIRING, not the engines: mergeTrip/validateTrip are
// covered in src/domain — here we assert the component calls the store the
// right way and renders the right banners.

const session: Session = {
  accessToken: "tok",
  refreshToken: "r",
  expiresAt: 9_999_999_999,
  user: { id: "u1", email: "ana@example.com" },
};

const stubAuth = (overrides: Partial<AuthClient> = {}): AuthClient => ({
  getSession: () => session,
  sendMagicLink: async () => {},
  consumeUrlTokens: async () => null,
  getAccessToken: async () => "tok",
  signOut: async () => {},
  ...overrides,
});

const stubStore = (impl: Partial<TripStore> = {}): TripStore => ({
  list: async () => [],
  save: async (t) => t,
  remove: async () => {},
  ...impl,
});

// A two-slot stored trip so a "Move down" both changes content and is the
// cheapest UI action that routes through applyTrip → saveTrip → persist.
const fixture = (): Trip => {
  const t = newTrip(
    "Shared trip",
    "2026-08-01",
    [{ id: "p1", name: "Ana" }],
    { home: "RON", local: "EUR", intl: "USD" }
  );
  t.days[0].slots.push(starterSlot("EUR", "Second stop"));
  return { ...t, uid: "uid-shared", version: 1 };
};

const renderApp = (remoteStore: TripStore, auth: AuthClient = stubAuth()) =>
  render(
    <WayforkApp deps={{ auth, remoteStore, localStore: stubStore(), collab: null }} />
  );

// Select the stored trip in the picker, wait for its timeline, and perform
// the minimal persisted edit: Edit mode → move the first slot down.
const editFixtureTrip = async () => {
  const option = await screen.findByRole("option", { name: /Shared trip/ });
  fireEvent.change(option.closest("select")!, { target: { value: "uid-shared" } });
  await screen.findByText("Second stop");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getAllByTitle("Move down")[0]);
};

describe("WayforkApp conflict → merge → retry wiring", () => {
  it("re-merges a rejected save onto the fresh remote and retries with its version", async () => {
    const base = fixture();
    const remote: Trip = { ...structuredClone(base), name: "Renamed by co-editor", version: 2 };
    const save = vi
      .fn<(t: Trip) => Promise<Trip>>()
      .mockImplementationOnce(async () => {
        throw new TripConflictError(remote);
      })
      .mockImplementation(async (t) => t);

    renderApp(stubStore({ list: async () => [base], save }));
    await editFixtureTrip();

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const retried = save.mock.calls[1][0];
    // The retry carries the merged trip: their rename, my slot order, and the
    // fresh concurrency token from the rejecting remote.
    expect(retried.version).toBe(2);
    expect(retried.name).toBe("Renamed by co-editor");
    expect(retried.days[0].slots.map((s) => s.title)).toEqual(["Second stop", "New slot"]);

    // Non-overlapping merge surfaces the informational banner.
    expect(await screen.findByText("Merged an update from another editor.")).toBeInTheDocument();
  });

  it("bails out after bounded retries, reloads the latest, and shows the warning", async () => {
    const base = fixture();
    const remote: Trip = { ...structuredClone(base), name: "Racing writer", version: 2 };
    const save = vi.fn<(t: Trip) => Promise<Trip>>(async () => {
      throw new TripConflictError(remote);
    });
    const list = vi.fn(async () => [base]);

    renderApp(stubStore({ list, save }));
    await editFixtureTrip();

    expect(
      await screen.findByText(
        "This trip changed elsewhere and couldn't be auto-merged — reloaded to the latest."
      )
    ).toBeInTheDocument();
    // persist() attempts exactly 3 saves — the loop is bounded, not infinite.
    expect(save).toHaveBeenCalledTimes(3);
    // The bail-out path re-reads the store so the user edits real state.
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
