/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../test/setup-dom";
import { MigrationBanner } from "./MigrationBanner";
import type { Trip } from "../domain/types";

const trip = (id: string, name: string): Trip => ({
  id,
  name,
  participants: [],
  currencies: { home: "RON", local: "EUR", intl: "USD" },
  days: [],
  expenses: [],
});

const trips = [trip("a", "Rome"), trip("b", "Lisbon")];

describe("MigrationBanner", () => {
  it("counts and names the trips it offers to import", () => {
    render(<MigrationBanner trips={trips} busy={false} onImport={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/2 trips saved in this browser/)).toBeInTheDocument();
    expect(screen.getByText(/Rome, Lisbon/)).toBeInTheDocument();
  });

  it("fires onImport and onDismiss on the buttons", async () => {
    const onImport = vi.fn();
    const onDismiss = vi.fn();
    render(<MigrationBanner trips={trips} busy={false} onImport={onImport} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onImport).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("surfaces an import error", () => {
    render(
      <MigrationBanner
        trips={trips}
        busy={false}
        error="Couldn't import 1 trip — HTTP 403."
        onImport={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText(/HTTP 403/)).toBeInTheDocument();
  });

  it("disables the buttons while importing", () => {
    render(<MigrationBanner trips={trips} busy onImport={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not now" })).toBeDisabled();
  });
});
