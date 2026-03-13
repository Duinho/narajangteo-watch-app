# 나라장터 감시 앱

입찰공고번호를 등록하면 서버가 나라장터 개찰결과를 주기적으로 확인하고, 결과가 공개되면 `설치형 PWA 앱`으로 푸시를 보내는 프로젝트입니다.

지금 구조는 아래와 같습니다.

- 서버: Node.js + Playwright
- 앱: 설치형 PWA
- 푸시: Web Push 내장
- 배포: Docker 기준

`ntfy` 같은 별도 앱 의존 없이, 이 앱 자체가 푸시를 받습니다.

## 1. 로컬 실행

```powershell
npm install
npx playwright install chromium
npm run app
```

실행 후:

- PC 브라우저: `http://127.0.0.1:3838`
- 같은 와이파이 폰: `http://현재PC사설IP:3838`

폰에서 접속한 뒤:

1. `앱 설치`
2. `푸시 연결`
3. 개인 워크스페이스 코드 확인
4. 공고번호 등록

이후 결과가 공개되면 앱 푸시가 옵니다.

## 개인 워크스페이스

이 앱은 계정 대신 `개인 워크스페이스 코드`로 사용자 데이터를 분리합니다.

- 같은 코드를 PC와 휴대폰에 넣으면 같은 감시 목록이 동기화됩니다.
- 다른 코드를 쓰는 사람과는 감시 목록과 푸시 대상이 분리됩니다.
- 처음 접속하면 브라우저에 개인 코드가 자동 생성됩니다.
- 다른 기기에서도 같은 목록을 쓰고 싶으면 그 코드를 그대로 입력하면 됩니다.

## 2. 클라우드 배포

클라우드에서는 `APP_BASE_URL`을 반드시 실제 공개 주소로 맞춰야 합니다.

### VAPID 키 만들기

```powershell
npm run generate:vapid
```

출력되는 값을 환경변수로 넣습니다.

### 필요한 환경변수

- `PORT`
- `APP_BASE_URL`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `APP_ACCESS_CODE` 선택 사항

예시:

```text
APP_BASE_URL=https://your-app.example.com
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
APP_ACCESS_CODE=원하면_여기에_보안코드
```

`APP_ACCESS_CODE`를 넣으면 앱이 공개 인터넷에 떠도 보안코드를 입력해야 감시 목록과 결과를 볼 수 있습니다.

## 3. Docker 배포

```powershell
docker build -t narajangteo-watch .
docker run ^
  -p 3838:3838 ^
  -e APP_BASE_URL=https://your-app.example.com ^
  -e VAPID_PUBLIC_KEY=... ^
  -e VAPID_PRIVATE_KEY=... ^
  -e VAPID_SUBJECT=mailto:you@example.com ^
  -e APP_ACCESS_CODE=원하면_여기에_보안코드 ^
  narajangteo-watch
```

배포 플랫폼은 Render, Railway 같은 Docker 지원 서비스면 됩니다.

## 4. 앱 설치 방식

이 프로젝트는 현재 `APK`가 아니라 `설치형 PWA`입니다.

장점:

- 바로 설치 가능
- Android에서 앱처럼 실행 가능
- 푸시 지원
- 브라우저 주소창 없이 독립 앱처럼 열림

폰에서 설치 방법:

1. 배포된 URL 접속
2. `앱 설치` 버튼 또는 브라우저의 `홈 화면에 추가`
3. `푸시 연결`

## 5. 주요 파일

- 서버: `app-server.js`
- 나라장터 수집기: `narajangteo-result-check.js`
- 대시보드: `public/index.html`
- 대시보드 로직: `public/app.js`
- 상세 화면: `public/result.html`
- 상세 로직: `public/result.js`
- 공통 유틸: `public/common.js`
- 서비스 워커: `public/sw.js`
- 매니페스트: `public/manifest.webmanifest`
- Docker 배포: `Dockerfile`

## 6. 데이터 저장 위치

- 감시 목록/구독 상태: `app-data/dashboard-state.json`
- Web Push 키 로컬 저장본: `app-data/webpush-vapid.json`
- 조회 결과 JSON/TXT: `output/results/`

## 7. 현재 한계

- 실제 `APK` 빌드는 이 PC에 Android SDK가 없어서 아직 못 했습니다.
- 지금은 설치형 웹앱이므로, 추후 Android 래핑이 필요하면 Capacitor 쪽으로 이어가면 됩니다.
- 클라우드에 올리려면 배포 계정과 공개 도메인은 직접 준비해야 합니다.
