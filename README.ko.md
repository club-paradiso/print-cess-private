<p align="center">
  <img src="docs/assets/print-cess-mark.svg" alt="Print-cess 마크" width="96" />
</p>

<h1 align="center">Print-cess</h1>

<p align="center"><strong>by Club Paradiso</strong></p>

<p align="center">
  가입도 앱 설치도 없이, 휴대전화로 문서를 출력하고 다른 휴대전화에 파일을 건넵니다.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="LICENSE">Apache-2.0</a> ·
  <a href="SECURITY.md">보안 정책</a>
</p>

---

Print-cess는 손에 휴대전화밖에 없는데 서류 한 장을 뽑아야 하는 곳을 위해 만들었습니다. 관공서
민원 창구나 출입국 사무소 같은 곳입니다. 방문자는 프린터 옆 화면의 QR 코드를 찍고 파일을 고르면
한 부를 받습니다. 가입하거나 앱을 깔 필요가 없고, 직원에게 휴대전화를 건넬 일도 없습니다. 출력이
끝나면 파일은 지워집니다.

할 수 있는 일은 세 가지입니다.

|            | 하는 일                                                        | 시작하는 곳                        |
| ---------- | -------------------------------------------------------------- | ---------------------------------- |
| **출력**   | 휴대전화 속 파일을 종이 한 부로 뽑습니다.                      | 키오스크 화면의 QR 코드 (`/kiosk`) |
| **보내기** | 파일을 다른 휴대전화로 보냅니다. 처음부터 끝까지 암호화됩니다. | `/send`, `/receive`                |
| **스캔**   | 종이를 찍어 PDF로 만들고, 바로 보내거나 출력합니다.            | `/scan`                            |

창구용 화면도 있습니다. `/visitor`는 QR 코드, 출력 진행 상황, 남은 시간을 보여 줍니다.
`/workstation`은 보안 정책이 걸린 업무용 PC에서 일반 브라우저만으로 쓸 수 있는 입구입니다.
프로그램을 설치하지 않고, 보안 통제를 피해 가지도 않습니다.

## 문서를 지키는 방법

- **휴대전화에서 암호화합니다.** 파일은 기기를 떠나기 전에 암호화됩니다(P-256 ECDH, HKDF,
  AES-256-GCM). 서버와 저장소에는 암호문만 남고, 서버는 복호화 키를 만들어 낼 수 없습니다.
- **키는 서버로 가지 않습니다.** QR 코드와 링크는 비밀값을 URL의 `#` 뒤에 담습니다. 브라우저는
  이 부분을 서버로 보내지 않습니다.
- **한 문서, 한 부, 그리고 삭제.** 출력 세션 하나는 업로드 한 번, 출력 한 번만 받습니다. 성공,
  실패, 취소, 만료, 재시작 중 어떻게 끝나든 파일은 지워집니다. 휴대전화끼리 보낸 파일은 기본
  30분 뒤에 사라집니다.
- **계정도 추적도 없습니다.** 로그인이 없고 분석 도구도 넣지 않았습니다. 파일 이름은 서버에
  전달되지 않습니다.
- **보안 정책을 우회하지 않습니다.** 업무용 PC에서는 평범한 HTTPS와 Web Crypto만 씁니다. DLP,
  다운로드 차단, 프록시, 망분리를 피해 가려고 하지 않습니다.

예외가 하나 있습니다. 선택 기능인 "숫자 네 자리 + 도형" 전달은 보내는 사람이 먼저 자리를 뜰 수
있도록 서버가 3분 동안 열쇠를 맡아 둡니다. QR 코드와 링크로 보낼 때는 이렇게 하지 않습니다.
무엇을 맞바꾸는지와 어디까지 막아 두었는지는
[`docs/FILE_TRANSFER.md`](docs/FILE_TRANSFER.md)에 있습니다.

자세한 설계는 [`docs/SECURITY.md`](docs/SECURITY.md),
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md), [`docs/CRYPTOGRAPHY.md`](docs/CRYPTOGRAPHY.md)에서
볼 수 있습니다. 문서는 영어로 쓰여 있습니다.

## 현재 상태

개발 환경과 Preview 배포에서는 처음부터 끝까지 동작합니다. 하지만 **실제 개인 문서를 다루는
운영 환경에 쓰도록 승인받은 상태는 아닙니다.** 기관의 정보보안·개인정보 검토, 외부 서비스 승인,
실제 프린터 검증, 서명된 설치 파일 같은 남은 관문은
[`docs/PRODUCTION_BLOCKERS.md`](docs/PRODUCTION_BLOCKERS.md)에 정리되어 있습니다.

