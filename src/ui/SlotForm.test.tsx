/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/setup-dom";
import { SlotForm } from "./SlotForm";
import { newTrip, starterSlot } from "../domain/mutate";
import type { ItinerarySlot } from "../domain/types";

const trip = newTrip("T", "2026-08-01", [{ id: "p1", name: "Ana" }], {
  home: "RON",
  local: "EUR",
  intl: "USD",
});

const spy = () => vi.fn<(slot: ItinerarySlot) => string[]>(() => []);

const renderForm = (initial: ItinerarySlot | null, onSave = spy()) => {
  render(<SlotForm trip={trip} initial={initial} onSave={onSave} onCancel={vi.fn()} />);
  return onSave;
};

describe("SlotForm", () => {
  it("requires a title before calling onSave", () => {
    const onSave = renderForm(null);
    fireEvent.click(screen.getByRole("button", { name: "Add slot" }));
    expect(screen.getByText(/title must not be empty/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("submits an opening-hours checkpoint as a [opensMin, timeMin] window", () => {
    const onSave = renderForm(null);
    fireEvent.change(screen.getByLabelText("Slot title"), { target: { value: "Museum" } });
    fireEvent.click(screen.getByLabelText(/Hard checkpoint/));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Timed entry" } });
    fireEvent.change(screen.getByLabelText(/Opens/), { target: { value: "10:00" } });
    // With an opening time set, the deadline field is labelled "Closes".
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "17:00" } });
    fireEvent.change(screen.getByLabelText(/Buffer/), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Add slot" }));

    expect(onSave.mock.calls[0][0]).toMatchObject({
      title: "Museum",
      checkpoint: { label: "Timed entry", opensMin: 600, timeMin: 1020, bufferMin: 20 },
    });
  });

  it("renders the parent's opensMin > timeMin rejection (rule lives in validateTrip)", () => {
    const onSave = vi.fn<(slot: ItinerarySlot) => string[]>(() => [
      "slot s1: checkpoint opensMin 1080 is after its closing timeMin 1020",
    ]);
    renderForm(null, onSave);
    fireEvent.change(screen.getByLabelText("Slot title"), { target: { value: "Museum" } });
    fireEvent.click(screen.getByLabelText(/Hard checkpoint/));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Timed entry" } });
    fireEvent.change(screen.getByLabelText(/Opens/), { target: { value: "18:00" } });
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "17:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Add slot" }));

    expect(onSave.mock.calls[0][0].checkpoint).toMatchObject({ opensMin: 1080, timeMin: 1020 });
    expect(screen.getByText(/opensMin 1080 is after its closing timeMin/)).toBeInTheDocument();
  });

  it("unchecking the checkpoint clears it to null on an existing slot", () => {
    const slot: ItinerarySlot = {
      ...starterSlot("EUR", "Flight"),
      checkpoint: { label: "Boarding", timeMin: 600, bufferMin: 15, opensMin: null },
    };
    const onSave = renderForm(slot);
    fireEvent.click(screen.getByLabelText(/Hard checkpoint/)); // uncheck
    fireEvent.click(screen.getByRole("button", { name: "Save slot" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].checkpoint).toBeNull();
    expect(onSave.mock.calls[0][0].title).toBe("Flight");
  });
});
