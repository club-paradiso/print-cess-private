"use client";

import { useCallback, useState } from "react";

import type { PairingShape } from "@print-cess/protocol";

import { openPairing, shapeChoices, type SenderPairing } from "@/lib/drop-pairing";
import type { Text } from "@/lib/use-visitor-locale";

import { PairingShapeMark, shapeLabel } from "./pairing-shape";

export function PairingHandover({
  transferCode,
  sealed,
  text,
}: {
  transferCode: string;
  sealed: boolean;
  text: Text;
}) {
  const [pairing, setPairing] = useState<SenderPairing>();
  const [creating, setCreating] = useState<PairingShape>();
  const [failed, setFailed] = useState(false);

  const pick = useCallback(
    async (shape: PairingShape) => {
      if (!sealed || creating || pairing) return;
      setCreating(shape);
      setFailed(false);
      try {
        setPairing(await openPairing(transferCode, shape));
      } catch {
        setFailed(true);
      } finally {
        setCreating(undefined);
      }
    },
    [creating, pairing, sealed, transferCode],
  );

  if (!sealed) {
    return (
      <section className="pairing-pick" aria-live="polite">
        <p className="drop-notice" role="status">
          {text("pairWaitingReceiver")}
        </p>
      </section>
    );
  }

  if (pairing) {
    return (
      <section className="pairing-created" aria-live="polite">
        <div className="pairing-digits">
          <span className="pairing-digits__label">{text("pairShortCode")}</span>
          <strong data-testid="pairing-code">{pairing.code}</strong>
          <small>{text("pairShortCodeHint")}</small>
        </div>
        <figure className="pairing-shown pairing-shown--selected">
          <div className="pairing-shown__figure" data-testid={`pairing-selected-${pairing.shape}`}>
            <PairingShapeMark shape={pairing.shape} />
          </div>
          <figcaption>{shapeLabel(pairing.shape, text)}</figcaption>
        </figure>
        <p className="drop-notice" role="status">
          {text(sealed ? "pairHandedOver" : "pairWaitingReceiver")}
        </p>
        <button type="button" className="pairing-back" onClick={() => setPairing(undefined)}>
          {text("dropClearSelection")}
        </button>
      </section>
    );
  }

  return (
    <section className="pairing-pick">
      <h2>{text("pairPickShape")}</h2>
      <p>{text("pairPickShapeHint")}</p>
      {failed ? (
        <p className="drop-notice" role="alert">
          {text("dropNetworkError")}
        </p>
      ) : null}
      <div className="pairing-choices">
        {shapeChoices().map((choice) => (
          <button
            key={choice}
            type="button"
            disabled={creating !== undefined}
            onClick={() => void pick(choice)}
            data-testid={`pairing-choice-${choice}`}
          >
            <PairingShapeMark shape={choice} />
            <span>{shapeLabel(choice, text)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
