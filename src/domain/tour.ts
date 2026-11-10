// The guided tour of the planner: each step points at an element marked
// `data-tour="<anchor>"`. Steps whose anchor is not on screen (e.g. a day
// with no alternatives) are skipped, so the tour fits whatever trip is open.

export interface TourStep {
  anchor: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    anchor: "stop",
    title: "A stop in your day",
    body: "Each row is a stop: where you'll be and when. Times are worked out for you from the day's start.",
  },
  {
    anchor: "options",
    title: "Options for getting there",
    body: "A stop can have several options — metro or taxi, museum or park. Click one to make it the plan.",
  },
  {
    anchor: "totals",
    title: "Everything follows",
    body: "Pick another option and every later time, the checkpoint buffers and the costs here recalculate.",
  },
  {
    anchor: "map",
    title: "Your route on the map",
    body: "The solid blue line is your plan; the faint ones are the other options. Hover one to compare, click it to switch.",
  },
  {
    anchor: "edit",
    title: "Make it yours",
    body: "Edit adds stops and options. In edit mode you can also drag a pin on the map to move a place.",
  },
];

// The index of the next step (from `from`, moving by `dir`) whose anchor is
// present; null when there is none left in that direction.
export function nextStep(
  steps: readonly TourStep[],
  from: number,
  dir: 1 | -1,
  present: (anchor: string) => boolean
): number | null {
  for (let i = from + dir; i >= 0 && i < steps.length; i += dir) {
    if (present(steps[i].anchor)) return i;
  }
  return null;
}
