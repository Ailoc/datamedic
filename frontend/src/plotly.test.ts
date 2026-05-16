import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AVAILABLE_PLOTLY_MODULE_NAMES = [
  "bar",
  "box",
  "heatmap",
  "histogram",
  "histogram2d",
  "histogram2dcontour",
  "contour",
  "scatterternary",
  "violin",
  "funnel",
  "waterfall",
  "pie",
  "sunburst",
  "treemap",
  "icicle",
  "funnelarea",
  "scatter3d",
  "surface",
  "isosurface",
  "volume",
  "mesh3d",
  "cone",
  "streamtube",
  "scattergeo",
  "choropleth",
  "scattergl",
  "splom",
  "pointcloud",
  "heatmapgl",
  "parcoords",
  "parcats",
  "scattermapbox",
  "choroplethmapbox",
  "densitymapbox",
  "scattermap",
  "choroplethmap",
  "densitymap",
  "sankey",
  "indicator",
  "table",
  "carpet",
  "scattercarpet",
  "contourcarpet",
  "ohlc",
  "candlestick",
  "scatterpolar",
  "scatterpolargl",
  "barpolar",
  "scattersmith",
  "aggregate",
  "filter",
  "groupby",
  "sort",
  "calendars",
] as const;

const SUPPORTED_PLOTLY_MODULE_NAMES = [
  "bar",
  "box",
  "heatmap",
  "histogram",
  "indicator",
  "pie",
  "table",
  "waterfall",
] as const;

const createPlotlyMock = () => ({
  purge: vi.fn(),
  react: vi.fn(() => Promise.resolve()),
  register: vi.fn(),
});

describe("Plotly loader", () => {
  let originalGlobal: unknown;
  let hadGlobal: boolean;
  let plotlyMock: ReturnType<typeof createPlotlyMock>;
  let modules: Record<(typeof AVAILABLE_PLOTLY_MODULE_NAMES)[number], { name: string }>;

  beforeEach(() => {
    vi.resetModules();
    plotlyMock = createPlotlyMock();
    modules = Object.fromEntries(
      AVAILABLE_PLOTLY_MODULE_NAMES.map((name) => [name, { name }]),
    ) as typeof modules;

    vi.doMock("plotly.js/lib/core", () => ({
      default: plotlyMock,
    }));
    AVAILABLE_PLOTLY_MODULE_NAMES.forEach((name) => {
      vi.doMock(`plotly.js/lib/${name}`, () => ({
        default: modules[name],
      }));
    });

    hadGlobal = Object.prototype.hasOwnProperty.call(globalThis, "global");
    originalGlobal = (globalThis as { global?: unknown }).global;
    Reflect.deleteProperty(globalThis, "global");
  });

  afterEach(() => {
    if (hadGlobal) {
      Object.defineProperty(globalThis, "global", {
        configurable: true,
        value: originalGlobal,
        writable: true,
      });
    } else {
      Reflect.deleteProperty(globalThis, "global");
    }
    vi.doUnmock("plotly.js/lib/core");
    AVAILABLE_PLOTLY_MODULE_NAMES.forEach((name) => vi.doUnmock(`plotly.js/lib/${name}`));
  });

  it("defines browser globals and registers only backend-supported Plotly trace modules", async () => {
    const { loadPlotly } = await import("./plotly");

    const Plotly = await loadPlotly();

    expect((globalThis as { global?: unknown }).global).toBe(globalThis);
    expect(plotlyMock.register).toHaveBeenCalledWith(
      SUPPORTED_PLOTLY_MODULE_NAMES.map((name) => modules[name]),
    );
    expect(Plotly).toBe(plotlyMock);
  });
});
