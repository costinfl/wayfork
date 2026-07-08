/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../test/setup-dom";
import { PlanTripForm } from "./PlanTripForm";
import type { Place } from "../domain/scaffold";

const PLACES: Record<string, Place> = {
  Bucharest: { name: "Bucharest, Romania", lat: 44.43, lon: 26.1, country: "Romania" },
  Rome: { name: "Rome, Lazio, Italy", lat: 41.9, lon: 12.5, country: "Italy" },
  Venice: { name: "Venice, Veneto, Italy", lat: 45.44, lon: 12.34, country: "Italy" },
};

const makeSearch = () =>
  vi.fn(async (q: string): Promise<Place[]> => {
    const term = q.trim().toLowerCase();
    const hit = Object.entries(PLACES).find(([k]) => k.toLowerCase().startsWith(term));
    return hit ? [hit[1]] : [];
  });

// Type into a combobox and click the single suggestion it produces.
async function pick(user: ReturnType<typeof userEvent.setup>, box: HTMLElement, term: string) {
  await user.clear(box);
  await user.type(box, term);
  const option = await screen.findByRole("option", { name: PLACES[term].name });
  await user.click(within(option).getByRole("button"));
}

describe("PlanTripForm", () => {
  it("fills a place's lat/lon when a suggestion is selected", async () => {
    const user = userEvent.setup();
    render(<PlanTripForm onCreate={vi.fn()} search={makeSearch()} />);

    const start = screen.getByRole("combobox", { name: /Starting point/ });
    await pick(user, start, "Bucharest");

    expect((start as HTMLInputElement).value).toBe("Bucharest, Romania");
    expect(screen.getByText(/44.43, 26.1/)).toBeInTheDocument();
  });

  it("reorders and removes destination rows", async () => {
    const user = userEvent.setup();
    render(<PlanTripForm onCreate={vi.fn()} search={makeSearch()} />);

    await user.click(screen.getByRole("button", { name: "+ destination" }));
    let boxes = screen.getAllByRole("combobox"); // [start, dest1, dest2]
    await pick(user, boxes[1], "Rome");
    await pick(user, boxes[2], "Venice");

    // Move the first destination (Rome) down — the rows swap.
    await user.click(screen.getAllByTitle("Move down")[0]);
    boxes = screen.getAllByRole("combobox");
    expect((boxes[1] as HTMLInputElement).value).toBe("Venice, Veneto, Italy");
    expect((boxes[2] as HTMLInputElement).value).toBe("Rome, Lazio, Italy");

    // Remove the first row (now Venice) — one destination left, Rome.
    await user.click(screen.getAllByTitle("Remove destination")[0]);
    boxes = screen.getAllByRole("combobox");
    expect(boxes).toHaveLength(2); // start + one destination
    expect((boxes[1] as HTMLInputElement).value).toBe("Rome, Lazio, Italy");
  });

  it("surfaces an error when there are fewer days than destinations", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<PlanTripForm onCreate={onCreate} search={makeSearch()} />);

    await pick(user, screen.getByRole("combobox", { name: /Starting point/ }), "Bucharest");
    await pick(user, screen.getByRole("combobox", { name: /Destination 1/ }), "Rome");

    // 1 destination + return day needs >= 2 days; ask for 1.
    const days = screen.getByRole("textbox", { name: /Number of days/ });
    await user.clear(days);
    await user.type(days, "1");
    await user.click(screen.getByRole("button", { name: /Create scaffold/ }));

    expect(await screen.findByText(/at least 2/i)).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("creates the scaffold trip and renders the prompt on submit", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<PlanTripForm onCreate={onCreate} search={makeSearch()} />);

    await pick(user, screen.getByRole("combobox", { name: /Starting point/ }), "Bucharest");
    await pick(user, screen.getByRole("combobox", { name: /Destination 1/ }), "Rome");
    await user.click(screen.getByRole("button", { name: /Create scaffold/ }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const trip = onCreate.mock.calls[0][0];
    expect(trip.name).toMatch(/Rome/);
    expect(trip.days.length).toBeGreaterThan(0);

    expect(await screen.findByText(/Your trip scaffold is ready/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy prompt/ })).toBeInTheDocument();
    // The generated prompt embeds the trip id.
    expect(screen.getByText(new RegExp(trip.id))).toBeInTheDocument();
  });
});
