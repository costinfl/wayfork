// Shared setup for jsdom component tests. Imported by each *.test.tsx (which
// also declares `@vitest-environment jsdom` at its top) — deliberately NOT a
// global setupFile, so the framework-free domain/data tests keep running in the
// fast node environment untouched.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount rendered trees between tests so DOM/state never leaks across them.
afterEach(() => cleanup());
