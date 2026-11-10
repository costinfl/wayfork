import { describe, expect, it, vi } from "vitest";
import { fetchDirections, fmtDistance, mapsLink, parseOsrmSteps } from "./directions";
import osrm from "./__fixtures__/osrm-foot-steps-colosseo.json";

// Recorded from routing.openstreetmap.de (foot, Colosseum → Piazza Venezia), 2026-11-10.
describe("directions", () => {
  it("turns OSRM maneuvers into instructions", () => {
    const steps = parseOsrmSteps(osrm);
    expect(steps[0]).toEqual({ text: "Head off", distanceM: 56 });
    expect(steps[1]).toEqual({ text: "Turn right onto Colosseo", distanceM: 168 });
    expect(steps.map((s) => s.text)).toContain("Turn right onto Piazza del Colosseo"); // end of road
    expect(steps.map((s) => s.text)).toContain("Keep left onto Piazza Venezia"); // fork slight left
    expect(steps[steps.length - 1].text).toBe("Arrive at Piazza Venezia");
  });

  it("fetches the right profile and is null on failure", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(osrm)));
    const a = { name: "A", lat: 41.8902, lon: 12.4922 };
    const b = { name: "B", lat: 41.8955, lon: 12.4823 };
    expect((await fetchDirections(a, b, "foot", f))!.length).toBeGreaterThan(5);
    expect(String((f.mock.calls[0] as unknown[])[0])).toMatch(/routed-foot\/route\/v1\/driving\/12\.4922,41\.8902;12\.4823,41\.8955\?overview=false&steps=true$/);
    expect(await fetchDirections(a, b, "driving", vi.fn(async () => new Response("", { status: 500 })))).toBeNull();
    expect(await fetchDirections(a, b, "driving", vi.fn(async () => new Response(JSON.stringify({ routes: [] }))))).toBeNull();
  });

  it("formats distances and builds a hand-off link", () => {
    expect(fmtDistance(56)).toBe("60 m");
    expect(fmtDistance(1530)).toBe("1.5 km");
    expect(fmtDistance(1_161_034)).toBe("1161 km");
    expect(mapsLink({ name: "A", lat: 1, lon: 2 }, { name: "B", lat: 3, lon: 4 }, "transit")).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=1.000000,2.000000&destination=3.000000,4.000000&travelmode=transit"
    );
  });
});
