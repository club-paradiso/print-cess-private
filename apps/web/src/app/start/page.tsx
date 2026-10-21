import type { ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  Camera,
  FileText,
  LaptopMinimal,
  LockKeyhole,
  Monitor,
  QrCode,
  ScanLine,
  Smartphone,
  UserX,
} from "lucide-react";

import { translate } from "@print-cess/i18n";
import { Beacon, RouteGlyph, Wordmark } from "@print-cess/ui";

import { PrintEntryActions, type PrintEntryLabels } from "@/components/home/print-entry-actions";
import { HomeLanguagePicker } from "@/components/home/home-language-picker";
import { sessionOriginFrom } from "@/lib/print-qr";
import { requestLocale } from "@/lib/request-locale";
import { isBrowserKioskEnabled } from "@/server/demo";

function keepNameTogether(sentence: string): ReactNode {
  const parts = sentence.split("Print-cess");
  return parts.flatMap((part, index) =>
    index === 0
      ? [part]
      : [
          <span className="home-nowrap" key={index}>
            Print-cess
          </span>,
          part,
        ],
  );
}

export default async function HomePage() {
  const locale = await requestLocale();
  const text = (key: string) => translate(locale, key);
  const kioskAvailable = process.env.NODE_ENV !== "production" || isBrowserKioskEnabled();

  const labels: PrintEntryLabels = {
    scanCta: text("homeScanQrCta"),
    lostCta: text("homeLostCta"),
    lostTitle: text("homeLostTitle"),
    lostSteps: [text("homeLostStep1"), text("homeLostStep2"), text("homeLostStep3")],
    lostHint: text("homeLostHint"),
    beaconCaption: text("homeBeaconCaption"),
    close: text("homeDialogClose"),
    scanTitle: text("qrScanTitle"),
    scanHint: text("qrScanHint"),
    scanStarting: text("qrScanStarting"),
    scanDenied: text("qrScanDenied"),
    scanUnsupported: text("qrScanUnsupported"),
    scanInvalid: text("qrScanInvalid"),
  };

  const steps = [
    { title: text("homePrintStepScan"), body: text("homePrintStepScanBody") },
    { title: text("homePrintStepPick"), body: text("homePrintStepPickBody") },
    { title: text("homePrintStepCollect"), body: text("homePrintStepCollectBody") },
  ];

  return (
    <main className="home">
      <header className="home-header">
        <Wordmark />
        <HomeLanguagePicker locale={locale} />
      </header>

      {/* Print comes first and takes most of the first screen. A visitor who
          arrives here has almost always come to print, and the one thing they
          need is to find the Print-cess screen, so the page shows them what to
          look for (the Beacon on a drawn screen) beside the instruction.
          Printing still has no link to a print route: a session only begins at
          that screen's QR code. */}
      <section className="print-entry" aria-labelledby="home-title">
        <div className="print-entry__copy">
          <h1 id="home-title">{text("homePrintHeading")}</h1>
          <p className="print-entry__lead">
            <span>{keepNameTogether(text("homePrintLead"))}</span>
            <span>{text("homePrintLead2")}</span>
          </p>
        </div>

        <figure className="print-entry__beacon">
          <div className="print-entry__screen" aria-hidden="true">
            <Beacon size="lg" />
            <span className="print-entry__screen-code">
              <QrCode />
            </span>
          </div>
          <figcaption>{text("homeBeaconCaption")}</figcaption>
        </figure>

        <PrintEntryActions
          labels={labels}
          sessionOrigin={sessionOriginFrom(process.env.PUBLIC_BASE_URL)}
        />

        {/* The deletion promise belongs to Print only: a Share transfer is kept
            until it is received, erased by the sender, or expires
            (docs/PRIVACY.md), so it must not sit under a band that reads as
            covering every tool on the page. */}
        <p className="print-entry__privacy">
          <LockKeyhole aria-hidden="true" />
          <span>{text("privacySummary")}</span>
        </p>
      </section>

      {/* The same three steps the phone and the big screen show, as one strip
          of paper with perforations between the steps. It comes after the
          Beacon so it never competes with the first thing to do. */}
      <section className="home-steps" aria-labelledby="home-steps-title">
        <h2 id="home-steps-title">{text("homeStepsLabel")}</h2>
        <ol className="home-steps__list">
          {steps.map((step, index) => (
            <li className="home-step" key={step.title}>
              <span className="home-step__head">
                <span className="home-step__number" aria-hidden="true">
                  {index + 1}
                </span>
                <strong>{step.title}</strong>
              </span>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Share and Scan are real, first-class tools, but they are not why most
          visitors came, so they sit below Print as two smaller sheets. */}
      <section className="home-more" aria-labelledby="home-more-title">
        <h2 id="home-more-title">{text("homeMoreTitle")}</h2>
        <div className="home-capabilities">
          <section className="home-sheet home-sheet--share" aria-labelledby="home-share">
            <RouteGlyph from={<Smartphone />} to={<LaptopMinimal />} />
            <h3 id="home-share">{text("homeShareTitle")}</h3>
            <p>{text("homeShareBody")}</p>
            <div className="home-sheet__actions">
              <a className="pc-button pc-button--secondary home-cta" href="/send">
                {text("homeShareCta")}
                <ArrowRight className="home-cta__arrow" aria-hidden="true" />
              </a>
              <a className="home-link" href="/receive">
                {text("homeReceiveCta")}
              </a>
            </div>
          </section>

          <section className="home-sheet home-sheet--scan" aria-labelledby="home-scan">
            <RouteGlyph from={<Camera />} to={<FileText />} />
            <h3 id="home-scan">{text("homeScanTitle")}</h3>
            <p>{text("homeScanBody")}</p>
            <div className="home-sheet__actions">
              <a className="pc-button pc-button--secondary home-cta" href="/scan">
                <ScanLine aria-hidden="true" />
                {text("homeScanCta")}
              </a>
            </div>
          </section>
        </div>
      </section>

      <ul className="home-trust">
        <li>
          <span className="home-trust__icon" aria-hidden="true">
            <UserX />
          </span>
          <span>{text("homeNoAccount")}</span>
        </li>
      </ul>

      {/* Setting up the display and managed workstations are for the people
          who run the service, not for the visitor in the queue, so they close
          the page instead of opening it. */}
      <nav className="home-workplace" aria-labelledby="home-workplace-title">
        <div>
          <h2 id="home-workplace-title">{text("homeWorkplaceTitle")}</h2>
          <p>{text("homeWorkplaceBody")}</p>
        </div>
        <ul>
          {kioskAvailable ? (
            <li>
              <a href="/kiosk">
                <Monitor aria-hidden="true" />
                {text("homeKioskCta")}
              </a>
            </li>
          ) : null}
          <li>
            <a href="/workstation">
              <Building2 aria-hidden="true" />
              {text("homeWorkstationCta")}
            </a>
          </li>
        </ul>
      </nav>
    </main>
  );
}
