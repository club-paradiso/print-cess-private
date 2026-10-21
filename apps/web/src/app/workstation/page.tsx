import {
  ArrowLeft,
  Building2,
  Download,
  FileKey2,
  LockKeyhole,
  MonitorCheck,
  Send,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { Wordmark } from "@print-cess/ui";

import { requestLocale } from "@/lib/request-locale";
import { relayStoreId } from "@/server/blob-relay";

import { WorkstationReadiness } from "./workstation-readiness";

const copy = {
  ko: {
    eyebrow: "국가기관 · 공공기관 업무용 PC",
    title: "설치 없이, 업무용 브라우저에서 바로 사용",
    intro:
      "휴대전화의 문서를 업무용 PC로 받거나, 업무용 PC의 파일을 다른 기기로 보낼 수 있습니다. 별도 프로그램, 브라우저 확장, 로그인은 필요하지 않습니다.",
    receiveTitle: "휴대전화 → 업무용 PC",
    receiveBody:
      "휴대전화에서 파일을 보낸 뒤 휴대전화에 표시되는 두 자리 숫자와 도형을 이 PC에서 입력합니다. 카메라 사용이 막힌 기관 PC에서도 받을 수 있습니다.",
    receiveCta: "이 PC에서 파일 받기",
    sendTitle: "업무용 PC → 휴대전화",
    sendBody:
      "업무용 PC에서 파일을 선택해 암호화 전송을 만들고, 휴대전화에서 QR 코드나 두 자리 숫자로 받습니다.",
    sendCta: "이 PC에서 파일 보내기",
    securityTitle: "기관 보안정책을 우회하지 않습니다",
    securityBody:
      "Print-cess는 브라우저의 표준 HTTPS와 Web Crypto를 사용합니다. 기관의 DLP, 다운로드 차단, 프록시, 망분리 또는 허용 도메인 정책이 전송을 막으면 해당 정책이 우선합니다.",
    privacyTitle: "업무용 사용 시 확인",
    privacyItems: [
      "실제 민감문서는 기관의 내부 보안지침에서 외부 웹서비스 사용을 허용하는 경우에만 전송하세요.",
      "전송 파일은 종단간 암호화되며, 서비스는 파일 내용을 해독하지 않도록 설계되어 있습니다.",
      "전송이 끝나면 받은 파일이 올바른 위치에 저장됐는지 확인하고 필요하면 전송을 즉시 삭제하세요.",
      "Internet Explorer 모드나 오래된 브라우저는 지원 대상이 아닙니다. 최신 Microsoft Edge 또는 Chrome 계열 브라우저를 권장합니다.",
    ],
    allowlistRelay:
      "기관에서 허용 도메인을 등록해야 한다면 이 사이트 주소 하나만 요청하면 됩니다. 파일은 별도 저장소 주소가 아닌 이 주소를 거쳐 전송됩니다.",
    allowlistDirect:
      "기관에서 허용 도메인을 등록해야 한다면 이 사이트 주소와 함께 파일 저장소 주소도 허용해야 합니다. 저장소 주소는 이 서비스 운영자에게 확인하세요.",
    back: "처음으로",
    checking: "이 PC의 브라우저 호환성을 확인하는 중…",
    ready: "이 PC에서 핵심 기능을 사용할 수 있습니다",
    limited: "사용 가능하지만 일부 저장 기능이 제한될 수 있습니다",
    blocked: "이 브라우저에서는 안전한 전송을 시작할 수 없습니다",
    secureContext: "HTTPS 보안 연결",
    webCrypto: "표준 Web Crypto 암호화",
    fileApi: "브라우저 파일 선택 기능",
    downloadApi: "브라우저 다운로드 기능",
    serviceReach: "기관 네트워크에서 Print-cess 서버 연결",
    sameOriginRoute: "저장소 주소 대신 Print-cess 주소로 전송",
    pass: "사용 가능",
    pending: "확인 중",
    fail: "제한됨",
    blockedHint:
      "HTTPS 접속인지 확인하고 최신 Edge 또는 Chrome으로 다시 여세요. 기관 정책이 기능을 차단한 경우 Print-cess가 이를 우회하지 않습니다.",
    limitedHint:
      "전송은 가능할 수 있지만 일부 기능이 제한됩니다. 저장 방식이 브라우저 기본 다운로드로 바뀔 수 있고, 저장소 주소를 차단하는 기관 망에서는 전송이 실패할 수 있습니다. 다운로드 폴더와 기관 보안정책을 확인하세요.",
    unreachableHint:
      "이 PC의 네트워크에서 Print-cess 서버에 연결하지 못했습니다. 기관 프록시나 허용 도메인 목록에 이 사이트 주소가 포함돼 있는지 정보화 담당 부서에 확인하세요.",
  },
  en: {
    eyebrow: "Government · public-sector work computer",
    title: "Use Print-cess in a managed browser, with no install",
    intro:
      "Receive documents from a phone on a work computer, or send files from the work computer to another device. No desktop app, browser extension, or account is required.",
    receiveTitle: "Phone → work computer",
    receiveBody:
      "Send the files from the phone, then enter the two numbers and the shape the phone shows on this computer. This works even when a managed computer blocks the camera.",
    receiveCta: "Receive files on this computer",
    sendTitle: "Work computer → phone",
    sendBody:
      "Choose files on the work computer, create an encrypted transfer, then receive them on the phone with the QR code or the two numbers.",
    sendCta: "Send files from this computer",
    securityTitle: "Print-cess does not bypass agency security controls",
    securityBody:
      "Print-cess uses standard browser HTTPS and Web Crypto. If DLP, download controls, proxies, network separation, or domain allowlists block a transfer, the agency policy takes precedence.",
    privacyTitle: "Before using it for work",
    privacyItems: [
      "Transfer real sensitive documents only when your organization permits the use of an external web service for that document class.",
      "Transfer payloads are end-to-end encrypted and the service is designed not to decrypt file contents.",
      "After receiving files, confirm where the browser saved them and delete the transfer immediately when appropriate.",
      "Internet Explorer mode and obsolete browsers are not supported. A current Microsoft Edge or Chromium-based browser is recommended.",
    ],
    allowlistRelay:
      "If your agency must allowlist domains, request only this site's address. Files travel through it rather than through a separate storage host.",
    allowlistDirect:
      "If your agency must allowlist domains, request this site's address and the file storage address too. Ask the operator of this service for the storage address.",
    back: "Back to start",
    checking: "Checking this browser for work-computer compatibility…",
    ready: "This browser supports the core transfer flow",
    limited: "Usable, but some save options may be limited",
    blocked: "This browser cannot start a secure transfer",
    secureContext: "HTTPS secure context",
    webCrypto: "Standards-based Web Crypto",
    fileApi: "Browser file selection",
    downloadApi: "Browser download support",
    serviceReach: "Print-cess server reachable from this network",
    sameOriginRoute: "Transfers use the Print-cess address, not a storage host",
    pass: "Available",
    pending: "Checking",
    fail: "Limited",
    blockedHint:
      "Confirm that you opened the HTTPS site and retry in a current Edge or Chrome browser. Print-cess will not bypass a feature blocked by agency policy.",
    limitedHint:
      "Transfers may still work, with limits: saving can fall back to the browser's normal Downloads folder, and a network that blocks storage hosts may stop the transfer. Check the saved location and your agency policy.",
    unreachableHint:
      "This computer's network could not reach the Print-cess server. Ask your IT team whether this site's address is on the agency proxy or domain allowlist.",
  },
} as const;

export default async function WorkstationPage() {
  const locale = await requestLocale();
  const text = locale === "ko" ? copy.ko : copy.en;
  const policyItems = [
    ...text.privacyItems,
    relayStoreId() ? text.allowlistRelay : text.allowlistDirect,
  ];

  return (
    <main className="workstation-page">
      <header className="workstation-header">
        <Wordmark />
        <Link className="workstation-back" href="/start">
          <ArrowLeft aria-hidden="true" /> {text.back}
        </Link>
      </header>

      <section className="workstation-hero">
        <div className="workstation-eyebrow">
          <Building2 aria-hidden="true" /> {text.eyebrow}
        </div>
        <h1>{text.title}</h1>
        <p>{text.intro}</p>
      </section>

      <WorkstationReadiness
        copy={{
          checking: text.checking,
          ready: text.ready,
          limited: text.limited,
          blocked: text.blocked,
          secureContext: text.secureContext,
          webCrypto: text.webCrypto,
          fileApi: text.fileApi,
          downloadApi: text.downloadApi,
          serviceReach: text.serviceReach,
          sameOriginRoute: text.sameOriginRoute,
          pass: text.pass,
          pending: text.pending,
          fail: text.fail,
          blockedHint: text.blockedHint,
          limitedHint: text.limitedHint,
          unreachableHint: text.unreachableHint,
        }}
      />

      <section className="workstation-actions" aria-label={text.title}>
        <article className="workstation-action-card">
          <div className="workstation-action-card__icon">
            <Download aria-hidden="true" />
          </div>
          <div>
            <h2>{text.receiveTitle}</h2>
            <p>{text.receiveBody}</p>
          </div>
          <Link className="workstation-primary" href="/receive">
            <MonitorCheck aria-hidden="true" /> {text.receiveCta}
          </Link>
        </article>

        <article className="workstation-action-card">
          <div className="workstation-action-card__icon">
            <Send aria-hidden="true" />
          </div>
          <div>
            <h2>{text.sendTitle}</h2>
            <p>{text.sendBody}</p>
          </div>
          <Link className="workstation-primary" href="/send">
            <FileKey2 aria-hidden="true" /> {text.sendCta}
          </Link>
        </article>
      </section>

      <section className="workstation-security">
        <div className="workstation-security__heading">
          <ShieldCheck aria-hidden="true" />
          <h2>{text.securityTitle}</h2>
        </div>
        <p>{text.securityBody}</p>
      </section>

      <section className="workstation-policy">
        <div className="workstation-policy__heading">
          <LockKeyhole aria-hidden="true" />
          <h2>{text.privacyTitle}</h2>
        </div>
        <ul>
          {policyItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
