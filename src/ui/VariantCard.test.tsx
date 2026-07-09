/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../test/setup-dom";
import { VariantCard } from "./VariantCard";
import { RATES_EUR } from "../domain/currency";
import type { VariantNode } from "../domain/types";

const variant: VariantNode = {
  id: "v1",
  name: "Public transit",
  cost: { amount: 12, currency: "EUR" },
  microSteps: [{ id: "m1", type: "metro", label: "Metro", durationMin: 20, distanceKm: null }],
};

const base = {
  variant,
  active: false,
  ccyView: "local" as const,
  tripCcy: { home: "RON", local: "EUR", intl: "USD" },
  rates: RATES_EUR,
};

describe("VariantCard focus button", () => {
  it("shows ⌖ only when onFocus is provided and fires it without selecting", async () => {
    const onSelect = vi.fn();
    const onFocus = vi.fn();
    const user = userEvent.setup();
    render(<VariantCard {...base} onSelect={onSelect} onFocus={onFocus} />);

    await user.click(screen.getByRole("button", { name: /Focus on map/ }));
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled(); // click did not bubble to the card
  });

  it("omits the focus button when the slot has no place", () => {
    render(<VariantCard {...base} onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Focus on map/ })).toBeNull();
  });

  it("selects the variant when the card body is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<VariantCard {...base} onSelect={onSelect} onFocus={vi.fn()} />);

    await user.click(screen.getByText("Public transit"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
