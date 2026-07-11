import ErrorBoundary from "@/components/ErrorBoundary";
import RaceClient from "@/components/RaceClient";

export default function RacePage() {
  return (
    <ErrorBoundary>
      <RaceClient />
    </ErrorBoundary>
  );
}
