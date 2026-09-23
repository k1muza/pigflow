import { describe, expect, it } from "vitest";

import { cloneDefaultConfig } from "./config";
import { simulatePlan } from "./simulation";

describe("whole-run pedigree", () => {
  it("keeps parentage for animals after they have left the live herd", () => {
    const config = cloneDefaultConfig();
    config.project.months = 24;
    config.project.variation = "settled";
    config.project.engine = "1.x";
    config.herd.startMode = "synchronised";
    config.stock.sows = 2;
    config.stock.boars = 1;

    const simulation = simulatePlan(config, {
      snapshots: false,
      housing: false,
      physicalHousing: false,
    });
    const rows = simulation.pedigree;
    const byTag = new Map(rows.map((row) => [row.tag, row]));

    const born = rows.filter((row) => row.origin === "born");
    expect(born.length).toBeGreaterThan(0);
    expect(born.some((row) => row.generation === 1)).toBe(true);

    for (const child of born) {
      if (child.damTag) expect(byTag.has(child.damTag)).toBe(true);
      if (child.sireTag) expect(byTag.has(child.sireTag)).toBe(true);
    }

    const terminal = simulation.stateAt("2099-12-31T23:00");
    const live = new Set([
      ...terminal.stock.map((row) => row.tag),
      ...terminal.sows.map((row) => row.tag),
    ]);
    expect(born.some((row) => !live.has(row.tag))).toBe(true);
  });

  it("materialises AI studs as parents even though no boar object exists for them", () => {
    const config = cloneDefaultConfig();
    config.project.months = 12;
    config.project.variation = "settled";
    config.project.engine = "2.0";
    config.service.useAi = true;
    config.service.aiSharePct = 100;

    const simulation = simulatePlan(config, {
      snapshots: false,
      housing: false,
      physicalHousing: false,
    });
    const rows = simulation.pedigree;
    const stud = rows.find((row) => row.kind === "stud");

    expect(stud).toBeDefined();
    expect(rows.some((row) => row.sireTag === stud?.tag)).toBe(true);
  });
});
