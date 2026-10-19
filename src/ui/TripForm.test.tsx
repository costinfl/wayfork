/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../test/setup-dom";
import { TripForm } from "./TripForm";
import type { Trip } from "../domain/types";

describe("TripForm (new-trip mode)", () => {
  it("creates a trip from name, start date, start place and non-empty participants", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(t: Trip) => string[]>(() => []);
    const vienna = { name: "Vienna, Austria", lat: 48.21, lon: 16.37 };
    render(<TripForm initial={null} onSave={onSave} onCancel={vi.fn()} search={async () => [vienna]} />);
    await user.type(screen.getByPlaceholderText("search a city…"), "Vie");
    const option = await screen.findByRole("option", { name: vienna.name });
    await user.click(within(option).getByRole("button"));
    fireEvent.change(screen.getByLabelText("Trip name"), { target: { value: "Vienna" } });
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByPlaceholderText("name"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Create trip" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const trip = onSave.mock.calls[0][0];
    expect(trip.name).toBe("Vienna");
    expect(trip.days[0].date).toBe("2026-10-01");
    expect(trip.participants.map((p) => p.name)).toEqual(["Ana"]);
    expect(trip.currencies).toEqual({ home: "RON", local: "EUR", intl: "USD" });
    expect(trip.days[0].slots.length).toBeGreaterThanOrEqual(1); // starter invariant
    expect(trip.days[0].slots[0].place).toMatchObject({ name: "Vienna, Austria" });
  });

  it("rejects a submit without any named participant, without calling onSave", () => {
    const onSave = vi.fn<(t: Trip) => string[]>(() => []);
    render(<TripForm initial={null} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Trip name"), { target: { value: "Vienna" } });
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create trip" }));

    expect(screen.getByText(/at least one participant is required/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
