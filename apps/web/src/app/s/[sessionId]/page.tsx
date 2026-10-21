import { notFound } from "next/navigation";

import { SESSION_ID_PATTERN } from "@print-cess/protocol";

import { BatchMobileFlow } from "@/components/mobile/batch-mobile-flow";
import { requestLocale } from "@/lib/request-locale";

export default async function MobileSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (!SESSION_ID_PATTERN.test(sessionId)) notFound();
  return <BatchMobileFlow sessionId={sessionId} initialLocale={await requestLocale()} />;
}
