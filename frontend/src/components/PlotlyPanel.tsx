import { memo, useEffect, useRef } from "react";

import { createPlotlyThemePayload } from "../chartTheme";
import type { loadPlotly } from "../plotly";
import type { PlotlyFigure } from "../types";

type Plotly = Awaited<ReturnType<typeof loadPlotly>>;

export const PlotlyPanel = memo(function PlotlyPanel({ figure }: { figure: PlotlyFigure }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderedElement: HTMLDivElement | null = null;
    let plotlyLoader: Promise<Plotly> | null = null;
    const frame = window.requestAnimationFrame(() => {
      const element = ref.current;
      if (!element) return;
      const payload = createPlotlyThemePayload(figure);
      plotlyLoader = import("../plotly")
        .then(({ loadPlotly }) => loadPlotly());
      void plotlyLoader
        .then((Plotly) => {
          if (cancelled || !ref.current) return;
          renderedElement = ref.current;
          void Plotly.react(renderedElement, payload.data, payload.layout, payload.config);
        })
        .catch(() => undefined);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      const element = renderedElement ?? ref.current;
      if (!element || !plotlyLoader) return;
      void plotlyLoader
        .then((Plotly) => {
          Plotly.purge(element);
        })
        .catch(() => undefined);
    };
  }, [figure]);

  return <div className="plotly-panel" ref={ref} />;
});
