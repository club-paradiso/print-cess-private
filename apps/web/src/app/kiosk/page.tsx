import { notFound } from "next/navigation";

import { BatchKioskSimulator } from "@/components/kiosk/batch-kiosk-simulator";
import { isBrowserKioskEnabled } from "@/server/demo";

export default async function BrowserKioskPage({
  searchParams,
}: {
  searchParams: Promise<{ printing?: string | string[]; sound?: string | string[] }>;
}) {
  if (process.env.NODE_ENV === "production" && !isBrowserKioskEnabled()) notFound();
  const { printing, sound } = await searchParams;
  return <BatchKioskSimulator automaticPrinting={printing === "auto"} sound={sound !== "off"} />;
}
