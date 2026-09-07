# Loyiha holati

> **Oxirgi yangilash:** PR #82 merge qilingandan keyin (1-to'lqin · PR E 4-qism).
>
> Bu fayl uzoq vaqt eskirgan holda turdi. Unda "66 test", "#39 gacha merge
> qilingan" va **"hozircha `npx prisma db push` ishlatiladi"** deb yozilgan edi —
> uchalasi ham noto'g'ri. Oxirgisi ayniqsa xavfli: kim `db push` qilsa
> migratsiya tarixi buziladi. Shuning uchun bundan keyin qoida: **har PR
> merge'idan keyin shu fayl yangilanadi**, aks holda hujjat kodga qarshi
> ishlaydi.

## 1. Shoxlar

| Shox | Vazifasi |
| --- | --- |
| `main` | Ishga tushirish uchun. **Orqada** — PR #1 hali merge qilinmagan |
| `claude/crm-foundation-auth-3bcbb961056f80d9b49700a9e920f098` | **Ishchi (integratsiya) shoxi** — hamma ish shu yerda to'planadi |
| `claude/<vazifa-nomi>` | Har bir vazifa uchun vaqtinchalik shox → PR |

Yangi ish boshlaganda: `create_branch(from_branch = ishchi shox)`.
Hech qachon `main` ga PR qilinmaydi.

> ### QAT'IY QOIDA — uch marta buzilgan, uch marta kod yo'qolgan
>
> Mavjud PR shoxiga **qo'shimcha commit** push qilishdan oldin **albatta** PR
> holatini o'qing (`pull_request_read` → `merged`).
>
> Agar PR allaqachon merge qilingan bo'lsa, o'sha shoxga qilingan yangi commit
> integratsiya shoxiga **tushmaydi** va **jimgina yo'qoladi** — na CI, na
> typecheck, na test buni sezmaydi.
>
> Shu xato **uch marta** sodir bo'ldi:
>
> | PR | Yo'qolgan commit | Nima yo'qolgan |
> | --- | --- | --- |
> | #78 | `601d228e` | import-wizard tuzatmasi (keyin #80 bilan qaytarildi) |
> | #79 | — (tavsif yolg'on edi) | PR tavsifi 3 tuzatma deb yozgan, aslida 2 ta |
> | #81 | `14f8a5d3`, `ca6a15e2` | login demo-hisob teshigi + hujjat havolalari (keyin #82 bilan qaytarildi) |
>
> **Merge qilingan bo'lsa — yangi shox + yangi PR. Boshqa yo'l yo'q.**

## 2. Bosqichlar holati

**Bajarilgan: 6 / 15.**

Hozir yangi bosqich boshlanmaydi. 7-bosqichga o'tishdan oldin **1-to'lqin
(xavfsizlik)** yopilmoqda — tafsiloti `docs/05-tolqinlar-rejasi.md` da,
xavfsizlik qarorlari `docs/07-xavfsizlik.md` da.

### 1–2-bosqich: poydevor + auth/RBAC ✅

- Next.js 14 App Router, Tailwind, shadcn/ui, Prisma + PostgreSQL, next-intl.
- Auth.js v5 (JWT, `maxAge` 8 soat, `updateAge` 1 soat, har 30 daqiqada bazadan
  qayta tekshirish, `passwordChangedAt` bilan sessiyani bekor qilish).
- Login email **yoki** telefon bilan; vaqt hujumiga qarshi soxta bcrypt hash.
- 4 rol, `roleAllowedPaths` bilan sahifa darajasidagi RBAC (`src/lib/rbac.ts`).
- `src/lib/scope.ts` — ma'lumot darajasidagi doira (IDOR himoyasi), fail-closed:
  "topilmadi" == "ruxsat yo'q".
- Audit jurnali, xavfsizlik sarlavhalari (CSP + HSTS), rate limiter, `env.ts`
  validatsiyasi, parol siyosati, xato sahifalari, logger, birinchi kirishda
  parol almashtirish.

### 3-bosqich: o'quvchi va o'qituvchi bazasi ✅

- O'quvchi va o'qituvchi CRUD, filtrlar, qidiruv.
- **Excel import** (`src/lib/imports.ts`, `excel.ts`, `import-guards.ts`):
  shablon → yuklash → preview → dublikat siyosati (`skip`/`update`) → tasdiqlash.
