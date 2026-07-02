import type { Trip } from "../../domain/types";

const P = {
  andrei: "nep-p-andrei",
  bianca: "nep-p-bianca",
  elena: "nep-p-elena", // Grandma Elena, helping with baby Vlad
};

export const NEPTUN_TRIP: Trip = {
  id: "nep-trip-neptun-2026",
  name: "Neptun Family Trip · Jul 2026",
  participants: [
    { id: P.andrei, name: "Andrei" },
    { id: P.bianca, name: "Bianca" },
    { id: P.elena, name: "Elena" },
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
      startTimeMin: 480, // 08:00 AM
      slots: [
        {
          id: "nep-d1-s1",
          title: "Bucharest → Neptun Journey",
          defaultVariantId: "nep-v-d1-s1-car",
          checkpoint: null,
          variants: [
            {
              id: "nep-v-d1-s1-car",
              name: "Personal Car (A2 Highway)",
              microSteps: [
                { id: "nep-ms-d1-s1-c1", type: "car", label: "Drive to Fetești Plaza", durationMin: 100, distanceKm: 145 },
                { id: "nep-ms-d1-s1-w1", type: "wait", label: "Fetești Bridge toll & baby stretch break", durationMin: 15, distanceKm: null },
                { id: "nep-ms-d1-s1-c2", type: "car", label: "Drive to Hotel Cocor Neptun", durationMin: 65, distanceKm: 120 },
              ],
              cost: { amount: 0, currency: "RON" }, // pre-trip fuel ledger
            },
            {
              id: "nep-v-d1-s1-train",
              name: "CFR Train (Backup option)",
              microSteps: [
                { id: "nep-ms-d1-s1-t1", type: "metro", label: "Metro to Gara de Nord", durationMin: 20, distanceKm: null },
                { id: "nep-ms-d1-s1-t2", type: "train", label: "IR 1922 Summer Train", durationMin: 230, distanceKm: 265 },
                { id: "nep-ms-d1-s1-t3", type: "walk", label: "Walk with stroller to hotel", durationMin: 20, distanceKm: 1.4 },
              ],
              cost: { amount: 168, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d1-s2",
          title: "Check-in & Lakeside Lunch",
          defaultVariantId: "nep-v-d1-s2-early",
          checkpoint: {
            label: "Cocor Restaurant Baby Lunch Window",
            timeMin: 240, // 12:00 PM (240 mins from 08:00 AM start)
            bufferMin: 15,
          },
          variants: [
            {
              id: "nep-v-d1-s2-early",
              name: "Smooth check-in & unpack",
              microSteps: [
                { id: "nep-ms-d1-s2-e1", type: "wait", label: "Front desk registration", durationMin: 15, distanceKm: null },
                { id: "nep-ms-d1-s2-e2", type: "walk", label: "Unpack baby gear in family suite", durationMin: 30, distanceKm: null },
              ],
              cost: { amount: 0, currency: "RON" },
            },
            {
              id: "nep-v-d1-s2-delayed",
              name: "Heavy traffic check-in rush",
              microSteps: [
                { id: "nep-ms-d1-s2-d1", type: "wait", label: "Queue at front desk", durationMin: 45, distanceKm: null },
                { id: "nep-ms-d1-s2-d2", type: "walk", label: "Express bag drop in room", durationMin: 15, distanceKm: null },
              ],
              cost: { amount: 0, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d1-s3",
          title: "Sunset Stroller Walk",
          defaultVariantId: "nep-v-d1-s3-walk",
          checkpoint: null,
          variants: [
            {
              id: "nep-v-d1-s3-walk",
              name: "Walk via Lake Neptun Park",
              microSteps: [
                { id: "nep-ms-d1-s3-w1", type: "walk", label: "Stroller stroll around Lake Neptun II", durationMin: 45, distanceKm: 2.2 },
              ],
              cost: { amount: 0, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d1-s4",
          title: "Family Dinner",
          defaultVariantId: "nep-v-d1-s4-insula",
          checkpoint: null,
          variants: [
            {
              id: "nep-v-d1-s4-insula",
              name: "Dinner at Insula Neptun",
              microSteps: [
                { id: "nep-ms-d1-s4-i1", type: "walk", label: "Walk across bridge to Island Restaurant", durationMin: 10, distanceKm: 0.6 },
                { id: "nep-ms-d1-s4-i2", type: "wait", label: "Traditional fish dinner", durationMin: 80, distanceKm: null },
              ],
              cost: { amount: 280, currency: "RON" },
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
          title: "Morning Activity (Weather Check)",
          defaultVariantId: "nep-v-d2-s1-sunny",
          checkpoint: {
            label: "Lunch Reservation at Terasa Antik",
            timeMin: 210, // 12:30 PM (210 mins from 09:00 AM start)
            bufferMin: 20,
          },
          variants: [
            {
              id: "nep-v-d2-s1-sunny",
              name: "Sunny Day: Plaja La Steaguri",
              microSteps: [
                { id: "nep-ms-d2-s1-s1", type: "walk", label: "Walk with stroller to beach front", durationMin: 15, distanceKm: 1.1 },
                { id: "nep-ms-d2-s1-s2", type: "wait", label: "Baby shade-tent play & swim session", durationMin: 120, distanceKm: null },
              ],
              cost: { amount: 0, currency: "RON" },
            },
            {
              id: "nep-v-d2-s1-cloudy",
              name: "Rainy/Cloudy Day: Indoor Spa & Playroom",
              microSteps: [
                { id: "nep-ms-d2-s1-c1", type: "walk", label: "Walk to Hotel Cocor Spa wing", durationMin: 5, distanceKm: null },
                { id: "nep-ms-d2-s1-c2", type: "wait", label: "Heated baby pool session & playroom", durationMin: 160, distanceKm: null },
              ],
              cost: { amount: 120, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d2-s2",
          title: "Lunch & Baby Nap",
          defaultVariantId: "nep-v-d2-s2-bistro",
          checkpoint: null,
          variants: [
            {
              id: "nep-v-d2-s2-bistro",
              name: "Terasa Antik Garden",
              microSteps: [
                { id: "nep-ms-d2-s2-b1", type: "walk", label: "Walk to quiet garden terrace", durationMin: 10, distanceKm: 0.5 },
                { id: "nep-ms-d2-s2-b2", type: "wait", label: "Lunch while baby naps in stroller", durationMin: 70, distanceKm: null },
              ],
              cost: { amount: 210, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d2-s3",
          title: "Afternoon Comorova Forest Walk",
          defaultVariantId: "nep-v-d2-s3-forest",
          checkpoint: null,
          variants: [
            {
              id: "nep-v-d2-s3-forest",
              name: "Stroller Woodland Loop",
              microSteps: [
                { id: "nep-ms-d2-s3-f1", type: "walk", label: "Shaded walk under Comorova oaks", durationMin: 60, distanceKm: 3.0 },
              ],
              cost: { amount: 0, currency: "RON" },
            },
            {
              id: "nep-v-d2-s3-drive",
              name: "Scenic Drive to Mangalia",
              microSteps: [
                { id: "nep-ms-d2-s3-d1", type: "car", label: "Drive scenic coast road to Mangalia Marina", durationMin: 20, distanceKm: 8.5 },
                { id: "nep-ms-d2-s3-d2", type: "walk", label: "Stroll dockside with baby", durationMin: 40, distanceKm: 1.5 },
              ],
              cost: { amount: 25, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d2-s4",
          title: "Easy Hotel Dinner",
          defaultVariantId: "nep-v-d2-s4-room",
          checkpoint: null,
          variants: [
            {
              id: "nep-v-d2-s4-room",
              name: "Room Service (Baby friendly setup)",
              microSteps: [
                { id: "nep-ms-d2-s4-r1", type: "wait", label: "Dine on hotel terrace suite", durationMin: 60, distanceKm: null },
              ],
              cost: { amount: 150, currency: "RON" },
            },
          ],
        },
      ],
    },
    {
      id: "nep-day-3",
      date: "2026-07-05",
      startTimeMin: 540, // 09:00 AM
      slots: [
        {
          id: "nep-d3-s1",
          title: "Morning Walk & Exploration",
          defaultVariantId: "nep-v-d3-s1-beach",
          checkpoint: {
            label: "Mangalia Marina Boat Tour Check-in",
            timeMin: 180, // 12:00 PM (180 mins from 09:00 AM start)
            bufferMin: 15,
          },
          variants: [
            {
              id: "nep-v-d3-s1-beach",
              name: "Sunny Day: Plaja Venus Walk",
              microSteps: [
                { id: "nep-ms-d3-s1-b1", type: "walk", label: "Beach walk to Venus resort", durationMin: 50, distanceKm: 2.8 },
                { id: "nep-ms-d3-s1-b2", type: "shuttle", label: "Tourist road train back", durationMin: 15, distanceKm: null },
                { id: "nep-ms-d3-s1-b3", type: "car", label: "Drive to Mangalia Marina parking", durationMin: 15, distanceKm: 8.5 },
              ],
              cost: { amount: 40, currency: "RON" },
            },
            {
              id: "nep-v-d3-s1-museum",
              name: "Overcast Day: Esmahan Sultan Mosque",
              microSteps: [
                { id: "nep-ms-d3-s1-m1", type: "car", label: "Drive to Mangalia Town Center", durationMin: 20, distanceKm: 9.0 },
                { id: "nep-ms-d3-s1-m2", type: "walk", label: "Guided historic mosque & garden tour", durationMin: 60, distanceKm: null },
                { id: "nep-ms-d3-s1-m3", type: "wait", label: "Stroller transit to Marina dock", durationMin: 40, distanceKm: null },
              ],
              cost: { amount: 30, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d3-s2",
          title: "Mangalia Marina Boat Ride",
          defaultVariantId: "nep-v-d3-s2-boat",
          checkpoint: null,
          variants: [
            {
              id: "nep-v-d3-s2-boat",
              name: "Private Pontoon Cruise (Stroller-safe)",
              microSteps: [
                { id: "nep-ms-d3-s2-b1", type: "shuttle", label: "Smooth sea cruise along Saturn shore", durationMin: 45, distanceKm: null },
              ],
              cost: { amount: 0, currency: "RON" }, // pre-paid excursion
            },
            {
              id: "nep-v-d3-s2-walk",
              name: "Walk around Harbor Cliffs",
              microSteps: [
                { id: "nep-ms-d3-s2-w1", type: "walk", label: "Walk along protective sea wall", durationMin: 40, distanceKm: 2.0 },
              ],
              cost: { amount: 0, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d3-s3",
          title: "Late Lunch at Restaurant Callatis",
          defaultVariantId: "nep-v-d3-s3-callatis",
          checkpoint: null,
          variants: [
            {
              id: "nep-v-d3-s3-callatis",
              name: "Dockside Fish Tavern",
              microSteps: [
                { id: "nep-ms-d3-s3-c1", type: "walk", label: "Walk from boat dock to terrace", durationMin: 5, distanceKm: 0.2 },
                { id: "nep-ms-d3-s3-c2", type: "wait", label: "Traditional Dobrogea seafood platter", durationMin: 70, distanceKm: null },
              ],
              cost: { amount: 260, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d3-s4",
          title: "Return Drive & Family Wind-down",
          defaultVariantId: "nep-v-d3-s4-car",
          checkpoint: null,
          variants: [
            {
              id: "nep-v-d3-s4-car",
              name: "Direct highway drive back",
              microSteps: [
                { id: "nep-ms-d3-s4-c1", type: "car", label: "Drive DN39 back to resort suite", durationMin: 15, distanceKm: 8.5 },
              ],
              cost: { amount: 0, currency: "RON" },
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
          title: "Last Beach Dip & Pack Up",
          defaultVariantId: "nep-v-d4-s1-checkout",
          checkpoint: null,
          variants: [
            {
              id: "nep-v-d4-s1-checkout",
              name: "Morning Checkout Routine",
              microSteps: [
                { id: "nep-ms-d4-s1-c1", type: "walk", label: "Final collection of sea shells", durationMin: 30, distanceKm: 0.8 },
                { id: "nep-ms-d4-s1-c2", type: "wait", label: "Pack family car & room keys drop-off", durationMin: 45, distanceKm: null },
              ],
              cost: { amount: 0, currency: "RON" },
            },
          ],
        },
        {
          id: "nep-d4-s2",
          title: "Neptun → Bucharest Drive Home",
          defaultVariantId: "nep-v-d4-s2-car",
          checkpoint: {
            label: "Beat Bucharest Rush Hour Traffic",
            timeMin: 220, // 01:40 PM (220 mins from 10:00 AM start)
            bufferMin: 20,
          },
          variants: [
            {
              id: "nep-v-d4-s2-car",
              name: "Direct Drive (A2 Highway)",
              microSteps: [
                { id: "nep-ms-d4-s2-c1", type: "car", label: "Drive to Bucharest home entry", durationMin: 175, distanceKm: 265.0 },
              ],
              cost: { amount: 0, currency: "RON" },
            },
            {
              id: "nep-v-d4-s2-stopped",
              name: "Frequent Baby Break Route",
              microSteps: [
                { id: "nep-ms-d4-s2-s1", type: "car", label: "Drive to Cernavodă exit", durationMin: 90, distanceKm: 110.0 },
                { id: "nep-ms-d4-s2-s2", type: "wait", label: "Feeding & walk stop in Cernavodă park", durationMin: 45, distanceKm: null },
                { id: "nep-ms-d4-s2-s3", type: "car", label: "Drive final stretch to Bucharest", durationMin: 100, distanceKm: 155.0 },
              ],
              cost: { amount: 0, currency: "RON" },
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
      label: "Hotel Cocor Resort 3-Night Family Suite",
      payerId: P.andrei,
      amount: 450,
      currency: "EUR",
      split: { type: "equal" },
    },
    {
      id: "nep-exp-gasoline-toll",
      phase: "pre-trip",
      label: "Fuel & Fetești Bridge Toll (Pre-purchase)",
      payerId: P.andrei,
      amount: 240,
      currency: "RON",
      split: {
        type: "percent",
        shares: {
          [P.andrei]: 0.5,
          [P.bianca]: 0.5,
          [P.elena]: 0.0, // Grandma is supported by parents
        },
      },
    },
    {
      id: "nep-exp-boat-prepay",
      phase: "pre-trip",
      label: "Private Family Yacht Pontoon Excursion",
      payerId: P.bianca,
      amount: 80,
      currency: "EUR",
      split: { type: "equal" },
    },
    {
      id: "nep-exp-dinner-insula",
      phase: "mid-trip",
      label: "Lakeside Fish Dinner at Insula Neptun",
      payerId: P.elena,
      amount: 360,
      currency: "RON",
      split: {
        type: "fixed",
        shares: {
          [P.andrei]: 120,
          [P.bianca]: 120,
          [P.elena]: 120,
        },
      },
    },
    {
      id: "nep-exp-groceries-baby",
      phase: "mid-trip",
      label: "Mega Image Baby Formulas, Water & Snacks",
      payerId: P.bianca,
      amount: 150,
      currency: "RON",
      split: { type: "equal" },
    },
    {
      id: "nep-exp-mosque-entry",
      phase: "mid-trip",
      label: "Esmahan Sultan Mosque Entrance Tickets",
      payerId: P.elena,
      amount: 60,
      currency: "RON",
      split: {
        type: "fixed",
        shares: {
          [P.andrei]: 30,
          [P.bianca]: 30,
          [P.elena]: 0, // Elena treats the parents
        },
      },
    },
  ],
};
