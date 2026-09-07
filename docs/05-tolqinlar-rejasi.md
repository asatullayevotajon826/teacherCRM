# To'lqinlar rejasi — 6 bosqich × 5 to'lqin

> Bu reja chatda kelishilgan, lekin hech qayerda yozilmagan edi. Chat yo'qolsa
> reja ham yo'qolardi. Shu fayl uning rasmiy nusxasi.
>
> **Oxirgi yangilash:** PR #82 dan keyin. Holat ustunlari haqiqiy kodga qarab
> to'g'rilandi — avval bu fayl 0-to'lqin bajarilgan bo'lsa ham hamma narsani
> ⬜ deb ko'rsatib turardi.

## Asosiy qoida — tartib buzilmaydi

Har bir bosqich ichida to'lqinlar **qat'iy 0 → 1 → 2 → 3 → 4** tartibida
bajariladi:

| To'lqin | Mazmun |
| --- | --- |
| 0 | O'lchash va poydevor (test, CI, migratsiya, query log) |
| 1 | Xavfsizlik — "ochiq eshiklarni yopish" |
| 2 | Tezlik |
| 3 | Zamonaviy dizayn |
| 4 | Hujjatlar va yakun |

**Nima uchun dizayn oxirida:** agar tartib buzilsa, dizayn o'zgarishi paytida
baho hisoblash mantiqi buzilib, buni faqat o'qituvchi shikoyat qilganda bilib
olamiz. Testlar avval yozilsa — buzilish darhol ko'rinadi.

**Nima uchun tezlik xavfsizlikdan keyin:** tezlik uchun qilinadigan ishlar
(kesh, `Promise.all`, sahifalash) ma'lumot doirasini kengaytirib yuborishi
mumkin. Doira mustahkam bo'lmasa, keshga boshqa rolning ma'lumoti tushadi.

## Infratuzilma faqat bir marta qilinadi

0-to'lqindagi uch ish butun loyihaga tegishli, bitta bosqichga emas:

- migratsiya tizimi — bitta `prisma/migrations/` papkasi;
- CI — bitta `.github/workflows/ci.yml`;
- test poydevori — bitta `vitest.config.ts`.

Xuddi shunday 3-to'lqindagi **dizayn tizimi** ham bir marta qilinadi.

Shuning uchun bu ishlar **1-bosqich (Poydevor)** ichiga tushadi. Keyingi 2–6
bosqichlar o'z 0-1-2-3-4 aylanishini bosib o'tadi, lekin infratuzilmani qayta
qurmaydi.

---

## 1-bosqich · Poydevor

| To'lqin | Ish | Holat |
| --- | --- | --- |
| 0 | `prisma migrate` ga o'tish (`0_init`, bo'sh bazada sinovdan o'tgan) | ✅ |
| 0 | Vitest o'rnatish | ✅ |
| 0 | CI: typecheck → lint → test → migrate deploy → build | ✅ |
| 0 | Prisma query log (`src/lib/query-log.ts`) | ✅ |
| 0 | O'lchov natijalarini yozib olish (`docs/06`) | ✅ |
| 1 | `env.ts` — barcha muhit o'zgaruvchilari majburiy tekshirilishi | ✅ |
| 1 | Sirlar repoda yo'qligini tekshirish (secret scanning) | ❌ **imkonsiz** — GHAS yoqilmagan |
| 1 | `logger.ts` — logga parol/token/sir tushmasligi | ✅ #78 |
| 1 | `audit.ts` — meta ichidagi sirlar, massiv ichi | ✅ #78 |
| 1 | Xato sahifalari baza strukturasini oshkor qilmasligi | ✅ |
| 1 | `.gitignore` — `.env.*` va parol CSV'lari | ✅ #78 |
| 1 | `X-Powered-By` va HTTP sarlavhalari | ✅ #79 |
| 1 | `seed.ts` — masofaviy bazaga seed qilishdan qulflash | ✅ #81 |
| 2 | Baza ulanishi: connection pooling (PgBouncer) | ⬜ |
| 2 | Shrift yuklash, `next.config` optimallashtirish | ⬜ |
| 3 | Dizayn tizimi: rang palitrasi, tipografiya, radius, qorong'i rejim | ⬜ |
| 3 | shadcn komponentlarini to'ldirish: select, table, dialog, dropdown-menu, badge, tabs, toast, skeleton, tooltip, pagination, alert | ⬜ |
| 4 | `AGENTS.md` yangilash | ✅ #82 |
| 4 | `docs/07-xavfsizlik.md` — xavfsizlik qoidalari | ✅ #81 |
| 4 | `docs/01` va `docs/05` ni haqiqiy holga keltirish | 🔄 shu PR |
| 4 | `docs/02` ga dizayn qoidalari | ⬜ |

