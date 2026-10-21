import { redirect } from "next/navigation";

import { BatchKioskSimulator } from "@/components/kiosk/batch-kiosk-simulator";
import { isBrowserKioskEnabled } from "@/server/demo";
import { requestLocale } from "@/lib/request-locale";

/**
 * The main page is the shared display: the print QR code first, and in its
 * header the doors to everything else (send, receive, scan, work computer,
 * the visitor's guide at `/start`). `/kiosk` shows the same screen without
 * those links, for a station that must never be tapped away from its code.
 * The same `?printing=auto` and `?sound=off` switches work on both.
 *
 * When the browser kiosk is switched off in Production, the root falls back
 * to the visitor's guide instead of a 404.
 */
export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<{ printing?: string | string[]; sound?: string | string[] }>;
}) {
  if (process.env.NODE_ENV === "production" && !isBrowserKioskEnabled()) redirect("/start");
  const { printing, sound } = await searchParams;
  const locale = await requestLocale();
  return (
    <BatchKioskSimulator automaticPrinting={printing === "auto"} sound={sound !== "off"} services initialLocale={locale} />
  );
}
