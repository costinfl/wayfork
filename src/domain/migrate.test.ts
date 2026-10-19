import { describe, expect, it, vi } from "vitest";
import { TRIPS } from "../data";
import {
  GEOCODE_MAX_KM,
  geocodeQuery,
  migrateTrip,
  migrateTripWithGeocode,
  migrationReport,
  schemaVersionOf,
} from "./migrate";
import { parseTrip } from "./parse";
import type { Trip } from "./types";

const step = (id: string, type = "walk") => ({ id, type, label: id, durationMin: 10, distanceKm: null });
const variant = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  cost: { amount: 0, currency: "EUR" },
  microSteps: [step(`${id}-w`, "wait"), step(`${id}-m`, "metro")],
  ...extra,
});
const slot = (id: string, place?: { name: string; lat: number; lon: number }, extra = {}) => ({
  id,
  title: id,
  defaultVariantId: `${id}v`,
  checkpoint: null,
  variants: [variant(`${id}v`, extra)],
  ...(place ? { place } : {}),
});

// A v1 document: no schemaVersion, unplaced slots, a variant-level geometry.
const v1 = () => ({
  id: "t1",
  name: "Old trip",
  participants: [{ id: "p1", name: "Ana" }],
  currencies: { home: "RON", local: "EUR", intl: "USD" },
  days: [
    {
      id: "d1",
      date: "2026-05-01",
      startTimeMin: 540,
      location: { name: "Rome", lat: 41.9, lon: 12.5 },
      slots: [
        slot("s1"), // nothing earlier → next placed slot
        slot("s2", { name: "Colosseum", lat: 41.89, lon: 12.49 }, {
          geometry: [
            [41.9, 12.5],
            [41.89, 12.49],
          ],
        }),
        slot("s3"), // → previous slot (Colosseum)
      ],
    },
    {
      id: "d2",
      date: "2026-05-02",
      startTimeMin: 540,
      location: { name: "Florence", lat: 43.77, lon: 11.25 },
      slots: [slot("s4")], // nothing placed in the day → day location
    },
    { id: "d3", date: "2026-05-03", startTimeMin: 540, slots: [slot("s5")] }, // → previous day's last place
  ],
  expenses: [],
});

