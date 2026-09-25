import { redirect } from "next/navigation";

import { feedFormulationHref } from "@/lib/routes";

export default function LegacyRequirementsPage() {
  redirect(feedFormulationHref("nutrients"));
}
