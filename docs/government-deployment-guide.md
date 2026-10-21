# 기관 도입 가이드 (Government Deployment Guide)

이 문서는 print-cess를 관공서(출입국관서 포함)에 도입할 때 거쳐야 하는 절차를 정리합니다.
print-cess는 **무설치(설치 없이)** 방식으로 동작합니다. 기관의 PC나 방문자의 휴대전화에
프로그램을 설치하지 않으며, 브라우저의 표준 HTTPS와 Web Crypto만 사용합니다.

> Production 배포는 아래 6개 게이트가 모두 닫히기 전까지 금지됩니다. 각 게이트는
> 담당자, 날짜가 기재된 근거 자료, 정식 승인 결정을 요구하며, 리포지토리의 체크박스는
> 안내용일 뿐 승인 자체가 아닙니다. 상세 근거 규정은 `docs/READINESS_EVIDENCE.md`,
> 기관 승인 기록 양식은 `docs/INSTITUTIONAL_APPROVAL.md`를 따릅니다.

## 도입 전제

- **무설치 원칙**: 방문자(민원인)는 `/visitor` 화면의 QR 코드를 휴대전화 카메라로
  스캔하고 서류를 업로드합니다. 로그인·앱 설치·회원가입이 필요 없습니다.
- **자동 파기**: 업로드된 서류는 출력이 끝나거나 세션이 만료되면 서버에서 자동으로
  삭제됩니다. 전송 파일에는 만료 시간(기본 30분, `DROP_TTL_SECONDS`로 설정 가능)이
  부여되고, 만료 시 자동 삭제 스윕이 암호문 조각을 모두 제거합니다.
- **우회 금지**: 기관의 DLP, 다운로드 차단, 프록시, 망분리, 허용 도메인 정책이
  print-cess를 막으면 해당 정책이 우선합니다. print-cess는 기관 보안정책을
  우회하지 않습니다.

## 도입 체크리스트 (Production Gate 6건)

### Gate 1 — 기관 승인 (Institutional approval)

