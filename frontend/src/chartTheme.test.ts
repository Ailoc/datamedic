import { describe, expect, it } from "vitest";
import { createPlotlyThemePayload } from "./chartTheme";

describe("createPlotlyThemePayload", () => {
  it("applies transparent backgrounds and table colors", () => {
    const payload = createPlotlyThemePayload({
      data: [
        { type: "scatter", name: "趋势" },
        { type: "table", header: { fill: { color: "#fff" } }, cells: { fill: { color: "#fff" } } },
      ],
      layout: { title: "运营指标" },
    });

    expect(payload.layout).toMatchObject({
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      title: "运营指标",
    });
    expect(payload.data[1]).toMatchObject({
      cells: { fill: { color: "rgba(255, 253, 248, 0.34)" } },
      header: { fill: { color: "rgba(47, 117, 106, 0.12)" } },
    });
    expect(payload.config).toMatchObject({
      displayModeBar: false,
      responsive: true,
    });
  });
});
