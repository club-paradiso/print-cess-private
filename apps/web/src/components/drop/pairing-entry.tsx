"use client";

import { Delete } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PAIRING_CODE_LENGTH, type PairingShape } from "@print-cess/protocol";

import { ApiClientError } from "@/lib/api-client";
import { redeemPairing, shapeChoices } from "@/lib/drop-pairing";
import type { Text } from "@/lib/use-visitor-locale";

import { PairingShapeMark, shapeLabel } from "./pairing-shape";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export function PairingEntry({
  text,
  onTransferCode,
}: {
  text: Text;
  onTransferCode: (code: string) => void;
}) {
  const [digits, setDigits] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [noticeKey, setNoticeKey] = useState<string>();
  const abort = useRef<AbortController>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const redeem = useCallback(
    async (shape: PairingShape) => {
      if (digits.length !== PAIRING_CODE_LENGTH || redeeming) return;
      const controller = new AbortController();
      abort.current = controller;
      setRedeeming(true);
      setNoticeKey(undefined);
      try {
        onTransferCode(await redeemPairing(digits, shape, controller.signal));
      } catch (error) {
        if (controller.signal.aborted) return;
        setDigits("");
        setNoticeKey(
          error instanceof ApiClientError && error.status === 404
            ? "pairCodeUnknown"
            : "dropNetworkError",
        );
      } finally {
        setRedeeming(false);
      }
    },
    [digits, onTransferCode, redeeming],
  );

  const press = useCallback((digit: string) => {
    setNoticeKey(undefined);
    setDigits((current) => (current.length >= PAIRING_CODE_LENGTH ? current : current + digit));
  }, []);

  if (digits.length === PAIRING_CODE_LENGTH) {
    return (
      <section className="mobile-step" aria-live="polite">
        <h1>{text("pairShowShape")}</h1>
        <p>{text("pairShowShapeHint")}</p>
        <p className="pairing-entry" data-testid="pairing-entry" role="status">
          {digits}
        </p>
        <div className="pairing-choices">
          {shapeChoices().map((shape) => (
            <button
              key={shape}
              type="button"
              disabled={redeeming}
              onClick={() => void redeem(shape)}
              data-testid={`pairing-shape-${shape}`}
            >
              <PairingShapeMark shape={shape} />
              <span>{shapeLabel(shape, text)}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="pairing-back"
          disabled={redeeming}
          onClick={() => setDigits("")}
        >
          {text("dropBack")}
        </button>
      </section>
    );
  }

  return (
    <section className="mobile-step">
      <h1>{text("pairEnterShortCode")}</h1>
      <p>{text("pairEnterShortCodeHint")}</p>
      {/* One box per digit, the next one to fill drawn as active, so the
          visitor sees where they are without counting dashes. */}
      <p
        className="pairing-entry pairing-entry--slots"
        data-testid="pairing-entry"
        aria-label={text("pairEnterShortCode")}
        role="status"
      >
        {Array.from({ length: PAIRING_CODE_LENGTH }, (_, index) => (
          <span
            key={index}
            className={
              index === digits.length
                ? "pairing-slot is-next"
                : digits[index]
                  ? "pairing-slot is-filled"
                  : "pairing-slot"
            }
          >
            {digits[index] ?? ""}
          </span>
        ))}
      </p>
      {noticeKey ? (
        <p className="drop-notice" role="alert">
          {text(noticeKey)}
        </p>
      ) : null}
      <div className="pairing-keypad">
        {KEYS.map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => press(digit)}
            data-testid={`pairing-key-${digit}`}
          >
            {digit}
          </button>
        ))}
        <span />
        <button type="button" onClick={() => press("0")} data-testid="pairing-key-0">
          0
        </button>
        <button
          type="button"
          disabled={digits.length === 0}
          onClick={() => setDigits((current) => current.slice(0, -1))}
          aria-label={text("dropBack")}
          data-testid="pairing-key-back"
        >
          <Delete aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
