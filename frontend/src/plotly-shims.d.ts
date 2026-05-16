declare module "plotly.js/lib/core" {
  const Plotly: {
    register: (modules: unknown[]) => void;
    react: (
      element: HTMLElement,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ) => Promise<unknown>;
    purge: (element: HTMLElement) => void;
  };

  export default Plotly;
}

declare module "plotly.js/lib/*" {
  const plotlyModule: unknown;
  export default plotlyModule;
}