개발, Preview, 테스트 데이터, CI 어디에서도 실제 개인 문서를 쓰지 마세요.

## 시작하기

Node.js 24.18.0과 pnpm 11.15.1(Corepack으로 설치)이 필요합니다. Windows 키오스크를 빌드하려면
.NET 8 SDK가, 브라우저 테스트를 돌리려면 Playwright 브라우저가 더 필요합니다.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example apps/web/.env.local
pnpm dev
```

그다음 아래 주소를 열어 보세요.

- <http://localhost:3000/kiosk>: 프린터 옆 화면입니다. 같은 네트워크의 휴대전화로 QR 코드를 찍거나,
  화면에 나온 링크를 다른 브라우저 탭에서 열면 됩니다.
- <http://localhost:3000/send>와 <http://localhost:3000/receive>: 두 탭 사이에서 파일을 주고받습니다.
- <http://localhost:3000/workstation>: 업무용 PC 입구와 브라우저 점검 화면입니다.

로컬 모드에서는 모든 것이 내 컴퓨터 안에 머물고, 앱 안의 개발용 폴더에 암호문만 저장됩니다.
실제 배포는 HTTPS 주소와 외부 서비스 인증 정보를 정확히 설정하기 전에는 아예 시작되지 않습니다.
[`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md)를 참고하세요.

## 저장소 구성

```text
apps/web             Next.js 앱: 키오스크 화면, 휴대전화 화면, 파일 전달, API
apps/kiosk           Windows용 .NET 8 WPF 키오스크: 복호화, 파일 검사, 출력
apps/cleanup-worker  QStash를 쓰지 않을 때 만료된 파일을 지우는 워커
packages/            프로토콜, 암호화, 번역(13개 언어), UI, 테스트 데이터
docs/                구조, 보안, 개인정보, 배포, 운영 문서
```

## 검사

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Windows 키오스크는 GitHub Actions에서 빌드하고 테스트합니다. 빌드가 통과했다고 프린터가 제대로
동작한다는 뜻은 아닙니다. 실제로 배치하기 전에
[`docs/WINDOWS_PRINTER_ACCEPTANCE.md`](docs/WINDOWS_PRINTER_ACCEPTANCE.md)의 실물 프린터
검사를 꼭 해 주세요.

## 배포

| 대상                         | 안내 문서                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Vercel에 웹 앱 배포          | [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md)                     |
| Railway의 저장소와 정리 작업 | [`docs/RAILWAY_PROVIDERS.md`](docs/RAILWAY_PROVIDERS.md)                     |
| Mac 브라우저 키오스크        | [`docs/MACOS_BROWSER_KIOSK.md`](docs/MACOS_BROWSER_KIOSK.md)                 |
| Windows 키오스크             | [`docs/WINDOWS_KIOSK_DEPLOYMENT.md`](docs/WINDOWS_KIOSK_DEPLOYMENT.md)       |
| 관공서 도입                  | [`docs/government-deployment-guide.md`](docs/government-deployment-guide.md) |
| 일상 운영                    | [`docs/OPERATIONS_RUNBOOK.md`](docs/OPERATIONS_RUNBOOK.md)                   |

## 기여하기

버그 제보와 풀 리퀘스트를 환영합니다. 작은 수정이 아니라면 먼저 이슈를 열어 방향을 같이 정해
주세요. 풀 리퀘스트는 `main`으로 보내 주시고, 위 검사를 통과해야 하며, 지어낸 데이터만 써야
합니다. 리뷰와 배포 절차는 [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md)에 있습니다.

보안 문제는 공개 이슈 말고 [`SECURITY.md`](SECURITY.md)에 적힌 방법으로 따로 알려 주세요.

## 라이선스

Print-cess는 [Apache License 2.0](LICENSE)으로 배포합니다. 외부 구성 요소의 고지는
[`NOTICE`](NOTICE)에 있습니다.

라이선스는 코드에만 적용되고 이름에는 적용되지 않습니다. 고친 버전을 공식 서비스인 것처럼 보이게
하는 데 "Print-cess", "Club Paradiso"라는 이름과 로고를 쓸 수 없습니다.
