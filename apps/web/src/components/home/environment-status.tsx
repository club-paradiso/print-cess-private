import { WorkstationReadiness } from "@/app/workstation/workstation-readiness";

export function EnvironmentStatus({ locale }: { locale: string }) {
  const ko = locale === "ko";
  return (
    <section className="home-environment" id="environment">
      <details>
        <summary>{ko ? "이 기기에서 잘 작동하는지 확인하기" : "Check compatibility on this device"}</summary>
        <p>
          {ko
            ? "휴대전화와 업무용 PC 모두 같은 보내기·받기 기능을 사용합니다. 진단은 기능 지원 여부만 확인하며 실제 파일 전송이나 인쇄 성공을 보증하지 않습니다."
            : "Phones and work computers use the same transfer flow. This checks browser capabilities and the API, not whether an actual file transfer or print will succeed."}
        </p>
        <WorkstationReadiness
          copy={{
            checking: ko ? "기기 환경을 확인하고 있습니다" : "Checking this device",
            ready: ko ? "기본 전송 기능을 사용할 조건이 갖춰졌습니다" : "Basic requirements are available",
            limited: ko ? "일부 기능이 제한될 수 있습니다" : "Some features may be limited",
            blocked: ko ? "전송에 필요한 일부 기능을 사용할 수 없습니다" : "Required transfer capabilities are unavailable",
            secureContext: ko ? "HTTPS 연결" : "HTTPS connection",
            webCrypto: ko ? "브라우저 암호화" : "Browser encryption",
            fileApi: ko ? "파일 선택" : "File selection",
            downloadApi: ko ? "다운로드 지원" : "Download support",
            serviceReach: ko ? "전송 API 정상 응답" : "Transfer API responds successfully",
            sameOriginRoute: ko ? "동일 도메인 파일 중계 경로" : "Same-origin file relay available",
            pass: ko ? "확인" : "Available",
            pending: ko ? "확인 중" : "Checking",
            fail: ko ? "제한" : "Limited",
            blockedHint: ko
              ? "최신 Edge·Chrome 등 지원 브라우저와 보안 연결을 확인하세요."
              : "Check that your browser supports modern web standards and HTTPS.",
            limitedHint: ko
              ? "일부 저장 방식이나 중계 경로를 사용할 수 없습니다. 실제 테스트 파일로 확인하세요."
              : "Some save methods or relay paths may be unavailable. Test with a synthetic file.",
            unreachableHint: ko
              ? "서비스에 연결하지 못했습니다. 네트워크 정책을 확인하세요."
              : "The service cannot be reached. Check network restrictions.",
            serviceErrorHint: ko
              ? "서버가 오류 또는 요청 제한을 반환했습니다. 전송 가능 상태로 판정하지 않습니다."
              : "The server returned an error or rate limit. Transfers are not marked ready.",
            preferRelay: ko
              ? "허용된 Print-cess 주소로 파일 전송 우선 시도"
              : "Prefer transfer through the approved Print-cess origin",
            relaySelected: ko ? "이 탭에서 동일 도메인 경로 우선 사용" : "Same-origin transfer preferred in this tab",
            noGuarantee: ko
              ? "이 결과는 실제 업로드·다운로드 또는 프린터 테스트가 아닙니다. 기관 보안정책이 우선합니다."
              : "This is not an upload, download, or printer test. Organizational policy always applies.",
          }}
        />
      </details>
    </section>
  );
}
