import type { Trip } from "../../domain/types";

const P = {
  andrei: "nep-p-andrei",
  bianca: "nep-p-bianca",
  ciprian: "nep-p-ciprian",
};

export const NEPTUN_TRIP: Trip = {
  id: "nep-trip-neptun-2026",
  name: "Neptun · Jul 2026",
  participants: [
    { id: P.andrei, name: "Andrei" },
    { id: P.bianca, name: "Bianca" },
    { id: P.ciprian, name: "Ciprian" },
  ],
  currencies: {
    home: "RON",
    local: "EUR",
    intl: "USD",
  },
  days: [
    {
      id: "nep-day-1",
      date: "2026-07-03",
      startTimeMin: 330, // 05:30 AM
      slots: [
        {
          id: "nep-d1-s1",
          title: "Home → Gara de Nord",
          defaultVariantId: "nep-d1-s1-v1",
          checkpoint: null,
          variants: [
            {
              id: "nep-d1-s1-v1",
              name: "Metro M1 & M2",
              microSteps: [
                { id: "nep-d1-s1-v1-m1", type: "walk", label: "Walk to Piața Romană Metro", durationMin: 8, distanceKm: 0.6 },
                { id: "nep-d1-s1-v1-m2", type: "metro", label: "Metro M2 to Victoriei, M1 to Gara de Nord", durationMin: 17, distanceKm: null },
                { id: "nep-d1-s1-v1-m3", type: "wait", label: "Buffer at platform", durationMin: 10, distanceKm: null },
              ],
              cost: { amount: 6, currency: "RON" },
            },
            {
              id: "nep-d1-s1-v2",
              name: "Rideshare (Bolt/Uber)",
              microSteps: [
                { id: "nep-d1-s1-v2-m1", type: "wait", label: "Wait for driver pick-up", durationMin: 10, distanceKm: null },
                { id: "nep-d1-s1-v2-m2", type: "car", label: "Drive to Gara de Nord terminal", durationMin: 35, distanceKm: 4.2 },
              ],
              cost: { amount: 28, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d1-s2",
          title: "Train București Nord → Neptun",
          defaultVariantId: "nep-d1-s2-v1",
          checkpoint: {
            label: "CFR Summer Train IR 1922 Departure",
            timeMin: 45, // Departure at 06:15 AM (exactly 45 minutes from Day Start at 05:30 AM)
            bufferMin: 15,
          },
          variants: [
            {
              id: "nep-d1-s2-v1",
              name: "Direct Summer Train (IR 1922)",
              microSteps: [
                { id: "nep-d1-s2-v1-m1", type: "train", label: "CFR IR 1922 to Neptun Halta", durationMin: 258, distanceKm: 265 },
              ],
              cost: { amount: 0, currency: "RON" }, // fare sits in pre-trip ledger
            },
            {
              id: "nep-d1-s2-v2",
              name: "Interregio + Local Bus (Sold-out backup)",
              microSteps: [
                { id: "nep-d1-s2-v2-m1", type: "train", label: "CFR IR 1581 to Constanța", durationMin: 120, distanceKm: 225 },
                { id: "nep-d1-s2-v2-m2", type: "transfer", label: "Walk to Southern Bus Station", durationMin: 20, distanceKm: null },
                { id: "nep-d1-s2-v2-m3", type: "bus", label: "Metropolitan Bus 301 to Neptun DN39", durationMin: 70, distanceKm: 40 },
              ],
              cost: { amount: 95, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d1-s3",
          title: "Neptun Halta → Hotel Cocor Spa",
          defaultVariantId: "nep-d1-s3-v1",
          checkpoint: null,
          variants: [
            {
              id: "nep-d1-s3-v1",
              name: "Walk via Resort Promenade",
              microSteps: [
                { id: "nep-d1-s3-v1-m1", type: "walk", label: "Walk via Strada Trandafirilor", durationMin: 20, distanceKm: 1.4 },
              ],
              cost: { amount: 0, currency: "RON" },
            },
            {
              id: "nep-d1-s3-v2",
              name: "Resort Shuttle",
              microSteps: [
                { id: "nep-d1-s3-v2-m1", type: "shuttle", label: "Hotel Cocor Private Shuttle Van", durationMin: 10, distanceKm: null },
              ],
              cost: { amount: 20, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d1-s4",
          title: "Dinner at Insula Neptun",
          defaultVariantId: "nep-d1-s4-v1",
          checkpoint: null,
          variants: [
            {
              id: "nep-d1-s4-v1",
              name: "Seafood Feast",
              microSteps: [
                { id: "nep-d1-s4-v1-m1", type: "walk", label: "Walk across the bridge to Lake Neptun Island", durationMin: 15, distanceKm: 1.0 },
                { id: "nep-d1-s4-v1-m2", type: "wait", label: "Dinner at Restaurant Insula", durationMin: 75, distanceKm: null },
              ],
              cost: { amount: 150, currency: "RON" },
            },
          ],
        },
      ],
    },
    {
      id: "nep-day-2",
      date: "2026-07-04",
      startTimeMin: 540, // 09:00 AM
      slots: [
        {
          id: "nep-d2-s1",
          title: "Hotel → Plaja La Steaguri",
          defaultVariantId: "nep-d2-s1-v1",
          checkpoint: null,
          variants: [
            {
              id: "nep-d2-s1-v1",
              name: "Walk via Pine Forest",
              microSteps: [
                { id: "nep-d2-s1-v1-m1", type: "walk", label: "Stroll down Aleea Steagurilor", durationMin: 15, distanceKm: 1.1 },
              ],
              cost: { amount: 0, currency: "RON" },
            },
            {
              id: "nep-d2-s1-v2",
              name: "Tourist Road Train (Treneț)",
              microSteps: [
                { id: "nep-d2-s1-v2-m1", type: "shuttle", label: "Ride the beach tractor tourist train", durationMin: 10, distanceKm: null },
              ],
              cost: { amount: 10, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d2-s2",
          title: "Beach Chill & Travel to Mangalia",
          defaultVariantId: "nep-d2-s2-v1",
          checkpoint: {
            label: "Esmahan Sultan Mosque Guided Tour",
            timeMin: 180, // Tour starts at 12:00 PM (180 mins from Day Start at 09:00 AM)
            bufferMin: 20,
          },
          variants: [
            {
              id: "nep-d2-s2-v1",
              name: "Beach Chill + Local Bus",
              microSteps: [
                { id: "nep-d2-s2-v1-m1", type: "wait", label: "Sunbathing on La Steaguri", durationMin: 120, distanceKm: null },
                { id: "nep-d2-s2-v1-m2", type: "walk", label: "Walk to Neptun main road bus stop", durationMin: 15, distanceKm: 1.0 },
                { id: "nep-d2-s2-v1-m3", type: "bus", label: "Local Minibus (Route 4) to Mangalia Center", durationMin: 20, distanceKm: 7.5 },
              ],
              cost: { amount: 155, currency: "RON" },
            },
            {
              id: "nep-d2-s2-v2",
              name: "Beach Chill + Beach Front Walk",
              microSteps: [
                { id: "nep-d2-s2-v2-m1", type: "wait", label: "Sunbathing on La Steaguri", durationMin: 120, distanceKm: null },
                { id: "nep-d2-s2-v2-m2", type: "walk", label: "Scenic hike along Saturn & Mangalia cliffs", durationMin: 75, distanceKm: 6.0 },
              ],
              cost: { amount: 195, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d2-s3",
          title: "Lunch at Restaurant Callatis",
          defaultVariantId: "nep-d2-s3-v1",
          checkpoint: null,
          variants: [
            {
              id: "nep-d2-s3-v1",
              name: "Marina Dockside Dining",
              microSteps: [
                { id: "nep-d2-s3-v1-m1", type: "walk", label: "Walk to Mangalia Yacht Marina", durationMin: 10, distanceKm: 0.7 },
                { id: "nep-d2-s3-v1-m2", type: "wait", label: "Traditional Romanian seafood lunch", durationMin: 60, distanceKm: null },
              ],
              cost: { amount: 120, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d2-s4",
          title: "Mangalia Marina → Hotel Cocor",
          defaultVariantId: "nep-d2-s4-v1",
          checkpoint: null,
          variants: [
            {
              id: "nep-d2-s4-v1",
              name: "Direct Ride (Bolt)",
              microSteps: [
                { id: "nep-d2-s4-v1-m1", type: "car", label: "Drive north along DN39 highway", durationMin: 15, distanceKm: 8.5 },
              ],
              cost: { amount: 40, currency: "RON" },
            },
            {
              id: "nep-d2-s4-v2",
              name: "Local Minibus",
              microSteps: [
                { id: "nep-d2-s4-v2-m1", type: "walk", label: "Walk to Mangalia Billa stop", durationMin: 10, distanceKm: 0.6 },
                { id: "nep-d2-s4-v2-m2", type: "bus", label: "Regional minibus to Neptun", durationMin: 15, distanceKm: 7.0 },
                { id: "nep-d2-s4-v2-m3", type: "walk", label: "Walk back to resort lobby", durationMin: 10, distanceKm: 0.8 },
              ],
              cost: { amount: 8, currency: "RON" },
            },
          ],
        },
      ],
    },
    {
      id: "nep-day-3",
      date: "2026-07-05",
      startTimeMin: 570, // 09:30 AM
      slots: [
        {
          id: "nep-d3-s1",
          title: "Hotel Cocor → Constanța Historic Center",
          defaultVariantId: "nep-d3-s1-v1",
          checkpoint: null,
          variants: [
            {
              id: "nep-d3-s1-v1",
              name: "Regio Train",
              microSteps: [
                { id: "nep-d3-s1-v1-m1", type: "walk", label: "Walk to Neptun Halta", durationMin: 15, distanceKm: 1.1 },
                { id: "nep-d3-s1-v1-m2", type: "train", label: "CFR Regio 8382 to Constanța", durationMin: 50, distanceKm: 38.0 },
              ],
              cost: { amount: 0, currency: "RON" }, // pre-trip tickets ledger
            },
            {
              id: "nep-d3-s1-v2",
              name: "Multi-Bus Route (Budget back-up)",
              microSteps: [
                { id: "nep-d3-s1-v2-m1", type: "walk", label: "Walk to DN39 main road", durationMin: 20, distanceKm: 1.5 },
                { id: "nep-d3-s1-v2-m2", type: "bus", label: "Minibus to Mangalia Autogară", durationMin: 15, distanceKm: 7.0 },
                { id: "nep-d3-s1-v2-m3", type: "wait", label: "Wait for inter-city coach", durationMin: 25, distanceKm: null },
                { id: "nep-d3-s1-v2-m4", type: "bus", label: "Regional Coach to Constanța Sud", durationMin: 55, distanceKm: 42.0 },
              ],
              cost: { amount: 18, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d3-s2",
          title: "Constanța Casino & Museum Visit",
          defaultVariantId: "nep-d3-s2-v1",
          checkpoint: {
            label: "National History & Archeology Museum Entry",
            timeMin: 120, // Entry scheduled at 11:30 AM (120 mins from Day Start at 09:30 AM)
            bufferMin: 15,
          },
          variants: [
            {
              id: "nep-d3-s2-v1",
              name: "Scenic Cliff Promenade Walk",
              microSteps: [
                { id: "nep-d3-s2-v1-m1", type: "walk", label: "Walk along Cazinoului Cliff", durationMin: 20, distanceKm: 1.4 },
                { id: "nep-d3-s2-v1-m2", type: "walk", label: "Walk up historical steps to Ovidiu Square", durationMin: 15, distanceKm: 0.9 },
              ],
              cost: { amount: 0, currency: "RON" },
            },
            {
              id: "nep-d3-s2-v2",
              name: "City Hop-On Hop-Off Bus",
              microSteps: [
                { id: "nep-d3-s2-v2-m1", type: "wait", label: "Wait for open-top tourist bus", durationMin: 15, distanceKm: null },
                { id: "nep-d3-s2-v2-m2", type: "bus", label: "City Sightseeing Bus to Historic Center", durationMin: 30, distanceKm: 5.5 },
              ],
              cost: { amount: 30, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d3-s3",
          title: "Lunch at Reyna Port Tomis",
          defaultVariantId: "nep-d3-s3-v1",
          checkpoint: null,
          variants: [
            {
              id: "nep-d3-s3-v1",
              name: "Marina Port Tomis Terrace",
              microSteps: [
                { id: "nep-d3-s3-v1-m1", type: "walk", label: "Walk down cliffs to Tomis Marina", durationMin: 10, distanceKm: 0.6 },
                { id: "nep-d3-s3-v1-m2", type: "wait", label: "Seafood & Mediterranean Dining", durationMin: 65, distanceKm: null },
              ],
              cost: { amount: 140, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d3-s4",
          title: "Constanța → Hotel Cocor",
          defaultVariantId: "nep-d3-s4-v1",
          checkpoint: null,
          variants: [
            {
              id: "nep-d3-s4-v1",
              name: "Regio Train Back",
              microSteps: [
                { id: "nep-d3-s4-v1-m1", type: "walk", label: "Walk to Constanța Gara", durationMin: 15, distanceKm: 1.2 },
                { id: "nep-d3-s4-v1-m2", type: "train", label: "CFR Regio 8389 to Neptun Halta", durationMin: 50, distanceKm: 38.0 },
              ],
              cost: { amount: 0, currency: "RON" }, // pre-trip ticket ledger
            },
            {
              id: "nep-d3-s4-v2",
              name: "Flat Rate Taxi",
              microSteps: [
                { id: "nep-d3-s4-v2-m1", type: "car", label: "Direct private cab along coast", durationMin: 40, distanceKm: 40.0 },
              ],
              cost: { amount: 140, currency: "RON" },
            },
          ],
        },
      ],
    },
    {
      id: "nep-day-4",
      date: "2026-07-06",
      startTimeMin: 600, // 10:00 AM
      slots: [
        {
          id: "nep-d4-s1",
          title: "Beach Swim & Hotel Checkout",
          defaultVariantId: "nep-d4-s1-v1",
          checkpoint: null,
          variants: [
            {
              id: "nep-d4-s1-v1",
              name: "Morning Check-out Routine",
              microSteps: [
                { id: "nep-d4-s1-v1-m1", type: "walk", label: "Quick final stroll along the shoreline", durationMin: 15, distanceKm: 1.1 },
                { id: "nep-d4-s1-v1-m2", type: "wait", label: "Settle room extras & packing", durationMin: 30, distanceKm: null },
              ],
              cost: { amount: 0, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d4-s2",
          title: "Hotel Cocor → Neptun Halta Station",
          defaultVariantId: "nep-d4-s2-v1",
          checkpoint: {
            label: "CFR Return Train IR 1921 Departure",
            timeMin: 145, // Departure at 12:25 PM (145 mins since Day Start at 10:00 AM)
            bufferMin: 15,
          },
          variants: [
            {
              id: "nep-d4-s2-v1",
              name: "Hotel Shuttle Service",
              microSteps: [
                { id: "nep-d4-s2-v1-m1", type: "shuttle", label: "Hotel Cocor courtesy van drop-off", durationMin: 15, distanceKm: null },
              ],
              cost: { amount: 0, currency: "RON" }, // complimentary for guests
            },
            {
              id: "nep-d4-s2-v2",
              name: "Lakeside Walk & Espresso Stop",
              microSteps: [
                { id: "nep-d4-s2-v2-m1", type: "walk", label: "Walk with luggage via Lake Neptun I", durationMin: 25, distanceKm: 1.5 },
                { id: "nep-d4-s2-v2-m2", type: "wait", label: "Quick espresso at Terasa Antik", durationMin: 40, distanceKm: null },
                { id: "nep-d4-s2-v2-m3", type: "walk", label: "Walk final stretch to train platform", durationMin: 25, distanceKm: 1.2 },
              ],
              cost: { amount: 30, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d4-s3",
          title: "Train Neptun → București Nord",
          defaultVariantId: "nep-d4-s3-v1",
          checkpoint: null,
          variants: [
            {
              id: "nep-d4-s3-v1",
              name: "Direct Summer Train (IR 1921)",
              microSteps: [
                { id: "nep-d4-s3-v1-m1", type: "train", label: "CFR IR 1921 express back to Bucharest", durationMin: 258, distanceKm: 265.0 },
              ],
              cost: { amount: 0, currency: "RON" }, // pre-trip ticket ledger
            },
          ],
        },
        {
          id: "nep-d4-s4",
          title: "Gara de Nord → Home",
          defaultVariantId: "nep-d4-s4-v1",
          checkpoint: null,
          variants: [
            {
              id: "nep-d4-s4-v1",
              name: "Metro M1/M2 Return",
              microSteps: [
                { id: "nep-d4-s4-v1-m1", type: "metro", label: "Metro M1 to Victoriei, M2 to Romană", durationMin: 15, distanceKm: null },
                { id: "nep-d4-s4-v1-m2", type: "walk", label: "Walk back to apartment", durationMin: 10, distanceKm: 0.7 },
              ],
              cost: { amount: 3, currency: "RON" },
            },
            {
              id: "nep-d4-s4-v2",
              name: "Rideshare",
              microSteps: [
                { id: "nep-d4-s4-v2-m1", type: "wait", label: "Order & wait at Gara de Nord terminal", durationMin: 10, distanceKm: null },
                { id: "nep-d4-s4-v2-m2", type: "car", label: "Drive home to apartment", durationMin: 25, distanceKm: 4.5 },
              ],
              cost: { amount: 35, currency: "RON" },
            },
          ],
        },
      ],
    },
  ],
  expenses: [
    {
      id: "nep-exp-hotel",
      phase: "pre-trip",
      label: "Hotel Cocor Spa - 3 Nights Accommodation",
      payerId: P.andrei,
      amount: 390,
      currency: "EUR",
      split: { type: "equal" },
    },
    {
      id: "nep-exp-train-tickets",
      phase: "pre-trip",
      label: "CFR Summer Train Roundtrip Tickets (București - Neptun)",
      payerId: P.bianca,
      amount: 276, // 92 RON per ticket x 3 passengers roundtrip
      currency: "RON",
      split: {
        type: "percent",
        shares: {
          [P.andrei]: 0.34,
          [P.bianca]: 0.33,
          [P.ciprian]: 0.33,
        },
      },
    },
    {
      id: "nep-exp-dinner1",
      phase: "mid-trip",
      label: "Dinner & Drinks at Restaurant Insula Neptun",
      payerId: P.ciprian,
      amount: 450,
      currency: "RON",
      split: { type: "equal" },
    },
    {
      id: "nep-exp-mosque-entry",
      phase: "mid-trip",
      label: "Esmahan Sultan Mosque & Mangalia Museum Entrance",
      payerId: P.andrei,
      amount: 60, // 20 RON per person
      currency: "RON",
      split: {
        type: "fixed",
        shares: {
          [P.andrei]: 20,
          [P.bianca]: 20,
          [P.ciprian]: 20,
        },
      },
    },
    {
      id: "nep-exp-reyna-lunch",
      phase: "mid-trip",
      label: "Lunch at Reyna Port Tomis Marina",
      payerId: P.bianca,
      amount: 120,
      currency: "EUR",
      split: { type: "equal" },
    },
    {
      id: "nep-exp-souvenirs",
      phase: "mid-trip",
      label: "Traditional Beach Souvenirs & Sunbed Rentals",
      payerId: P.ciprian,
      amount: 150,
      currency: "RON",
      split: {
        type: "fixed",
        shares: {
          [P.andrei]: 50,
          [P.bianca]: 50,
          [P.ciprian]: 50,
        },
      },
    },
  ],
};
