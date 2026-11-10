// The trip map's picture, for the PDF export — without importing the
// (lazy-loaded) map code: TripMap registers a snapshot function while mounted.

type Snapshotter = () => Promise<string | null>;
let current: Snapshotter | null = null;

export function setSnapshotter(fn: Snapshotter | null): void {
  current = fn;
}

// A JPEG data URL of the map as it is shown, or null (no map / no WebGL).
export function snapshotMap(): Promise<string | null> {
  return current ? current().catch(() => null) : Promise.resolve(null);
}
