"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Lock, Printer, ShieldCheck } from "lucide-react";

import type { PrintQuotaDecision } from "@print-cess/protocol";
import { PrimaryButton, SecondaryButton } from "@print-cess/ui";

import type { Text } from "@/lib/use-visitor-locale";

export function PrintQuotaDialog({
  decision,
  text,
  onReselect,
  onCancel,
}: {
  decision: PrintQuotaDecision;
  text: Text;
  onReselect: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const hardLimit = decision.kind === "hardLimitExceeded";

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const handleReselect = useCallback(() => {
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
      input.value = "";
    }
    onReselect();
  }, [onReselect]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    },
    [onCancel],
  );

  return (
    <div className="quota-overlay" onKeyDown={onKeyDown}>
      <div
        className={hardLimit ? "quota-dialog quota-dialog--hard" : "quota-dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        ref={dialogRef}
      >
        {hardLimit ? (
          <HardLimitPanel decision={decision} text={text} titleId={titleId} bodyId={bodyId} />
        ) : (
          <PaywallPanel decision={decision} text={text} titleId={titleId} bodyId={bodyId} />
        )}

        <div className="quota-actions">
          <PrimaryButton type="button" onClick={handleReselect}>
            {text("quotaReselect")}
          </PrimaryButton>
          {hardLimit ? null : (
            <SecondaryButton type="button" onClick={onCancel}>
              {text("quotaCancel")}
            </SecondaryButton>
          )}
        </div>
      </div>
    </div>
  );
}

function QuotaSummary({
  decision,
  text,
  limitLabel,
  limitValue,
}: {
  decision: PrintQuotaDecision;
  text: Text;
  limitLabel: string;
  limitValue: string;
}) {
  return (
    <dl className="quota-summary">
      <div>
        <dt>{text("quotaSelectedLabel")}</dt>
        <dd className="quota-summary__count">
          {text("quotaPagesValue", { pages: decision.totalPages })}
        </dd>
      </div>
      <div>
        <dt>{limitLabel}</dt>
        <dd>{limitValue}</dd>
      </div>
    </dl>
  );
}

function HardLimitPanel({
  decision,
  text,
  titleId,
  bodyId,
}: {
  decision: PrintQuotaDecision;
  text: Text;
  titleId: string;
  bodyId: string;
}) {
  return (
    <div className="quota-hard">
      <span className="quota-hard__icon" aria-hidden="true">
        <Printer />
      </span>
      <h2 id={titleId}>{text("quotaHardTitle")}</h2>
      <div id={bodyId}>
        <QuotaSummary
          decision={decision}
          text={text}
          limitLabel={text("quotaHardMaxLabel")}
          limitValue={text("quotaPagesValue", { pages: decision.systemLimit })}
        />
      </div>
      <p className="quota-hard__aside">{text("quotaHardJoke")}</p>
    </div>
  );
}

type CtaStage = "idle" | "searching" | "notFound";

function PaywallPanel({
  decision,
  text,
  titleId,
  bodyId,
}: {
  decision: PrintQuotaDecision;
  text: Text;
  titleId: string;
  bodyId: string;
}) {
  const [stage, setStage] = useState<CtaStage>("idle");
  const [staffOpen, setStaffOpen] = useState(false);
  const staffBodyId = useId();

  useEffect(() => {
    if (stage !== "searching") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const timer = window.setTimeout(() => setStage("notFound"), reduced ? 200 : 1400);
    return () => window.clearTimeout(timer);
  }, [stage]);

  return (
    <div className="quota-paywall">
      <header className="quota-paywall__head">
        <span className="quota-paywall__badge" aria-hidden="true">
          <Lock />
        </span>
        <h2 id={titleId}>{text("quotaPaywallTitle")}</h2>
        <p className="quota-paywall__lead">{text("quotaPaywallLead")}</p>
      </header>

      <div id={bodyId}>
        <QuotaSummary
          decision={decision}
          text={text}
          limitLabel={text("quotaFreeLabel")}
          limitValue={text("quotaFreePagesValue", { pages: decision.publicLimit })}
        />
        <p className="quota-paywall__over">{text("quotaOverBody")}</p>
      </div>

      <ol className="quota-plans">
        <li className="quota-plan">
          <p className="quota-plan__name">{text("quotaPlanFree")}</p>
          <p className="quota-plan__price">
            <strong>₩0</strong>
          </p>
          <p className="quota-plan__pages">
            {text("quotaPagesValue", { pages: decision.publicLimit })}
          </p>
        </li>
        <li className="quota-plan quota-plan--pro">
          <p className="quota-plan__badge">{text("quotaBadgePopular")}</p>
          <p className="quota-plan__name">{text("quotaPlanPro")}</p>
          <p className="quota-plan__price">
            <strong>₩999,000</strong>
            <span>{text("quotaPerMonth")}</span>
          </p>
          <p className="quota-plan__pages">
            {text("quotaPagesValue", { pages: decision.systemLimit })}
          </p>
        </li>
        <li className="quota-plan quota-plan--ultra">
          <p className="quota-plan__badge">{text("quotaBadgeValue")}</p>
          <p className="quota-plan__name">{text("quotaPlanUltra")}</p>
          <p className="quota-plan__price">
            <strong>₩20,000,000</strong>
            <span>{text("quotaPerYear")}</span>
          </p>
          <p className="quota-plan__pages">
            {text("quotaPagesValue", { pages: decision.systemLimit })}
          </p>
        </li>
      </ol>

      <table className="quota-compare">
        <caption>{text("quotaCompareTitle")}</caption>
        <tbody>
          <tr>
            <th scope="row">{text("quotaComparePrinter")}</th>
            <td>{text("quotaCompareSame")}</td>
          </tr>
          <tr>
            <th scope="row">{text("quotaCompareQuality")}</th>
            <td>{text("quotaCompareSame")}</td>
          </tr>
          <tr>
            <th scope="row">{text("quotaComparePaper")}</th>
            <td>{text("quotaCompareSame")}</td>
          </tr>
        </tbody>
      </table>

      {stage === "notFound" ? (
        <div className="quota-cta-result" role="status" aria-live="polite">
          <strong>{text("quotaNotFoundTitle")}</strong>
          <p>{text("quotaNotFoundBody", { pages: decision.publicLimit })}</p>
        </div>
      ) : (
        <button
          type="button"
          className="quota-cta"
          onClick={() => setStage("searching")}
          disabled={stage === "searching"}
          aria-live="polite"
        >
          {stage === "searching" ? (
            <>
              <span className="quota-cta__spinner" aria-hidden="true" />
              {text("quotaCtaSearching")}
            </>
          ) : (
            text("quotaCta")
          )}
        </button>
      )}

      <p className="quota-disclaimer">{text("quotaDisclaimer")}</p>

      <div className="quota-staff">
        <button
          type="button"
          className="quota-staff__toggle"
          aria-expanded={staffOpen}
          aria-controls={staffBodyId}
          onClick={() => setStaffOpen((open) => !open)}
        >
          <ShieldCheck aria-hidden="true" />
          {text("quotaStaffAccess")}
        </button>
        <p id={staffBodyId} hidden={!staffOpen} className="quota-staff__body">
          {text("quotaStaffBody")}
        </p>
      </div>
    </div>
  );
}
