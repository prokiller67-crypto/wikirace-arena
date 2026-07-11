import ErrorBoundary from "@/components/ErrorBoundary";
import RoomClient from "@/components/RoomClient";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <ErrorBoundary>
      <RoomClient code={code.toUpperCase()} />
    </ErrorBoundary>
  );
}
