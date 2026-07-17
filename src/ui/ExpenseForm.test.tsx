/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/setup-dom";
import { ExpenseForm } from "./ExpenseForm";
import { newTrip } from "../domain/mutate";
import type { ExpenseItem } from "../domain/types";

const trip = newTrip(
  "T",
  "2026-08-01",
  [
    { id: "p1", name: "Ana" },
    { id: "p2", name: "Bogdan" },
  ],
  { home: "RON", local: "EUR", intl: "USD" }
);

const spy = () => vi.fn<(exp: ExpenseItem) => string[]>(() => []);

const renderForm = (onSave = spy()) => {
  render(<ExpenseForm trip={trip} initial={null} onSave={onSave} onCancel={vi.fn()} />);
  return onSave;
};

describe("ExpenseForm", () => {
  it("submits an equal split with the chosen payer and the trip's local currency", () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Dinner" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "42" } });
    fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "p2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      label: "Dinner",
      amount: 42,
      currency: "EUR",
      payerId: "p2",
      phase: "mid-trip",
      split: { type: "equal" },
    });
  });

  it("percent split: converts % inputs to fractions and renders the parent's sum error", () => {
    // The shares-sum rule lives in validateTrip — the form surfaces whatever
    // onSave returns.
    const onSave = vi
      .fn<(exp: ExpenseItem) => string[]>()
      .mockReturnValueOnce(["expense: percent shares must sum to 1"])
      .mockReturnValue([]);
    renderForm(onSave);
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Taxi" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Split"), { target: { value: "percent" } });
    fireEvent.change(screen.getByLabelText(/Ana \(%\)/), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText(/Bogdan \(%\)/), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));

    expect(onSave.mock.calls[0][0]).toMatchObject({
      split: { type: "percent", shares: { p1: 0.6, p2: 0.3 } },
    });
    expect(screen.getByText(/percent shares must sum to 1/)).toBeInTheDocument();

    // Fixing the shares clears the error on the next accepted submit.
    fireEvent.change(screen.getByLabelText(/Bogdan \(%\)/), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(onSave.mock.calls[1][0]).toMatchObject({
      split: { type: "percent", shares: { p1: 0.6, p2: 0.4 } },
    });
    expect(screen.queryByText(/percent shares must sum to 1/)).toBeNull();
  });

  it("fixed split: submits absolute amounts per participant", () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Apartment" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "42" } });
    fireEvent.change(screen.getByLabelText("Split"), { target: { value: "fixed" } });
    fireEvent.change(screen.getByLabelText(/Ana \(EUR\)/), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/Bogdan \(EUR\)/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));

    expect(onSave.mock.calls[0][0]).toMatchObject({
      split: { type: "fixed", shares: { p1: 30, p2: 12 } },
    });
  });

  it("pre-checks label and amount without calling onSave", () => {
    const onSave = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(screen.getByText(/label must not be empty/)).toBeInTheDocument();
    expect(screen.getByText(/amount must be a positive number/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