- 이슈: [#8](https://github.com/club-paradiso/print-cess/issues/8)
- 내용: 정보보안·개인정보(법무)·조달/공급자·Windows 단말·프린터/현장 운영·접근성 및
  언어·사고 대응·브랜드/서비스 귀속의 각 승인권자가 아키텍처, 위협 모델,
  인터넷/공급자 사용, 단말 강화, 사고 대응, 잔여 리스크를 승인합니다.
- 사고/롤백 드릴을 통과하고 연락망·복구 목표·교체 및 통지 결정을 문서화합니다.
- 근거: `docs/INSTITUTIONAL_APPROVAL.md`의 승인 기록표에 결정·범위·조건·유효기간·
  근거 링크·담당자를 기재합니다. 승인 이후의 변경은 영향을 받는 게이트를 다시 엽니다.

### Gate 2 — Authenticode 서명 (Windows kiosk artifact signing)

- 이슈: [#10](https://github.com/club-paradiso/print-cess/issues/10)
- 내용: 서명되지 않은 체크섬은 배포 가능한 Windows 산출물이 아닙니다. 인증서
  발급자·코드서명 EKU·게시자 주체·보관 모델·교체/폐기 담당자·타임스탬프 서비스를
  승인하고, HSM/관리형 서명을 우선합니다.
- 절차: 보호된 `windows-signing` 환경에서 필수 리뷰어와 태그 제한을 설정하고,
  `WINDOWS_SIGNING_CERT_BASE64`, `WINDOWS_SIGNING_CERT_PASSWORD`,
  `AUTHENTICODE_EXPECTED_SUBJECT`, `AUTHENTICODE_TIMESTAMP_URL`을 노출 없이 설정합니다.
- 검증: 사전 릴리스 태그 워크플로를 실행하고 `signtool verify /pa /all /v`로
  게시자·타임스탬프·체인·체크섬을 확인하며, 대상 Windows 이미지에서 다시 내려받아
  재검증하고 악성코드 검사를 수행합니다. 근거는 `docs/AUTHENTICODE.md`에 정리합니다.

### Gate 3 — 실물 프린터 검증 (Target Windows and physical-printer acceptance)

- 이슈: [#7](https://github.com/club-paradiso/print-cess/issues/7)
- 내용: CI의 녹색 빌드는 프린터가 동작한다는 근거가 아닙니다. 배포 전에 반드시
  실물 프린터 테스트가 필요합니다.
- 검증 항목: 정확한 프린터 모델/드라이버/펌웨어 수락, 용지·소모품, 물리적 배치와
  출력물 처리(출력물 방치 방지), 오류 책임 소재. Windows kiosk 이미지는
  `docs/WINDOWS_KIOSK_DEPLOYMENT.md` 절차를 따릅니다.
- 방문자 인쇄 모드(`/visitor`)는 카운터 화면에서 QR→업로드→출력→자동 파기의 흐름을
  실제 프린터로 종단간 검증합니다. mock 프린터는
  `PRINT_CESS_ENVIRONMENT=Development`와 루프백 서버에서만 허용되며, Production
  설치에서는 활성화할 수 없습니다.

### Gate 4 — 격리된 Preview 프로바이더 (Isolated Preview providers)

- 이슈: [#6](https://github.com/club-paradiso/print-cess/issues/6)
- 내용: Production과 분리된 Preview 전용 제공자 리소스(Vercel/Blob, Redis, QStash
  또는 Railway 스택)를 프로비저닝하고, 정확한 HTTPS 오리진과 필수 Blob·Redis·
  QStash·키오스크 등록·관리자 자격증명을 공급합니다. 호스티드 Preview/Production은
  값이 없으면 fail-closed로 시작합니다.
- 검증: 승인된 자격증명으로 제공자 수락 테스트를 수행합니다(수동
  `Preview provider acceptance` 워크플로). 자격증명 기반 테스트는 의도적으로
  분리되어 있으며, CI의 mock 테스트로 대체할 수 없습니다.
- 관련 문서: `docs/VERCEL_DEPLOYMENT.md`, `docs/RAILWAY_PROVIDERS.md`,
  `docs/READINESS_EVIDENCE.md`.

### Gate 5 — 접근성·8개 언어 리뷰 (Device, accessibility, and language review)

- 이슈: [#11](https://github.com/club-paradiso/print-cess/issues/11)
- 내용: 자동화된 axe/브라우저 검사와 기계 번역 문자열은 개발 근거일 뿐 수락 근거가
  아닙니다. 지원 iPhone Safari·Android Chrome 조합(셀룰러 경로 포함)과 정확한
  Windows kiosk 디스플레이/배율·스피커·키보드 정책·보조기술을 테스트합니다.
- 검사 항목: 키보드 전용 조작, VoiceOver/TalkBack/Windows 스크린리더, 200% 텍스트,
  400% 리플로, 고대비, 모션 감소, 음소거/음성 불가, 화면 방향, 포커스/오류 알림,
  WCAG 2.2 AA 명도 대비, 잘림 없는 64px 액션.
- 언어: 영어·한국어·중국어 간체·베트남어·몽골어·태국어·러시아어·네팔어를 자격 있는
  원어민 리뷰어가 문맥 속에서 승인합니다. `/visitor` 카운터 화면의 문구(파일 위치,
  문서 누락, 1회 출력 승인, 오류, 개인정보/삭제 안내, 비공식 서비스 고지, 음성
  안내 포함)도 동일하게 리뷰합니다. 근거는
  `docs/ACCESSIBILITY_LANGUAGE_ACCEPTANCE.md`에 정리합니다.

### Gate 6 — 코드/시크릿 보호 (GitHub native code and secret protection)

- 이슈: [#9](https://github.com/club-paradiso/print-cess/issues/9)
- 내용: GitHub 네이티브 코드 스캐닝/시크릿 스캐닝·푸시 보호를 활성화합니다.
  현재 보완 통제로는 보호된 `main`(strict PR, 대화 해결, 선형 히스토리, 관리자
  강제, Web/Windows/의존성/Gitleaks 검사, 강제 푸시·삭제 차단), `v*` 태그 생성
  제한, `.gitleaks.toml` 기반 검사가 동작 중입니다.
- 검증: 네이티브 보호 활성화 후에도 보완 통제를 유지하고, 시크릿이 리포지토리에
  커밋되지 않았음을 주기적으로 스캔합니다. 기관 도입 시 승인 기록에 포함합니다.

## 운영 설정 (관공서 권장값)

| 환경 변수                                | 권장값                | 의미                                                                             |
| ---------------------------------------- | --------------------- | -------------------------------------------------------------------------------- |
| `VISITOR_TTL_SECONDS`                    | `600` (기본값)        | `/visitor` 세션의 QR 유효 시간이자 업로드 파일 수명. 세션 만료 시 파일 자동 파기 |
| `DROP_TTL_SECONDS`                       | `1800` (기본값, 30분) | 휴대전화 간 전송 파일의 만료 시간. 만료 시 자동 삭제                             |
| `QR_TTL_SECONDS` / `SESSION_TTL_SECONDS` | `120` / `180`         | 일반 키오스크 QR/세션 수명                                                       |

방문자 대기열이 긴 창구에서는 `VISITOR_TTL_SECONDS`를 최대 1800(30분)까지 늘릴 수
있습니다. 30분을 초과하는 값은 설정 검증에서 거부됩니다.

## 도입 순서

1. Gate 4(격리된 Preview 프로바이더)를 먼저 닫고 제공자 수락 테스트를 수행합니다.
2. Gate 3(실물 프린터 검증)과 Gate 2(Authenticode 서명)를 목표 Windows 이미지에서
   진행합니다.
3. Gate 6(코드/시크릿 보호)과 Gate 5(접근성·8개 언어 리뷰)를 병행합니다.
4. 모든 근거를 `docs/PRODUCTION_BLOCKERS.md`에 대조하고 Gate 1(기관 승인)과
   사고/롤백 드릴을 거쳐 최종 go/no-go를 요청합니다.

출입국관서 민원 시나리오는 `docs/immigration-office-scenario.md`를 참고하세요.
