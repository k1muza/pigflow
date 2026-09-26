import { redirect } from "next/navigation";

import { feedFormulationHref } from "@/lib/routes";

export default function LegacyProjectIngredientCatalogPage() {
  redirect(feedFormulationHref("ingredients"));
}
