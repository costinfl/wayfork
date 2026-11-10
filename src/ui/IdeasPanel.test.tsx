/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "../test/setup-dom";
import type { Day } from "../domain/types";

const { fetchIdeasMock, searchNearMock } = vi.hoisted(() => ({
  fetchIdeasMock: vi.fn(),
  searchNearMock: vi.fn(),
}));
vi.mock("../domain/wikivoyage", async (orig) => ({
  ...(await orig<typeof import("../domain/wikivoyage")>()),
  fetchIdeas: fetchIdeasMock,
}));
vi.mock("../domain/geocode", async (orig) => ({
  ...(await orig<typeof import("../domain/geocode")>()),
  searchNear: searchNearMock,
}));

import { IdeasPanel } from "./IdeasPanel";

const day: Day = {
  id: "d1",
  date: "2026-05-14",
  startTimeMin: 540,
  location: { name: "Rome, Lazio, Italy", lat: 41.9, lon: 12.5 },
  slots: [],
};
const idea = (kind: "see" | "do" | "eat", name: string, lat: number | null, page = "Rome") => ({
  kind, name, lat, lon: lat === null ? null : 12.49, description: `About ${name}`, page,
});

describe("IdeasPanel", () => {
  it("fetches the city's guide when opened, by tab, and adds listings to the day", async () => {
    fetchIdeasMock.mockResolvedValue({
      title: "Rome",
      ideas: [idea("see", "Colosseum", 41.89), idea("see", "Pantheon", null), idea("eat", "Da Enzo", 41.888, "Rome/Trastevere")],
    });
    searchNearMock.mockResolvedValue({ name: "Pantheon, Rome", lat: 41.8986, lon: 12.4769 });
    const onAdd = vi.fn(async () => [] as string[]);
    render(<IdeasPanel day={day} canEdit onAdd={onAdd} />);
    expect(fetchIdeasMock).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByText(/Ideas for Rome/)));
    expect(fetchIdeasMock).toHaveBeenCalledWith("Rome");
    expect(screen.getByRole("tab", { name: "👁 See · 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("About Colosseum")).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "+ Add to day" })[0]));
    expect(onAdd).toHaveBeenCalledWith({ name: "Colosseum, Rome", lat: 41.89, lon: 12.49, title: "Colosseum" });
    // No coordinates in the guide: placed by a search near the city.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "+ Add to day" })));
    expect(searchNearMock).toHaveBeenCalledWith("Pantheon", day.location);
    expect(onAdd).toHaveBeenLastCalledWith({ name: "Pantheon, Rome", lat: 41.8986, lon: 12.4769, title: "Pantheon" });
    expect(screen.getAllByText("Added ✓")).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: "🍽 Eat · 1" }));
    expect(screen.getByText("Trastevere")).toBeInTheDocument(); // the district page it came from
    expect(screen.getByRole("link", { name: /Rome guide on Wikivoyage/ })).toHaveAttribute("href", "https://en.wikivoyage.org/wiki/Rome");
  });

  it("finishes loading when the guide arrives after a re-render (slow network)", async () => {
    fetchIdeasMock.mockClear();
    let resolve!: (v: unknown) => void;
    fetchIdeasMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    render(<IdeasPanel day={day} canEdit onAdd={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByText(/Ideas for Rome/)));
    expect(screen.getByText(/Reading the Rome guide/)).toBeInTheDocument();
    await act(async () => resolve({ title: "Rome", ideas: [idea("do", "Appian Way", 41.85)] }));
    expect(screen.getByRole("tab", { name: "🎟 Do · 1" })).toBeInTheDocument();
    expect(fetchIdeasMock).toHaveBeenCalledTimes(1);
  });

  it("says when there is no guide, and viewers can't add", async () => {
    fetchIdeasMock.mockResolvedValueOnce(null);
    render(<IdeasPanel day={day} canEdit={false} onAdd={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByText(/Ideas for Rome/)));
    expect(screen.getByText(/No Wikivoyage guide with listings for Rome/)).toBeInTheDocument();
  });
});
