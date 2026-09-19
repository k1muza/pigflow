import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, plannerSchema } from "./config";
import { buildInputsJson, inputsJsonFilename } from "./export-inputs";

describe("farm input JSON export", () => {
  it("round-trips every input and remains valid planner data", () => {
    const input = cloneDefaultConfig();
    input.project.name = "Green Valley Piggery";
    input.stock.sows = 37;
    input.service.useAi = true;

    const downloaded = JSON.parse(buildInputsJson(input));

    expect(downloaded).toEqual(input);
    expect(plannerSchema.parse(downloaded)).toEqual(input);
  });

  it("is formatted for inspection and ends with a newline", () => {
    const output = buildInputsJson(cloneDefaultConfig());

    expect(output).toContain("\n  \"project\": {");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("names the file after the plan and has a safe fallback", () => {
    const input = cloneDefaultConfig();
    input.project.name = "Green Valley Piggery (Phase 2)";
    expect(inputsJsonFilename(input)).toBe("green-valley-piggery-phase-2-farm-inputs.json");

    input.project.name = "🐷";
    expect(inputsJsonFilename(input)).toBe("plan-farm-inputs.json");
  });
});
