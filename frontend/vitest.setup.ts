import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

const _store = new Map<string, string>();

beforeEach(() => {
  _store.clear();
});

afterEach(() => {
  cleanup();
});

// Shim localStorage. jsdom 25 disables it for opaque origins even though
// vitest passes a default URL; the property may already be locked.
const _localStorage = {
  getItem: (key: string) => _store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    _store.set(key, value);
  },
  removeItem: (key: string) => {
    _store.delete(key);
  },
  clear: () => {
    _store.clear();
  },
  key: (index: number) => Array.from(_store.keys())[index] ?? null,
  get length() {
    return _store.size;
  },
};

try {
  // Attempt to override the global definition.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    enumerable: true,
    get: () => _localStorage,
  });
} catch {
  // Fallback: replace on the window-like global.
  (globalThis as Record<string, unknown>).localStorage = _localStorage;
}
