/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/setup-dom";
import { DayForm } from "./DayForm";
import { newTrip } from "../domain/mutate";
import type { Day } from "../domain/types";

const trip = newTrip("T", "2026-08-01", [{ id: "p1", name: "Ana" }], {
  home: "RON",
  local: "EUR",
  intl: "USD",
});

describe("DayForm", () => {
  it("submits date + departure with a starter slot and no location", () => {
    const onSave = vi.fn<(d: Day) => string[]>(() => []);
    render(
      <DayForm trip={trip} initial={null} defaultDate="2026-08-02" onSave={onSave} onCancel={vi.fn()} />
    );
    fireEvent.change(screen.getByLabelText("Departure"), { target: { value: "08:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Add day" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      date: "2026-08-02",
      startTimeMin: 510,
      location: null,
    });
    expect(onSave.mock.calls[0][0].slots).toHaveLength(1); // >=1-slot invariant
  });

  it("renders the parent's strictly-increasing-dates rejection", () => {
    // Date ordering is validateTrip's rule — the form shows what onSave returns.
    const onSave = vi.fn<(d: Day) => string[]>(() => ["day dates must be strictly increasing"]);
    render(
      <DayForm trip={trip} initial={null} defaultDate="2026-08-01" onSave={onSave} onCancel={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add day" }));
    expect(screen.getByText(/strictly increasing/)).toBeInTheDocument();
  });

  it("pre-checks a partial location without calling onSave", () => {
    const onSave = vi.fn<(d: Day) => string[]>(() => []);
    render(
      <DayForm trip={trip} initial={null} defaultDate="2026-08-02" onSave={onSave} onCancel={vi.fn()} />
    );
    fireEvent.change(screen.getByLabelText(/Place/), { target: { value: "Rome" } });
    fireEvent.click(screen.getByRole("button", { name: "Add day" }));
    expect(screen.getByText(/location needs numeric lat and lon/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
