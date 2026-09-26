import { redirect } from "next/navigation";

import { feedIngredientHref } from "@/lib/routes";

export default async function LegacyProjectIngredientPage({
  params,
}: {
  params: Promise<{ ingredientId: string }>;
}) {
  const { ingredientId } = await params;
  redirect(feedIngredientHref(ingredientId));
}