describe("migrateTrip (v1 → v2)", () => {
  it("backfills every missing place from the nearest anchor, flagged estimated", () => {
    const { trip, issues } = migrateTrip(v1());
    const t = trip as Trip;
    expect(t.schemaVersion).toBe(2);
    const places = t.days.flatMap((d) => d.slots.map((s) => [s.id, s.place.name, !!s.place.estimated]));
    expect(places).toEqual([
      ["s1", "Colosseum", true],
      ["s2", "Colosseum", false],
      ["s3", "Colosseum", true],
      ["s4", "Florence", true],
      ["s5", "Florence", true],
    ]);
    expect(issues.filter((i) => i.kind === "place-backfilled").map((i) => i.source)).toEqual([
      "next-slot",
      "prev-slot",
      "day-location",
      "trip",
    ]);
  });

  it("moves a variant-level geometry onto its first moving micro-step", () => {
    const t = migrateTrip(v1()).trip as Trip;
    const v = t.days[0].slots[1].variants[0];
    expect("geometry" in v).toBe(false);
    expect(v.microSteps[0].geometry).toBeUndefined(); // the wait step
    expect(v.microSteps[1].geometry).toEqual([
      [41.9, 12.5],
      [41.89, 12.49],
    ]);
  });

  it("never mutates its input and records a report holding the original JSON", () => {
    const raw = v1();
    const before = JSON.stringify(raw);
    const { trip } = migrateTrip(raw);
    expect(JSON.stringify(raw)).toBe(before);
    const report = migrationReport(trip as object);
    expect(report?.fromVersion).toBe(1);
    expect(report?.raw).toBe(before);
  });

  it("is idempotent: a v2 document passes through untouched", () => {
    const once = migrateTrip(v1()).trip;
    const twice = migrateTrip(once);
    expect(twice.trip).toBe(once);
    expect(twice.issues).toEqual([]);
  });

  it("leaves a place-less trip with no anchor unplaced, for validation to reject", () => {
    const raw = v1();
    raw.days = [{ id: "d1", date: "2026-05-01", startTimeMin: 540, slots: [slot("s1")] }];
    const { trip, errors } = parseTrip(raw);
    expect(trip).toBeNull();
    expect(errors.join("\n")).toMatch(/place must be an object/);
  });

  it("parses a migrated v1 trip as valid v2", () => {
    const { trip, errors } = parseTrip(v1());
    expect(errors).toEqual([]);
    expect(trip?.schemaVersion).toBe(2);
    expect(migrationReport(trip!)?.issues.length).toBeGreaterThan(0);
  });

  it("ships every built-in trip as v2 already (no migration report)", () => {
    for (const t of TRIPS) {
      expect(t.schemaVersion).toBe(2);
      expect(migrationReport(t)).toBeUndefined();
    }
  });

  it("repairs a v2 document that the v1 site edited (unplaced slot, variant geometry)", () => {
    const v2 = migrateTrip(v1()).trip as Trip;
    const edited = JSON.parse(JSON.stringify(v2));
    delete edited.days[0].slots[2].place;
    edited.days[0].slots[1].variants[0].geometry = [
      [1, 1],
      [2, 2],
    ];
    const { trip, issues } = migrateTrip(edited);
    expect(trip).not.toBe(edited);
    expect(issues.map((i) => i.kind).sort()).toEqual(["geometry-moved", "place-backfilled"]);
    expect(migrationReport(trip as object)?.fromVersion).toBe(2);
  });

  it("reads the schema version of raw documents", () => {
    expect(schemaVersionOf({})).toBe(1);
    expect(schemaVersionOf({ schemaVersion: 2 })).toBe(2);
    expect(schemaVersionOf(null)).toBe(1);
  });
});

describe("geocodeQuery", () => {
  it("uses the destination of an arrow title and drops parentheticals", () => {
    expect(geocodeQuery("IC 562: Taranto → Bari Centrale")).toBe("Bari Centrale");
    expect(geocodeQuery("Villa San Giovanni Layover (Missed Connection)")).toBe(
      "Villa San Giovanni Layover"
    );
    expect(geocodeQuery("Lunch: Trattoria da Enzo")).toBe("Trattoria da Enzo");
  });
});

describe("migrateTripWithGeocode", () => {
  const migrated = () => parseTrip(v1()).trip!;

  it("replaces backfilled guesses with nearby geocoder hits, still estimated", async () => {
    const geocode = vi.fn(async (q: string) => ({ name: `${q} (found)`, lat: 41.901, lon: 12.501 }));
    const out = await migrateTripWithGeocode(migrated(), geocode);
    // Only the 4 backfilled slots are looked up; the real place s2 is not.
    expect(geocode).toHaveBeenCalledTimes(4);
    expect(out.days[0].slots[0].place).toMatchObject({ name: "s1 (found)", estimated: true });
    expect(out.days[0].slots[1].place.name).toBe("Colosseum");
    expect(migrationReport(out)?.issues.find((i) => i.slotId === "s1")?.source).toBe("geocoded");
  });

  it(`rejects hits further than ${GEOCODE_MAX_KM} km from the guess, and survives geocoder failures`, async () => {
    const geocode = vi.fn(async (q: string) => {
      if (q === "s1") throw new Error("network");
      return { name: "Faraway", lat: 0, lon: 0 };
    });
    const out = await migrateTripWithGeocode(migrated(), geocode);
    expect(out.days[0].slots[0].place.name).toBe("Colosseum");
    expect(out.days[1].slots[0].place.name).toBe("Florence");
  });

  it("is a no-op for a trip that was not migrated", async () => {
    const geocode = vi.fn();
    const t = TRIPS[0];
    expect(await migrateTripWithGeocode(t, geocode)).toBe(t);
    expect(geocode).not.toHaveBeenCalled();
  });
});
