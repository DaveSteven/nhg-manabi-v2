import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";

// Register jest-dom matchers on THIS package's vitest `expect`. The package's
// "/vitest" entry imports whichever vitest it can resolve, which became the
// wrong major once apps/admin (vitest 4) joined the workspace.
expect.extend(jestDomMatchers);

// Node 26 exposes an incomplete experimental localStorage global unless
// --localstorage-file is provided. Pin tests to a deterministic in-memory
// implementation so happy-dom and application code see the same storage.
const storageValues = new Map<string, string>();
const memoryStorage: Storage = {
  get length() { return storageValues.size; },
  clear: () => storageValues.clear(),
  getItem: (key) => storageValues.get(key) ?? null,
  key: (index) => Array.from(storageValues.keys())[index] ?? null,
  removeItem: (key) => { storageValues.delete(key); },
  setItem: (key, value) => { storageValues.set(key, String(value)); },
};
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: memoryStorage,
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: memoryStorage,
});

afterEach(() => {
  cleanup();
  try {
    window.localStorage?.clear();
  } catch {
    // storage unavailable in some environments
  }
});
