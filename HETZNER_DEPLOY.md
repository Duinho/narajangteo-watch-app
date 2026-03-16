# Hetzner 배포 가이드

이 프로젝트는 Hetzner Cloud 서버 1대에 Docker Compose로 올리는 기준이다.

필수 준비물:

- Hetzner Cloud 계정
- 접속할 도메인 1개
- 로컬 PC의 SSH 공개키

추천 구성:

- 서버: Ubuntu 24.04
- 플랜: CX22 이상
- 리전: Singapore
- 공개 포트: 80, 443, 22

서버 안에서 실행할 명령:

```bash
apt-get update
apt-get install -y ca-certificates curl git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

앱 배포:

```bash
cd /opt
git clone https://github.com/Duinho/narajangteo-watch-app.git
cd narajangteo-watch-app
cp .env.hetzner.example .env
cp Caddyfile.example Caddyfile
```

수정할 파일:

- `.env`
  - `APP_BASE_URL`
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `VAPID_SUBJECT`
  - `APP_ACCESS_CODE`
- `Caddyfile`
  - `your-domain.example.com`을 실제 도메인으로 변경

실행:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

업데이트:

```bash
cd /opt/narajangteo-watch-app
git pull
docker compose up -d --build
```
