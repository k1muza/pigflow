import { NextResponse } from "next/server";
import { z } from "zod";

import { formulateLeastCostDiet } from "@/lib/feed-optimizer";
import { feedProgrammePhaseById } from "@/lib/feed-programmes";

const requestSchema = z.object({
  programmeId: z.string().min(1),
  phaseId: z.string().min(1),
  energySystem: z.enum(["ME", "NE"]).default("ME"),
  ingredients: z.array(
    z.object({
      ingredientId: z.string().min(1),
      pricePerKg: z.number().finite().nonnegative(),
      minInclusionPct: z.number().finite().min(0).max(100).optional(),
      maxInclusionPct: z.number().finite().min(0).max(100).optional(),
    }),
  ).min(1),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        status: "error",
        message: "Invalid formulation request.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const { programmeId, phaseId, energySystem, ingredients } = parsed.data;
  const phase = feedProgrammePhaseById(programmeId, phaseId);
  if (!phase) {
    return NextResponse.json(
      {
        status: "error",
        message: `Unknown requirement phase ${phaseId} for programme ${programmeId}.`,
      },
      { status: 404 },
    );
  }

  const result = await formulateLeastCostDiet(
    phase,
    energySystem,
    ingredients,
  );

  return NextResponse.json(result);
}
