/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/setup-dom";
import { TripForm } from "./TripForm";

describe("TripForm (new-trip mode)", () => {
  it("creates a trip from name, start date and non-empty participants", () => {
    const onSave = vi.fn(() => [] as string[]);
    render(<TripForm initial={null} onSave={onSave} onCancel={vi.fn()} />);
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
  });

  it("rejects a submit without any named participant, without calling onSave", () => {
    const onSave = vi.fn(() => [] as string[]);
    render(<TripForm initial={null} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Trip name"), { target: { value: "Vienna" } });
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create trip" }));

    expect(screen.getByText(/at least one participant is required/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