- Umumiy UI: `src/components/import-wizard.tsx`.
- Shablon API: `GET /api/import-template/{students|teachers|classes}`.
- O'qituvchi hisobi `mustChangePassword = true` bilan yaratiladi, boshlang'ich
  parol bir martalik `.csv` bo'lib beriladi (A reja — `docs/07` §6).

### 4-bosqich: sinflar va dars jadvali ✅

- `AcademicYear` + `Quarter`, `Subject`, `LessonPeriod` (qo'ng'iroq jadvali).
- Sinflar CRUD; yangi sinf yaratishda joriy o'quv yili avtomatik tanlanadi.
- Haftalik dars jadvali `/schedule`: sinf/o'qituvchi filtri.
- Har bir bo'sh uyada **"+"** tugmasi — forma o'sha kun va dars vaqti bilan
  to'ldirilib ochiladi.
- Ziddiyat tekshiruvi: o'qituvchi/sinf bir vaqtda band bo'lmasligi
  (`src/lib/lessons.ts` + bazada `@@unique`).
- **Sinflarni Excel'dan import** (`src/lib/class-imports.ts`, `/classes/import`).

### 5-bosqich: davomat ✅

- **`/attendance`** — tezkor kiritish: sana → dars → butun sinf bitta ekranda,
  har o'quvchida 4 tugma, "Hammasini keldi deb belgilash", bitta `Saqlash`.
- **`/attendance/journal`** — haftalik matritsa, foiz va qoldirgan darslar,
  eng ko'p qoldirganlar (top-5).
- Barcha sana hisobi **UTC** da (`@db.Date` bilan mos kelishi uchun).
- Saqlash **idempotent**: `@@unique([studentId, lessonId, date])` + `upsert`,
  bitta `$transaction` ichida.
- Foiz kelishuvi: `(Keldi + Kechikdi) / jami`. Belgi bo'lmasa `0%` emas, `—`.
- `lessonScope`: sinf rahbari o'zi o'qitmaydigan fanga ham **davomat** qo'yadi.
- Sababsiz kelmagan o'quvchi uchun `Message` jadvaliga `QUEUED` SMS yoziladi.
- Tarjimalar alohida fayl: `messages/attendance/{uz,ru,en}.json` — **namuna shu**.

### 6-bosqich: baholar, jurnal va reyting ✅

| Sahifa | Vazifasi | Yozish |
| --- | --- | --- |
| **`/journal`** | Kunlik jurnal: bir kun, sinfning hamma darsi ustun bo'lib chiqadi | ✅ **Baho va davomat SHU YERDA kiritiladi** |
| **`/grades`** | O'zlashtirish hisoboti | ❌ Faqat o'qish |
| **`/ranking`** | Choraklik reyting, diagrammalar | ❌ Faqat o'qish |

- **Baho yozishning yagona yo'li — `/journal`.** `/grades` da forma ham, Server
  Action ham ATAYLAB yo'q: mavjud bo'lmagan endpoint'ga hujum qilinmaydi.
- **Baho shkalasi: 0–100** (`GRADE_MIN` / `GRADE_MAX`). Ochiq savol **yopildi**.
- **Baho turi** (`DAILY` / `CONTROL` / `EXAM`) jurnalda tanlanadi.
- **Baho darsga bog'lanadi** (`Grade.lessonId`), fanga emas. Eski, `lessonId` si
  bo'sh baholar fan bo'yicha eng chapdagi bo'sh ustunga joylanadi.
- Baho kiritilsa davomat bo'sh bo'lsa avtomatik "K" qo'yiladi. Boshqa
  o'qituvchining darsidagi belgi faqat **placeholder**, formaga tushmaydi.
- **Reyting formulasi sozlanadigan**, sozlama bazada (`RankingSetting`,
  `id = "global"`), URL da emas. Faqat ADMIN o'zgartiradi, audit'ga tushadi.
  Standart: `gradeWeight 80`, `testWeight 20`, `penaltyFactor 50`.
- **Xavfsizlik:** yozish doirasi `gradingLessonScope` — sinf rahbarligini
  **qo'shmaydi** (davomatdan farqli qoida, TZ talabi). O'qish doirasi kengroq.
  Ota-ona faqat o'z farzandini ko'radi.
