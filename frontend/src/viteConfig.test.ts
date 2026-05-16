import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const viteConfigSource = () =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../vite.config.ts"), "utf-8");

describe("Vite dev proxy", () => {
  it("forwards backend session APIs during local development", () => {
    expect(viteConfigSource()).toContain('"/sessions": "http://localhost:8000"');
  });
});
