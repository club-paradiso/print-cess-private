"use client";

import { CheckCircle2, CircleAlert, LoaderCircle, ShieldAlert } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { ApiClientError, getDropCapabilities } from "@/lib/drop-client";
import { preferSameOriginStorageRoute } from "@/lib/drop-transfer";

type Copy = {
  checking: string;
  ready: string;
  limited: string;
  blocked: string;
  secureContext: string;
  webCrypto: string;
  fileApi: string;
  downloadApi: string;
  serviceReach: string;
  sameOriginRoute: string;
  pass: string;
  pending: string;
  fail: string;
  blockedHint: string;
  limitedHint: string;
  unreachableHint: string;
  serviceErrorHint: string;
  preferRelay: string;
  relaySelected: string;
  noGuarantee: string;
};

type NetworkState =
  | { status: "checking" }
  | { status: "reachable"; sameOriginTransfers: boolean }
  | { status: "unreachable" }
  | { status: "service-error" };

type ReadinessCheck = {
  key: string;
  label: string;
  ok: boolean | null;
  required: boolean;
};

export function WorkstationReadiness({ copy }: { copy: Copy }) {
  const hydrated = useSyncExternalStore(subscribeNever, readHydrated, readNotHydrated);
  const secureContext = useSyncExternalStore(subscribeNever, readSecureContext, readNotHydrated);
  const webCrypto = useSyncExternalStore(subscribeNever, readWebCrypto, readNotHydrated);
  const fileApi = useSyncExternalStore(subscribeNever, readFileApi, readNotHydrated);
  const downloadApi = useSyncExternalStore(subscribeNever, readDownloadApi, readNotHydrated);
  const network = useNetworkState();
  const [relaySelected, setRelaySelected] = useState(false);

  if (!hydrated) {
    return (
      <section className="workstation-readiness" aria-live="polite">
        <div className="workstation-readiness__headline">
          <LoaderCircle className="workstation-readiness__spinner" aria-hidden="true" />
          <strong>{copy.checking}</strong>
        </div>
      </section>
    );
  }

  const checks: ReadinessCheck[] = [
    { key: "secure-context", label: copy.secureContext, ok: secureContext, required: true },
    { key: "web-crypto", label: copy.webCrypto, ok: webCrypto, required: true },
    { key: "file-api", label: copy.fileApi, ok: fileApi, required: true },
    { key: "download-api", label: copy.downloadApi, ok: downloadApi, required: false },
    {
      key: "service-reach",
      label: copy.serviceReach,
      ok: network.status === "checking" ? null : network.status === "reachable",
      required: true,
    },
    {
      key: "same-origin-route",
      label: copy.sameOriginRoute,
      ok:
        network.status === "checking"
          ? null
          : network.status === "reachable" && network.sameOriginTransfers,
      required: false,
    },
  ];
  const requiredFailure = checks.some((check) => check.required && check.ok === false);
  const optionalFailure = checks.some((check) => !check.required && check.ok === false);
  const requiredPending = checks.some((check) => check.required && check.ok === null);
  const tone = requiredFailure
    ? "blocked"
    : requiredPending
      ? "checking"
      : optionalFailure
        ? "limited"
        : "ready";
  const title = requiredFailure
    ? copy.blocked
    : requiredPending
      ? copy.checking
      : optionalFailure
        ? copy.limited
        : copy.ready;
  const Icon = requiredFailure
    ? ShieldAlert
    : requiredPending
      ? LoaderCircle
      : optionalFailure
        ? CircleAlert
        : CheckCircle2;

  return (
    <section className={`workstation-readiness workstation-readiness--${tone}`} aria-live="polite">
      <div className="workstation-readiness__headline">
        <Icon
          className={
            requiredPending && !requiredFailure ? "workstation-readiness__spinner" : undefined
          }
          aria-hidden="true"
        />
        <strong>{title}</strong>
      </div>
      <ul>
        {checks.map((check) => (
          <li
            key={check.key}
            className={check.ok === null ? "is-pending" : check.ok ? "is-pass" : "is-fail"}
          >
            <span>{check.label}</span>
            <strong>{check.ok === null ? copy.pending : check.ok ? copy.pass : copy.fail}</strong>
          </li>
        ))}
      </ul>
      {network.status === "unreachable" ? (
        <p>{copy.unreachableHint}</p>
      ) : network.status === "service-error" ? (
        <p>{copy.serviceErrorHint}</p>
      ) : requiredFailure ? (
        <p>{copy.blockedHint}</p>
      ) : optionalFailure ? (
        <p>{copy.limitedHint}</p>
      ) : null}
      {network.status === "reachable" && network.sameOriginTransfers ? (
        <button
          className="workstation-prefer-relay"
          type="button"
          disabled={relaySelected}
          onClick={() => {
            preferSameOriginStorageRoute();
            setRelaySelected(true);
          }}
        >
          {relaySelected ? copy.relaySelected : copy.preferRelay}
        </button>
      ) : null}
      <p>{copy.noGuarantee}</p>
    </section>
  );
}

function useNetworkState(): NetworkState {
  const [state, setState] = useState<NetworkState>({ status: "checking" });
  useEffect(() => {
    const controller = new AbortController();
    getDropCapabilities(controller.signal)
      .then((capabilities) =>
        setState({
          status: "reachable",
          sameOriginTransfers: capabilities.sameOriginTransfers === true,
        }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(
          error instanceof ApiClientError && error.status > 0
            ? { status: "service-error" }
            : { status: "unreachable" },
        );
      });
    return () => controller.abort();
  }, []);
  return state;
}

function subscribeNever(): () => void {
  return () => undefined;
}

function readHydrated(): boolean {
  return true;
}

function readNotHydrated(): boolean {
  return false;
}

function readSecureContext(): boolean {
  return window.isSecureContext;
}

function readWebCrypto(): boolean {
  return Boolean(globalThis.crypto?.subtle);
}

function readFileApi(): boolean {
  return (
    typeof File !== "undefined" && typeof Blob !== "undefined" && typeof FileReader !== "undefined"
  );
}

function readDownloadApi(): boolean {
  return "download" in document.createElement("a");
}
