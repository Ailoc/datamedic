type PlotlyStatic = typeof import("plotly.js/lib/core").default;
type PlotlyModule = { default: unknown };
type PlotlyModuleLoader = () => Promise<PlotlyModule>;

let plotlyPromise: Promise<PlotlyStatic> | null = null;

const ensurePlotlyBrowserGlobals = () => {
  const scope = globalThis as typeof globalThis & { global?: typeof globalThis };
  if (typeof scope.global === "undefined") {
    Object.defineProperty(scope, "global", {
      configurable: true,
      value: scope,
      writable: true,
    });
  }
};

const supportedPlotlyModuleLoaders: PlotlyModuleLoader[] = [
  () => import("plotly.js/lib/bar"),
  () => import("plotly.js/lib/box"),
  () => import("plotly.js/lib/heatmap"),
  () => import("plotly.js/lib/histogram"),
  () => import("plotly.js/lib/indicator"),
  () => import("plotly.js/lib/pie"),
  () => import("plotly.js/lib/table"),
  () => import("plotly.js/lib/waterfall"),
];

export const loadPlotly = async (): Promise<PlotlyStatic> => {
  ensurePlotlyBrowserGlobals();
  plotlyPromise ??= Promise.all([
    import("plotly.js/lib/core"),
    ...supportedPlotlyModuleLoaders.map((loadModule) => loadModule()),
  ]).then(([coreModule, ...plotlyModules]) => {
    const Plotly = coreModule.default;
    Plotly.register(plotlyModules.map((module) => module.default));
    return Plotly;
  });
  return plotlyPromise;
};
