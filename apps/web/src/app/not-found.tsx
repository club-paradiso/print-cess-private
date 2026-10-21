import { ArrowLeft, QrCode } from "lucide-react";
import Link from "next/link";

import { translate } from "@print-cess/i18n";
import { StatusIcon, Wordmark } from "@print-cess/ui";

import { requestLocale } from "@/lib/request-locale";

export default async function NotFound() {
  const locale = await requestLocale();
  const text = (key: string) => translate(locale, key);

  return (
    <main className="status-page status-page--narrow">
      <header className="home-header">
        <Wordmark />
      </header>
      <section className="mobile-step">
        <StatusIcon>
          <QrCode size={32} aria-hidden="true" />
        </StatusIcon>
        <h1>{text("notFoundTitle")}</h1>
        <p>{text("notFoundBody")}</p>
        <Link className="pc-button pc-button--secondary" href="/start">
          <ArrowLeft aria-hidden="true" /> {text("notFoundHome")}
        </Link>
      </section>
    </main>
  );
}
