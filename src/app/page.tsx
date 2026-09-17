import PlannerApp from "@/components/planner-app";
import AuthGate from "@/components/auth-gate";

export default function Home() {
  return (
    <AuthGate>
      <PlannerApp />
    </AuthGate>
  );
}