- Tarjimalar: `messages/{grades,journal,ranking}/{uz,ru,en}.json`.

## 3. Merge qilingan PR'lar

### Bosqich PR'lari

- **#2–#32** — poydevor, auth, xavfsizlik audit tuzatishlari, o'quvchi/o'qituvchi
  CRUD, Excel import, typecheck tuzatishlari, Edge-runtime login tuzatishi.
- **#33** — navbar scroll tuzatishi.
- **#34** — 4-bosqich: akademik poydevor + sinflar CRUD + haftalik jadval.
- **#35** — `useFormState` + `redirectNever` muammosi: 5 formada `state?.error`.
- **#36** — jadvalda "+" bilan dars qo'shish; sinf formasida joriy o'quv yili.
- **#37** — sinflarni Excel'dan import.
- **#38** — **5-bosqich: davomat moduli.**
- **#39** — layout tuzatishi: ikkita skrolbar va sahifa oxiridagi bo'sh maydon.
- **#40–#58** — 6-bosqich: baholar, jurnal, reyting + yakunlash/tuzatish PR'lari.

### 0-to'lqin (o'lchov va poydevor)

- **migratsiya tizimiga o'tish** — `db push` dan voz kechildi, `0_init` bo'sh
  bazada sinovdan o'tdi (`docs/04-migratsiyalar.md`).
- **Vitest + CI** — `typecheck → lint → test → migrate deploy → build`.
- **Prisma query log** (`src/lib/query-log.ts`) — sekin so'rovlarni o'lchash.
- **O'lchov natijalari** — `docs/06-olchov-natijalari.md`.

### 1-to'lqin (xavfsizlik) — PR A → F

| PR | Nomi | Holat |
| --- | --- | --- |
| #74 | PR A | ✅ merge |
| #75 | PR B | ✅ merge |
| #76 | PR C 1-qism | ✅ merge |
| #77 | PR C 2-qism | ✅ merge |
| #78 | PR D — log va sirlar | ✅ merge (2 commit / 5 fayl) |
| #79 | PR D davomi — route guard, `X-Powered-By` | ✅ merge (1 commit / 2 fayl) |
| #80 | PR D davomi 2 — **CSV formula injection (klient)** | ✅ merge, egasi qo'lda tekshirdi |
| #81 | PR E 1-qism — `docs/07-xavfsizlik.md` + seed | ✅ merge (1 commit / 2 fayl) |
| #82 | PR E 2+3-qism — login demo-hisoblar + hujjat havolalari | ✅ merge |
| **bu PR** | PR E 4-qism — `docs/01` + `docs/05` yangilash | 🔄 |
| — | **PR F** — sxema nuqsonlari (migratsiya, **egasining ruxsati shart**) | ⬜ |

**1-to'lqin yopilish formulasi (egasi bilan kelishilgan):**
`PR A + PR B + PR C + PR D + PR E + PR F + PR #64 = 1-to'lqin yopildi`

**#1** (`ishchi shox` → `main`) hali **ochiq** — ishga tushirishdan oldin merge qilinadi.

## 4. Nuqson daftari (1-to'lqinda topilgan va yopilgan)

