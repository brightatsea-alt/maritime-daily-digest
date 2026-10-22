# FormFill — 문서 → 서식 자동 기입 플랫폼

왼쪽에 출처 자료(Word/Excel/HWP/HWPX/PDF/PPT/메일/텍스트/이미지)를 넣고, 오른쪽에 채울 서식을 올리면
Claude가 자료에서 값을 찾아 서식에 기입하고, **원본과 동일한 형식(확장자·서식·레이아웃)** 으로 내려받습니다.
작업 줄 5개가 독립적으로 동작하며, 자료는 페이지를 새로 고치기 전까지 누적 보관되어 "추가 자료 반영"이 가능합니다.

## 구조
```
public/            정적 사이트 (Cloudflare Pages 빌드 출력 = public)
  index.html / styles.css
  js/engine.js     파일 파서·서식 기입 엔진 (브라우저에서 실행, 파일은 서버로 가지 않음)
  js/app.js        UI (5 Row)
  vendor/          jszip · cfb · pako · pdf-lib · pdf.js
functions/api/fill.js   Cloudflare Pages Function — Claude API 프록시 (키는 서버에만)
```

## 지원 형식
| 서식(오른쪽) | 방식 |
|---|---|
| .docx .dotx | 문단 단위 — 첫 run 서식 유지, 표/머리글/바닥글 포함 |
| .xlsx .xlsm | 셀 단위 — 수식 셀 보호, 병합은 좌상단만, 서식(s) 유지 |
| .pptx | 문단 단위 (도형·표) |
| .hwpx | 문단 단위 (hp:t) — 가장 안전한 한글 형식 |
| .hwp (5.0) | BodyText 레코드 직접 편집 — PARA_TEXT/CHAR_SHAPE/LINE_SEG 재작성. 암호·배포용 문서 불가 |
| .pdf | AcroForm 입력 필드가 있는 PDF만 |
| .txt .md .csv 등 | 전체 텍스트 |

자료(왼쪽): 위 형식 전부 + .eml/.msg 메일, .html, 이미지(png/jpg — Claude가 직접 읽음).

## 배포 (GitHub private + Cloudflare Pages)
1. 이 폴더를 private 저장소로 푸시 (예: `wsmk-formfill`).
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → 저장소 선택.
   - Framework preset: **None**
   - Build command: (비움)
   - Build output directory: **public**
3. Settings → Environment variables (Production):
   - `CLAUDE_API_KEY` = sk-ant-… (Encrypt)
   - `CLAUDE_MODEL` = (선택) 기본 `claude-sonnet-5-5`
   - `APP_PASSWORD` = (선택) 접속 비밀번호. 설정하면 첫 접속 때 비밀번호를 묻습니다.
4. Deploy. 이후 `git push` 마다 자동 배포.

## 로컬 미리보기
```
npx wrangler pages dev public --compatibility-date=2024-11-01 --binding CLAUDE_API_KEY=sk-ant-...
```

## 주의
- 업로드 파일은 브라우저 메모리에만 있으며 새로 고침 시 삭제됩니다. 자료의 **텍스트**와 이미지만 Claude API로 전송됩니다.
- HWP(5.0 바이너리)는 문단 안의 글자모양을 첫 글자모양으로 통일하고 줄 배치는 한글이 열 때 다시 계산합니다. 중요한 서식은 HWPX로 저장해 사용하면 가장 안전합니다.
- `.doc/.xls/.ppt` 구형 바이너리는 미지원 → x 형식으로 저장 후 사용.
