import { describe, expect, it } from "vitest";
import { TRIPS } from "../data";
import { parseTrip } from "./parse";

const roundTrip = (mutate?: (t: any) => void) => {
  const raw = JSON.parse(JSON.stringify(TRIPS[0]));
  mutate?.(raw);
  return parseTrip(raw);
};

describe("parseTrip — accepts", () => {
  for (const trip of TRIPS) {
    it(`round-trips "${trip.name}" through JSON`, () => {
      const { trip: parsed, errors } = parseTrip(JSON.parse(JSON.stringify(trip)));
      expect(errors).toEqual([]);
      expect(parsed).toEqual(trip);
    });
  }
});

describe("parseTrip — surrogate uid", () => {
  it("leaves uid absent when the document has none (no unstable mint on read)", () => {
    const { trip, errors } = roundTrip((t) => delete t.uid);
    expect(errors).toEqual([]);
    expect(trip?.uid).toBeUndefined();
  });

  it("preserves an existing uid", () => {
    const { trip } = roundTrip((t) => (t.uid = "keep-me-123"));
    expect(trip?.uid).toBe("keep-me-123");
  });

  it("rejects a present-but-empty uid", () => {
    const { trip, errors } = roundTrip((t) => (t.uid = ""));
    expect(trip).toBeNull();
    expect(errors.some((e) => e.includes("uid"))).toBe(true);
  });
});

describe("parseTrip — estimated provenance flag", () => {
  it("preserves an estimated flag on a variant and an expense", () => {
    const { trip, errors } = roundTrip((t) => {
      t.days[0].slots[0].variants[0].estimated = true;
      t.expenses[0].estimated = true;
    });
    expect(errors).toEqual([]);
    expect(trip?.days[0].slots[0].variants[0].estimated).toBe(true);
    expect(trip?.expenses[0].estimated).toBe(true);
  });

  it("leaves the flag absent when the document has none", () => {
    const { trip, errors } = roundTrip();
    expect(errors).toEqual([]);
    expect(trip?.days[0].slots[0].variants[0].estimated).toBeUndefined();
    expect(trip?.expenses[0].estimated).toBeUndefined();
  });

  it("rejects a non-boolean estimated flag", () => {
    expect(
      roundTrip((t) => (t.days[0].slots[0].variants[0].estimated = "yes")).errors.join("\n")
    ).toContain("estimated, when present, must be a boolean");
    expect(
      roundTrip((t) => (t.expenses[0].estimated = 1)).errors.join("\n")
    ).toContain("estimated, when present, must be a boolean");
  });
});

describe("parseTrip — slot place", () => {
  it("round-trips a slot place", () => {
    const { trip, errors } = roundTrip((t) => {
      t.days[0].slots[0].place = { name: "Rome FCO", lat: 41.8, lon: 12.24 };
    });
    expect(errors).toEqual([]);
    expect(trip?.days[0].slots[0].place).toEqual({ name: "Rome FCO", lat: 41.8, lon: 12.24 });
  });

  it("keeps an absent place absent", () => {
    const { trip, errors } = roundTrip((t) => delete t.days[0].slots[0].place);
    expect(errors).toEqual([]);
    expect(trip?.days[0].slots[0].place).toBeUndefined();
  });

  it("rejects a place with an out-of-range latitude (semantic)", () => {
    const { trip, errors } = roundTrip((t) => {
      t.days[0].slots[0].place = { name: "Nowhere", lat: 120, lon: 0 };
    });
    expect(trip).toBeNull();
    expect(errors.join("\n")).toContain("place lat 120 must be in [-90, 90]");
  });

  it("rejects a structurally malformed place", () => {
    const { errors } = roundTrip((t) => {
      t.days[0].slots[0].place = { name: "Bad", lat: "x", lon: 0 };
    });
    expect(errors.join("\n")).toContain("place.lat must be a number");
  });
});

describe("parseTrip — structural rejections", () => {
  it("rejects non-objects", () => {
    expect(parseTrip("hello").errors[0]).toContain("expected a JSON object");
    expect(parseTrip([1, 2]).errors[0]).toContain("expected a JSON object");
    expect(parseTrip(null).errors[0]).toContain("expected a JSON object");
  });

  it("rejects missing top-level fields", () => {
    const { trip, errors } = parseTrip({});
    expect(trip).toBeNull();
    const all = errors.join("\n");
    expect(all).toContain("trip.id must be a non-empty string");
    expect(all).toContain("trip.participants must be an array");
    expect(all).toContain("trip.days must be an array");
    expect(all).toContain("trip.currencies must be an object");
  });

  it("rejects an unknown micro-step type", () => {
    const { trip, errors } = roundTrip((t) => {
      t.days[0].slots[0].variants[0].microSteps[0].type = "teleport";
    });
    expect(trip).toBeNull();
    expect(errors.join("\n")).toContain('"teleport" must be one of');
  });

  it("rejects a stringly-typed duration", () => {
    const { errors } = roundTrip((t) => {
      t.days[0].slots[0].variants[0].microSteps[0].durationMin = "9";
    });
    expect(errors.join("\n")).toContain("durationMin must be a number");
  });

  it("rejects an unknown split type", () => {
    const { errors } = roundTrip((t) => {
      t.expenses[0].split = { type: "randomly" };
    });
    expect(errors.join("\n")).toContain('split.type must be "equal", "percent" or "fixed"');
  });

  it("rejects a missing payer", () => {
    const { errors } = roundTrip((t) => {
      delete t.expenses[0].payerId;
    });
    expect(errors.join("\n")).toContain("payerId must be a non-empty string");
  });

  it("rejects a missing checkpoint field", () => {
    const { errors } = roundTrip((t) => {
      t.days[0].slots[2].checkpoint = { label: "Boarding" }; // no timeMin/bufferMin
    });
    expect(errors.join("\n")).toContain("checkpoint.timeMin must be a number");
  });
});

describe("parseTrip — semantic rejections (via validateTrip)", () => {
  it("rejects a dangling defaultVariantId", () => {
    const { trip, errors } = roundTrip((t) => {
      t.days[0].slots[0].defaultVariantId = "ghost";
    });
    expect(trip).toBeNull();
    expect(errors.join("\n")).toContain('defaultVariantId "ghost"');
  });

  it("rejects percent splits that do not sum to 1", () => {
    const { errors } = roundTrip((t) => {
      t.expenses[0].split = { type: "percent", shares: { "p-andrei": 0.9 } };
    });
    expect(errors.join("\n")).toContain("percent shares sum to");
  });
});