| № | Nuqson | Yechim | PR |
| --- | --- | --- | --- |
| 1 | `redactMeta` massiv ichini tozalamasdi | `redactList()` + `MAX_ARRAY_ITEMS = 50` | #78 |
| 2 | Sir kalitlari ro'yxatida `credentials` yo'q edi | `SECRET_SUBSTRING_PATTERN` + aniq so'zlar to'plami | #78 |
| 3 | `audit.ts` da xom `console.error(error)` | `describeErrorSafely()` | #78 |
| 4 | `logger.ts` `error.message` ni tozalamasdi | `sanitizeErrorMessage()` | #78 |
| 5 | `.gitignore` da `.env.*` va parol CSV'lari yo'q edi | `login-parollar*.csv` + `/*.csv` | #78 |
| 6 | `.env.example` eskirgan | `SEED_ALLOW_REMOTE`, `AUTH_TRUST_HOST` | #78 |
| 7 | `route-guard.ts` da xom `console.error` | `logError("route-guard", ...)` | #79 |
| 8 | `X-Powered-By` Next.js versiyasini oshkor qilardi | `poweredByHeader: false` | #79 |
| 9 | **Klient CSV formula injection** — server tuzatmasi (#66) klientda takrorlanmagan | `sanitizeCsvCell` + `DANGEROUS_CELL_START` | **#80** |
| 10 | `seed.ts` xato matni baza host nomini oshkor qilardi | Host xabardan olib tashlandi | #81 |
| 11 | **Login sahifasi demo hisoblarni prod'da ham ko'rsatardi** (`admin@maktab.uz`) | `NODE_ENV !== "production"` bilan yopildi | **#82** |
| 12 | Login sahifasida til almashtirgich yo'q edi | `<LanguageSwitcher />` | #82 |
| 13 | `AGENTS.md` va `README.md` mavjud bo'lmagan `docs/TZ.md` ga havola qilardi | `docs/tz/` ga yo'naltirildi | #82 |

**9-nuqson darsi:** server tomondagi tuzatma klient tomonda takrorlanmasa,
himoya yo'q. `docs/07-xavfsizlik.md` §5 da ikki yo'l jadvali sifatida yozilgan,
`AGENTS.md` da 10-qoida bo'lib qo'yilgan.

## 5. Baza holati

`prisma/schema.prisma` **TZ'dagi butun ma'lumotlar modelini** o'z ichiga oladi:

- Tayyor va ishlatilayotgan: `User`, `Teacher`, `Guardian`, `Student`, `Class`,
  `Subject`, `AcademicYear`, `Quarter`, `LessonPeriod`, `Lesson`, `Attendance`,
  `Grade`, `RankingSetting`, `AuditLog`.
- Tayyor, lekin hali interfeysi yo'q: `PenaltyCriterion`, `Penalty`,
  `Contract`, `Invoice`, `Payment`, `Message` (qisman — davomat SMS navbati),
  `Test`, `TestResult`.

### Migratsiya — `db push` ISHLATILMAYDI

> **Bu bo'lim avval noto'g'ri edi.** Eski matn "hozircha `npx prisma db push`
> ishlatiladi" deb turardi. Bu **endi to'g'ri emas**: migratsiya tarixi
> `prisma/migrations/` da mavjud va CI `prisma migrate deploy` + `migrate
> status` ni yuritadi. `db push` qilsangiz tarix bilan baza bir-biriga
> qarama-qarshi bo'lib qoladi.

| Vaziyat | Buyruq |
| --- | --- |
| Sxema o'zgarmagan, faqat kod tortildi | **hech narsa kerak emas** |
| Sxema o'zgardi (lokal) | `npx prisma migrate dev --name <nom>` + `npm run db:generate` |
| Migratsiyalarni bazaga qo'llash | `npx prisma migrate deploy` |

Tafsiloti: `docs/04-migratsiyalar.md`.

### 6-bosqichda sxemaga kirgan o'zgarishlar

| O'zgarish | Sabab |
| --- | --- |
| `RankingSetting` modeli | Reyting koeffitsientlari uchun (singleton) |
| `Grade.lessonId` (ixtiyoriy) | Baho darsga bog'lanadi; `onDelete: SetNull` |
| `Grade.date` → `@db.Date` | So'rovlar sanani aniq tenglik bilan qidiradi |
| `@@unique([studentId, lessonId, date, type])` | Takrorlanishga qarshi bazadagi qalqon |

> **Ochiq muammo (PR F):** `lessonId` NULL bo'lgan eski baholar unique cheklovga
> **tushmaydi** (PostgreSQL da NULL o'zi bilan teng emas) — ya'ni bir o'quvchiga
> bir kunda cheksiz takroriy baho qo'yish mumkin. Backfill + kuchliroq cheklov
> kerak. Bu **migratsiya** bo'lgani uchun egasining ruxsatisiz qilinmaydi.

## 6. Testlar

**Jami 80 test** (eski matnda "66" deb turardi):

| Fayl | Mazmuni |
| --- | --- |
| `tests/smoke.test.ts` | poydevor |
| `tests/lib/rbac.test.ts` | rol × sahifa matritsasi, `EXISTING_APP_PAGES` |
| `tests/lib/scope.test.ts` | har rol × har doira funksiyasi (IDOR) |
| `tests/lib/audit.test.ts` | 14 test — sir tozalash, massiv kesish |

Hammasi bazasiz, sof funksiyalar ustida. `audit.ts` `./db` ni import qilgani
uchun testda `vi.mock("@/lib/db", ...)` shart.

## 7. Papka tuzilishi

```
prisma/schema.prisma, prisma/migrations/, prisma/seed.ts
messages/{uz,ru,en}.json              # KATTA fayllar — to'liq qayta yozilmaydi
messages/attendance/{uz,ru,en}.json   # modul bo'yicha alohida tarjima (NAMUNA)
messages/{grades,journal,ranking}/{uz,ru,en}.json
src/i18n/{config,navigation,request}.ts
src/auth.ts, src/auth.config.ts, src/middleware.ts
src/components/ui/                    # button, card, input, label, sheet
src/components/import-wizard.tsx, nav-config.ts, sidebar.tsx,
  mobile-nav.tsx, vertical-header.tsx, language-switcher.tsx
src/app/global-error.tsx              # src/app ILDIZIDA, [locale] ostida EMAS
src/app/[locale]/(app)/               # academic-years, attendance (+journal),
                                      # classes, dashboard, grades, journal,
                                      # lesson-periods, ranking, schedule,
                                      # students, subjects, teachers
src/app/[locale]/{login,change-password,forbidden,[...rest]}/
src/app/api/import-template/[entity]/route.ts
tests/, vitest.config.ts
```

`src/lib/` (31 fayl): `absence-notice.ts`, `academics.ts`, `attendance.ts`,
`attendance-grid.ts`, `audit.ts`, `auth-guard.ts`, `class-imports.ts`,
`classes.ts`, `db.ts`, `env.ts`, `excel.ts`, `grades.ts`,
`import-commit-guards.ts`, `import-guards.ts`, `imports.ts`, `journal.ts`,
`lessons.ts`, `logger.ts`, `password.ts`, `query-log.ts`, `ranking.ts`,
`rate-limit-core.ts`, `rate-limit.ts`, `rbac.ts`, `route-guard.ts`,
`safe-action.ts`, `scope.ts`, `students.ts`, `teachers.ts`,
`test-questions.ts`, `utils.ts`.

## 8. Buzilmasligi kerak bo'lgan texnik qarorlar

1. `next/headers` **middleware/Edge bundle'iga kirmasligi** kerak — shu sabab
   `rate-limit-core.ts` alohida ajratilgan.
2. `/api/auth/*` auth middleware'idan **tashqarida** qoladi.
3. Prisma va bcrypt `auth.config.ts` ga **kirmasligi** kerak (Edge bundle).
4. `"use server"` faylidan umumiy mantiq **eksport qilinmaydi**.
5. Prisma sxemasida faqat `//` va `///` izoh — `/* */` `P1012` beradi.
6. `logger.ts` `audit.ts` dan import qiladi, **teskarisi hech qachon**.
7. `excel.ts` (u `xlsx` ni tortadi) **klient komponentiga import qilinmaydi**.

To'liq ro'yxat va sabablar: `docs/07-xavfsizlik.md` §13.

## 9. Ma'lum ochiq kamchiliklar

Bu ro'yxat **shu faylda takrorlanmaydi** — yagona manba:
**`docs/07-xavfsizlik.md` §11**.

Qisqacha eslatma: avtomatik secret scanning **yo'q** (GitHub Advanced Security
yoqilmagan, ombor ochiq), parol siyosati bo'sh (8 belgi, `Parol123` o'tadi),
rate limit xotirada (ko'p instansiyada ishlamaydi), `middleware.ts` matcher'ida
nuqtali yo'llar teshigi, `Student.userId` va `Grade.lessonId` sxema nuqsonlari
(PR F).

## 10. Layout qoidasi (PR #39 dan keyin)

- **Yagona ko'rinadigan skrol** — sahifaning o'zi.
- Kontent maydonida (`main`) **ichki skrol konteyneri yaratilmaydi**.
- Yon menyu va header `position: sticky` bilan ushlab turiladi.
- Yon menyuning ichki skroli bor, skrolbari `no-scrollbar` bilan yashirilgan —
  buni o'zgartirmang.
- `min-h-screen` **o'ng ustunda** turadi, tashqi flex konteynerda emas.
- Keng jadvallar (jurnal, baholar) **gorizontal** siljiydi (`overflow-x-auto`).
