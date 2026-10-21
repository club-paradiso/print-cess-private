import { PAIRING_SHAPES, type PairingReceiverView, type PairingShape } from "@print-cess/protocol";

import { ApiClientError } from "./api-client";

export type SenderPairing = {
  code: string;
  shape: PairingShape;
  expiresAt: number;
};

async function pairingJson<T>(url: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(15_000);
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  } & T;
  if (!response.ok) {
    throw new ApiClientError(
      body.error?.code ?? "networkError",
      body.error?.message ?? "Request failed",
      response.status,
    );
  }
  return body;
}

export async function openPairing(
  transferCode: string,
  shape: PairingShape,
  signal?: AbortSignal,
): Promise<SenderPairing> {
  const claimed = await pairingJson<{ code: string; expiresAt: number }>(
    "/api/pairings",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, transferCode, shape }),
    },
    signal,
  );
  return { ...claimed, shape };
}

export async function redeemPairing(
  code: string,
  shape: PairingShape,
  signal?: AbortSignal,
): Promise<string> {
  const view = await pairingJson<PairingReceiverView>(
    `/api/pairings/${code}/join`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, shape }),
    },
    signal,
  );
  return view.transferCode;
}

export function shapeChoices(): readonly PairingShape[] {
  return PAIRING_SHAPES;
}