> **Secret scanning nima uchun ❌:** `run_secret_scanning` "Repository does not
> have GitHub Advanced Security enabled" xatosini beradi. Ombor **ochiq**
> bo'lgani uchun bu ikki barobar muhim. Yechim: omborni **private** qilish yoki
> **GHAS** ni yoqish. Buni faqat egasi qiladi.

### 1-bosqich · 0-to'lqin natijasi

- **80 test**, hammasi bazasiz sof funksiyalar ustida;
- CI har PR da 6 tekshiruv yuritadi;
- `db push` dan voz kechildi, migratsiya tarixi bor (`docs/04`);
- `force-dynamic` tuzatmasi bilan `next build` CI da toza o'tadi;
- **eng muhim o'lchov natijasi:** lokalda 5–10 soniya kutish sababi baza yoki
  indeks emas, **dev-rejimdagi 19–20 soniyalik kompilyatsiya** edi. Hech bir
  so'rov 100 ms dan oshmadi. "Indekslar 10–100× tezlashtiradi" farazi
  **o'lchov bilan rad etildi** — shu sabab 2-to'lqin tartibi qayta tuzildi
  (pastga qarang).

---

## 2-bosqich · Auth va rollar

| To'lqin | Ish | Holat |
| --- | --- | --- |
| 0 | Testlar: `scope.ts` (har rol × har funksiya), `rbac.ts`, `password.ts`, `auth-guard.ts` | ✅ |
| 1 | Login rate limit (brute force) — 5 va 20 / 15 daqiqa | ✅ |
| 1 | `mustChangePassword` chetlab o'tilmasligi | ✅ |
| 1 | Sessiyani bekor qilish (`passwordChangedAt`, 30 daq. qayta tekshirish) | ✅ |
| 1 | `LOGIN_FAILED` audit yozuvi + `maskIdentifier` | ✅ |
| 1 | Foydalanuvchi bor-yo'qligini oshkor qilmaslik (vaqt hujumi) | ✅ #69 |
| 1 | **Login sahifasidagi demo hisoblar prod'da yashirilishi** | ✅ #82 |
| 1 | Parol siyosati (uzunlik, murakkablik) | ⚠️ **bo'sh** — 8 belgi, `Parol123` o'tadi |
| 1 | Menyudagi 10 ta 404 sahifa yopilishi (`nav-config.ts` → `enabled: false`) | ⬜ |
| 2 | Har so'rovda sessiya tekshiruvi keshlanishi | ⬜ |
| 3 | Login sahifasi, "Parol o'zgartirish" ekrani, `/forbidden` | ⬜ |
| 4 | Ruxsat matritsasi hujjati: har sahifa/action → rol jadvali | ✅ `docs/07` §2 |

> **Parol siyosati nima uchun ⚠️ va nima uchun hozir tuzatilmadi:** siyosatni
> kuchaytirish (12 belgi + katta harf + belgi) **mavjud hisoblarga** ta'sir
> qiladi — kimdir eski, kuchsiz paroli bilan kira olmay qolishi mumkin. Bu
> mahsulot qarori, kod qarori emas. Egasi bilan kelishilishi kerak.

### Menyudagi mavjud bo'lmagan 10 sahifa

`/penalties`, `/penalty-criteria`, `/rewards`, `/reward-criteria`, `/payments`,
`/reports`, `/messages`, `/tests`, `/ai-assistant`, `/users`

