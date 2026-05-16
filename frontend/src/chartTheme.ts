import { isRecord, type PlotlyFigure } from "./types";

const transparentBackground = "rgba(0,0,0,0)";

const chartTheme = {
  axisLine: "rgba(69, 55, 40, 0.24)",
  font: "#26211c",
  grid: "rgba(69, 55, 40, 0.10)",
  hoverBackground: "rgba(255, 253, 248, 0.94)",
  hoverBorder: "rgba(69, 55, 40, 0.14)",
  tableCellBackground: "rgba(255, 253, 248, 0.34)",
  tableHeaderBackground: "rgba(47, 117, 106, 0.12)",
};

const mergeRecord = (
  base: Record<string, unknown>,
  override: unknown,
): Record<string, unknown> => ({
  ...base,
  ...(isRecord(override) ? override : {}),
});

const withThemedAxis = (axis: unknown) =>
  mergeRecord(
    {
      gridcolor: chartTheme.grid,
      linecolor: chartTheme.axisLine,
      tickcolor: chartTheme.axisLine,
      zerolinecolor: chartTheme.grid,
    },
    axis,
  );

const withThemedTableFill = (section: unknown, fallbackColor: string) => {
  const sectionRecord = isRecord(section) ? section : {};
  const sourceFill = isRecord(sectionRecord.fill) ? sectionRecord.fill : {};
  return {
    ...sectionRecord,
    fill: {
      ...sourceFill,
      color: fallbackColor,
    },
    font: mergeRecord({ color: chartTheme.font }, sectionRecord.font),
    line: mergeRecord({ color: chartTheme.grid }, sectionRecord.line),
  };
};

const withThemedTrace = (trace: unknown) => {
  if (!isRecord(trace) || trace.type !== "table") return trace;

  return {
    ...trace,
    cells: withThemedTableFill(trace.cells, chartTheme.tableCellBackground),
    header: withThemedTableFill(trace.header, chartTheme.tableHeaderBackground),
  };
};

export const createPlotlyThemePayload = (figure: PlotlyFigure) => {
  const payload = figure as {
    data?: unknown[];
    layout?: Record<string, unknown>;
    config?: Record<string, unknown>;
  };
  const sourceLayout = payload.layout ?? {};
  const data = (payload.data ?? []).map(withThemedTrace);
  const layout = {
    ...sourceLayout,
    paper_bgcolor: transparentBackground,
    plot_bgcolor: transparentBackground,
    font: mergeRecord({ color: chartTheme.font }, sourceLayout.font),
    hoverlabel: mergeRecord(
      {
        bgcolor: chartTheme.hoverBackground,
        bordercolor: chartTheme.hoverBorder,
        font: { color: chartTheme.font },
      },
      sourceLayout.hoverlabel,
    ),
    margin: mergeRecord({ l: 44, r: 20, t: 52, b: 42 }, sourceLayout.margin),
    xaxis: withThemedAxis(sourceLayout.xaxis),
    yaxis: withThemedAxis(sourceLayout.yaxis),
  };
  const config = {
    responsive: true,
    displayModeBar: false,
    ...(payload.config ?? {}),
  };

  return { config, data, layout };
};
