import type { PigStage } from "../../sim/animals";
import type { World } from "../world";

/**
 * Non-fatal health episodes. Fatal disease remains in mortality; this system
 * represents the much more common cases that cost money and slow a batch down.
 */
export function runHealth(world: World): void {
  if (!world.policies.realisticHealthAndReproduction) return;
  const { health } = world.config;
  if (health.treatmentAnnualPct <= 0) return;
  // Financial planning does not need a clinical roll on every pig every day.
  // A monthly cohort round preserves the annual incidence, cost and delay while
  // avoiding millions of no-event draws on a large herd.
  if (world.day % 30 !== 0) return;

  const annual = health.treatmentAnnualPct / 100;
  const monthlyRate = 1 - Math.pow(1 - annual, 1 / 12);
  const treated = new Map<PigStage, typeof world.pigs>();

  for (const pig of world.pigs) {
    if (!pig.alive || pig.treatmentPenaltyDays > 0) continue;
    if (!world.variation.needsTreatment(monthlyRate, [pig.tag, Math.floor(world.day / 30)])) continue;

    pig.treatmentPenaltyDays = health.treatmentGrowthPenaltyDays;
    pig.treatmentGrowthFactor = Math.max(0, 1 - health.treatmentGrowthPenaltyPct / 100);
    pig.costs.add("health", pig.costStage, health.treatmentCostPerPig);
    const group = treated.get(pig.stage);
    if (group) group.push(pig);
    else treated.set(pig.stage, [pig]);
  }

  for (const [stage, pigs] of treated) {
    const cost = pigs.length * health.treatmentCostPerPig;
    world.ledger.accrue("veterinary", cost);
    world.record.treatments += pigs.length;
    world.lifetime.treatments += pigs.length;
    world.emit(
      "TreatmentGiven",
      pigs.length +
        (pigs.length === 1 ? " " + stage + " pig treated" : " " + stage + " pigs treated") +
        " for a respiratory or injury episode",
      {
        stage,
        entities: pigs.map((pig) => pig.tag),
        changes: {
          pigs: pigs.length,
          cost,
          reducedGainDays: health.treatmentGrowthPenaltyDays,
        },
        postings: [{ category: "veterinary", accrued: cost, cash: cost }],
      },
    );
  }
}
