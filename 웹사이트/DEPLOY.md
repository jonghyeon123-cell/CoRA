# 공개 링크 배포 방법

`http://127.0.0.1:3000`은 내 컴퓨터에서만 열리는 로컬 주소입니다. 다른 사람 컴퓨터에서도 열리게 하려면 Render, AWS 같은 외부 서버에 배포해야 합니다.

## 추천: Render

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Render에서 `New` > `Web Service`를 선택합니다.
3. GitHub 저장소를 연결합니다.
4. 설정은 `render.yaml`이 자동으로 잡아줍니다.
5. 배포가 끝나면 `https://campus-mate.onrender.com` 같은 공개 링크가 생깁니다.

이 링크를 복사하면 다른 사람 컴퓨터에서도 열 수 있습니다.

## Docker로 실행

```bash
docker build -t campus-mate .
docker run -p 3000:3000 campus-mate
```

로컬 Docker 실행 주소는 `http://localhost:3000`입니다. 공개 링크가 필요하면 이 이미지를 AWS App Runner, ECS, Render 같은 서비스에 올려야 합니다.

## 대회용 체크

- 제출 링크: Render 공개 URL
- 발표장 백업: 로컬 `node backend/server.js`
- 기술 어필: Dockerfile 포함
