import { redirect } from "next/navigation";

import { BatchKioskSimulator } from "@/components/kiosk/batch-kiosk-simulator";
import { isBrowserKioskEnabled } from "@/server/demo";
import { requestKioskLocale } from "@/lib/request-locale";

export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<{ printing?: string | string[]; sound?: string | string[] }>;
}) {
  if (process.env.NODE_ENV === "production" && !isBrowserKioskEnabled()) redirect("/start");
  const { printing, sound } = await searchParams;
  const locale = await requestKioskLocale();
  return (
    <BatchKioskSimulator
      automaticPrinting={printing === "auto"}
      sound={sound !== "off"}
      services
      initialLocale={locale}
    />
  );
}