Ikki muammo: foydalanuvchi tizimni buzuq deb o'ylaydi; va `rbac.ts` da bu yo'llar
uchun ruxsat allaqachon yozilgan — sahifa yaratilgan kunda rol tekshiruvi
noto'g'ri bo'lsa ham hech kim sezmaydi.

Yechim: `nav-config.ts` ga `enabled: false` bayrog'i. Menyuda ko'rinmaydi, lekin
`rbac.ts` dagi ruxsat saqlanadi.

> **Diqqat:** yangi sahifa qo'shilganda `rbac.ts` da **ikki joy** yangilanadi —
> `roleAllowedPaths` **va** `EXISTING_APP_PAGES`. Uchinchi joy: `nav-config.ts`.
> Aks holda `rbac.test.ts` yiqiladi.

---

## 3-bosqich · O'quvchi / o'qituvchi bazasi

| To'lqin | Ish | Holat |
| --- | --- | --- |
| 0 | Testlar: `students.ts`, `teachers.ts`, `imports.ts`, `excel.ts`, `import-guards.ts` | ⬜ |
| 1 | IDOR: `?studentId=<boshqa bola>` almashtirilsa | ✅ `scope.ts` + `assertCanAccess*` |
| 1 | Import: fayl o'lchami (5 MB), qator soni (1000), ustun soni (200) | ✅ |
| 1 | **Formula injection** — server tomon (`excel.ts`) | ✅ #66 |
| 1 | **Formula injection** — klient tomon (`import-wizard.tsx`) | ✅ **#80**, egasi qo'lda tekshirdi |
| 1 | Boshlang'ich parollar CSV — A reja qoidalari | ✅ `docs/07` §6 |
| 1 | Import idempotentligi (`skip` / `update`) | ✅ |
| 1 | `Student.userId` — audit 14-punkti, A variant | ⬜ **PR F** (migratsiya) |
| 1 | Eksport huquqi: buxgalter baholarni eksport qila oladimi (TZ da yo'q) | ⬜ savol |
| 1 | `previewStudentImport` / `previewTeacherImport` `createAction` chegarasini chetlab o'tadi | ⬜ |
| 2 | Sahifalash (hozir 500 o'quvchi to'liq yuklanadi) | ⬜ |
| 2 | Indekslar: `[lastName, firstName]`; `select` toraytirish | ⬜ |
| 3 | Ro'yxat ko'rinishi: qidiruv, filtr, saralash, bo'sh holat; mobil karta | ⬜ |
| 4 | Import/eksport hujjati | ✅ `docs/07` §5 |

> **#66 → #80 darsi (eng qimmat dars):** #66 da formula injection `excel.ts`
> ichida server tomonda yopildi va "yopildi" deb hisoblandi. Lekin
> `import-wizard.tsx` **klientda** CSV'ni o'zi yaratardi va u yerda hech qanday
> tozalash yo'q edi — teshik to'liq ochiq qoldi. Server tuzatmasi klientda
> takrorlanmasa, himoya **yo'q**. Endi bu `AGENTS.md` da 10-qoida.

---

## 4-bosqich · Sinf va dars jadvali

| To'lqin | Ish | Holat |
| --- | --- | --- |
| 0 | Testlar: `classes.ts`, `lessons.ts`, `academics.ts` — to'qnashuv mantiqi | ⬜ |
| 1 | Sxema nuqsonlari — audit 15-punkti (a–f) | ⬜ **PR F** |
| 1 | `academicYearId` bo'sh bo'lgan sinflar | ⬜ |
| 1 | Jadval to'qnashuvi server tomonda tekshirilishi | ✅ `@@unique` + `lessons.ts` |
| 1 | `assignStudentsAction` o'quvchini boshqa sinfdan jimgina ko'chirib yuboradi | ⬜ |
| 2 | Indekslarni `EXPLAIN ANALYZE` bilan tasdiqlash | ⬜ |
| 2 | `schedule/page.tsx` TEACHER uchun ham butun o'qituvchi ro'yxatini yuklaydi | ⬜ |
| 2 | Jadval sahifasidagi so'rovlarni `Promise.all` | ⬜ |
| 3 | Dars jadvali ko'rinishi — hafta grid, drag & drop, mobil moslashuv | ⬜ |

---

## 5-bosqich · Davomat

| To'lqin | Ish | Holat |
| --- | --- | --- |
| 0 | Testlar: `attendance.ts`, `attendance-grid.ts` | ⬜ |
| 1 | Davomat yozish doirasi (`attendanceScope`) har rol uchun to'g'rimi | ✅ |
| 1 | O'tgan sanaga davomat qo'yish cheklovi bormi | ⬜ savol |
| 1 | `absence-notice.ts` — SMS navbati xavfsizmi (5/kun, 200/chaqiruv) | ✅ |
| 1 | `absence-notice.ts` dedupe aynan xabar matniga bog'liq — mo'rt | ⬜ |
| 2 | Indekslar: `[studentId, date]`, `[lessonId, date]` | ✅ sxemada bor |
| 2 | `attendance/actions.ts` har yozuv uchun alohida `upsert` qiladi | ⬜ |
| 2 | Haftalik jurnal so'rovlarini `Promise.all` | ⬜ |
| 3 | Jurnal ekrani — klaviatura bilan tez kiritish (Tab / Enter / o'q) | ⬜ |
| 3 | K/SZ/SL/KCH qisqartmalari uchun ko'rinadigan izoh | ⬜ |
| 3 | `/students/[id]` da davomat foizi va qoldirgan darslar soni | ⬜ |
| 3 | Davomat `.xlsx` eksporti (TZ 3.14.6) | ⬜ |
| 4 | Qisqartmalar hujjati (TZ da yo'q) | ⬜ |

---

## 6-bosqich · Baholar va reyting

| To'lqin | Ish | Holat |
| --- | --- | --- |
| 0 | Testlar: `ranking.ts` (`finalScore`, `rankByScore`), `grades.ts`, `journal.ts` | ⬜ |
| 1 | Eski baholarni backfill (`lessonId: null`) + kuchliroq unique | ⬜ **PR F** |
| 1 | `grades.ts` dagi o'lik kod va noto'g'ri izoh | ⬜ |
| 1 | Takrorlangan funksiyalar: `averageOf`, `parseTopN`, rank mantiqi | ⬜ **PR F** |
| 1 | `ranking/page.tsx` — 3 ta `TS2322` typecheck xatosi (lucide `title`) | ⬜ tekshirilmoqda |
| 2 | `/ranking` — `yearGrades` butun yilni xotiraga tortadi → `groupBy` | ⬜ |
| 2 | ~12 ketma-ket so'rov → `Promise.all`; diagrammalarni `dynamic import` | ⬜ |
| 3 | Baholar jadvali, reyting jadvali, diagrammalar; 1-2-3 o'rin belgilari | ⬜ |
| 4 | TZ §7 (ERD) ga `RankingSetting` qo'shish | ⬜ savol |

> **`TS2322` haqida:** `title={label}` lucide ikonkasiga **ataylab** qo'yilgan —
> u ekran o'qiydigan dastur uchun izoh beradi. Tuzatishda `title` ni shunchaki
> o'chirib tashlash **regressiya** bo'ladi; ikonkani `<span title=...>` ichiga
> o'rash kerak.

---

## 2-to'lqin (tezlik) — o'lchovdan keyin qayta tuzilgan tartib

Bu tartib **faraz emas, `docs/06-olchov-natijalari.md` dagi raqamlarga
asoslangan**. Eng katta yutuqdan eng kichigiga:

| № | Ish | Nima uchun shu tartibda |
| --- | --- | --- |
| 1 | **Prefetch toshqini** | `/schedule` da 83 so'rov / 344 kB. Har bir "+" tugmasi prefetch qiladi (171–631 ms) |
| 2 | **Prisma connection pooling** | Ulanish kutishi so'rovning o'zidan uzoq |
| 3 | **`loading.tsx`** | Sahifa ochilishi sezilishi — 1.44 s Load vaqti |
| 4 | **307 zanjiri** `/` → `/uz` → `/uz/dashboard` = 395 ms | `pages.signIn: "/login"` ham shu zanjirga qo'shimcha sakrash qo'shadi |
| 5 | `/ranking` da `Promise.all` | ~12 ketma-ket so'rov |
| 6 | Sahifalash | 500 qator |
| 7 | Indekslar / `groupBy` | **oxirida** — o'lchov hech bir so'rov 100 ms dan oshmasligini ko'rsatdi |

> `pages.signIn: "/login"` **xavfsizlik nuqsoni emas**. `auth.config.ts` o'qib
> tekshirildi: u ochiq yo'naltirish (open redirect) bermaydi, faqat `/uz/login`
> ga qo'shimcha 307 sakrash qiladi. Shu sabab xavfsizlik ro'yxatidan olib
> tashlanib, tezlik/UX bandiga o'tkazildi (`docs/07` §11).

---

## Umumiy

| Bosqich | PR |
| --- | --- |
| 1 · Poydevor | ~7 |
| 2 · Auth | ~6 |
| 3 · Baza + import | ~7 |
| 4 · Sinf + jadval | ~5 |
| 5 · Davomat | ~6 |
| 6 · Baholar | ~6 |
| **Jami** | **~37 PR, ~120 test** |

Hozirgi haqiqiy holat: **80 test**, 1-to'lqin PR A–E yopilgan, **PR F qoldi**.

---

## Ish uslubi — kelishilgan

- Agent to'g'ridan-to'g'ri commit va PR qiladi, ruxsat so'rab to'xtamaydi.
- Egasi faqat **merge** qiladi.
- Har PR: o'zbekcha izoh + test rejasi + xavfsizlik bo'limi.
- Har nuqson "**nima edi / nega xavfli / nima qildim**" ko'rinishida tushuntiriladi.
- Fayl push qilishdan oldin u **albatta o'qiladi** — xotiradan yozib to'liq
  faylni ustiga yozish taqiqlanadi.
- **PR tavsifiga tuzatish yozilishi faqat push natijasi tasdiqlangandan keyin**
  (#79 da tavsif haqiqatdan oshib ketgan edi).

**Uch holatda agent to'xtab ogohlantiradi** (ma'lumot yo'qolishi mumkin):

| Holat | Nima uchun |
| --- | --- |
| Sxema o'zgarishi / migratsiya | Baza ma'lumotiga ta'sir qiladi. Avval zaxira |
| Ma'lumot ko'chirish (backfill) | Qaytarib bo'lmaydi |
| `package.json` ga yangi paket | Egasi `npm install` qilishi kerak |

---

## Egasidan qaror kutilayotgan masalalar

| № | Masala | Holat |
| --- | --- | --- |
| 1 | Reyting formulasi. TZ: `baho − jarima + test`. Kod: `(baho×80 + test×20)/100 − ball×0.5` | ⬜ ochiq |
| 2 | Baho shkalasi: 0–100 yoki 5 balli | ✅ **yopildi — 0–100** |
| 3 | `RankingSetting` TZ ning ERD bo'limida yo'q — qo'shamizmi? | ⬜ ochiq |
| 4 | `parallel` qamrovi kodda bor, TZ da ta'riflanmagan | ⬜ ochiq |
| 5 | Rag'bat ball (`/rewards`) menyuda bor, TZ da yo'q. Kerakmi? | ⬜ ochiq |
| 6 | Davomat qisqartmalari `K` / `SZ` / `SL` / `KCH` — TZ da yo'q | ⬜ ochiq |
| 7 | **Parol siyosatini kuchaytirish** — mavjud hisoblarga ta'sir qiladi | ⬜ ochiq |
| 8 | **Omborni private qilish yoki GHAS yoqish** — secret scanning uchun | ⬜ ochiq |
| 9 | **Import parollari C variant** (bir martalik havola) — yangi jadval + migratsiya | ⬜ 3-to'lqin |
