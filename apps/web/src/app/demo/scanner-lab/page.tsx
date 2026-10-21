import { notFound } from "next/navigation";

import { ScannerLab } from "@/components/scan/scanner-lab";
import { isDemoRouteEnabled } from "@/server/demo";

export const metadata = { robots: { index: false, follow: false } };

export default function ScannerLabPage() {
  if (process.env.NODE_ENV === "production" && !isDemoRouteEnabled()) notFound();
  return <ScannerLab />;
}
