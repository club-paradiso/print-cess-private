import { notFound } from "next/navigation";

import { BatchKioskSimulator } from "@/components/kiosk/batch-kiosk-simulator";
import { isBrowserKioskEnabled } from "@/server/demo";
import { requestKioskLocale } from "@/lib/request-locale";

export default async function BrowserKioskPage({
  searchParams,
}: {
  searchParams: Promise<{
    printing?: string | string[];
    sound?: string | string[];
  }>;
}) {
  if (process.env.NODE_ENV === "production" && !isBrowserKioskEnabled()) notFound();
  const { printing, sound } = await searchParams;
  const locale = await requestKioskLocale();
  // `?sound=off` for a counter where a completion tone would carry further than
  // it helps. The screen says the same thing either way.
  return (
    <BatchKioskSimulator
      automaticPrinting={printing === "auto"}
      sound={sound !== "off"}
      initialLocale={locale}
    />
  );
}
