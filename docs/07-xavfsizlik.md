# 07 — Xavfsizlik qoidalari va hujum yuzasi

> **Bu hujjat majburiy.** Loyihada yangi sahifa, API yoki server action
> qo'shilganda quyidagi 3-bo'limdagi ro'yxat **to'liq** bajarilishi shart.
> "Bu joyga hujum qilmaydi" degan asos bilan biror bandni tashlab ketish
> **taqiqlanadi**.

Oxirgi yangilanish: 1-to'lqin (PR #59–#80).

---

## 1. Nima uchun bu qat'iylik

Tizim xususiy maktabning **shaxsiy ma'lumotlarini** saqlaydi: o'quvchilar,
ularning tug'ilgan sanasi, manzili, ota-onasining telefon raqami, baholari,
davomati, kelajakda to'lovlari. O'zbekiston qonunchiligida ham, mijoz
nuqtai nazaridan ham bu ma'lumotning tarqalishi eng katta zarar.

Shu sababli loyihada ikkita tamoyil amal qiladi:

1. **Fail-closed** — shubha bo'lsa **rad etamiz**. Ruxsat noaniq bo'lsa,
   ma'lumot ko'rsatilmaydi; sozlama noaniq bo'lsa, jarayon to'xtaydi.
2. **"Topilmadi" == "ruxsat yo'q"** — foydalanuvchiga hech qachon
   "bu yozuv bor, lekin sizga ruxsat yo'q" deyilmaydi. Aks holda yozuvning
   mavjudligi o'zi ma'lumot sizishi bo'ladi.

---

## 2. Rollar va ruxsat

To'rt rol: `ADMIN`, `TEACHER`, `PARENT`, `ACCOUNTANT`.

| Rol | Ko'radi | Yozadi |
|---|---|---|
| `ADMIN` | Hammasini | Hammasini |
| `TEACHER` | O'z darslari + o'zi sinf rahbari bo'lgan sinf | O'z darslari uchun baho/davomat |
| `PARENT` | **Faqat** o'z farzandi | Hech narsa (to'liq o'qish uchun) |
| `ACCOUNTANT` | Moliya bo'limlari | Moliya (baho/davomatga tegmaydi) |

### Ruxsat qanday majburlanadi

Uch qatlam, uchtasi ham kerak:

1. **`src/middleware.ts`** — Edge'da, sahifa darajasida. `roleAllowedPaths`
   bo'yicha yo'lni tekshiradi. Bazaga tegmaydi (Edge'da Prisma yo'q).
2. **`requireAuth` / `requireRole` / `requireAdmin`** (`src/lib/auth-guard.ts`)
   — sahifa yoki action boshida. **Har so'rovda bazaga qaraydi**, shuning
   uchun bloklash va parol almashtirish **darhol** kuchga kiradi.
3. **`src/lib/scope.ts`** — so'rovning o'ziga `WHERE` sifatida qo'shiladi
   (`studentScope`, `classScope`, `gradeScope`, ...). Bu IDOR ga qarshi
   asosiy qalqon.

> **`findUnique({ where: { id } })` ni yolg'iz ishlatish TAQIQLANGAN.**
> Har doim `AND: [{ id }, xScope(user)]` yoki `assertCanAccessX(...)`.
> Sabab: id brauzerdan keladi, ya'ni foydalanuvchi uni almashtirib
> boshqa o'quvchining ma'lumotini so'rashi mumkin.

`rbac.ts` **fail-closed**: ro'yxatda yo'q yo'l **taqiqlangan** hisoblanadi.
Yangi sahifa qo'shsangiz `roleAllowedPaths` **va** `EXISTING_APP_PAGES`
ikkisiga ham qo'shish shart — aks holda test yiqiladi (bu ataylab shunday).

---

## 3. HAR BIR YANGI SAHIFA / API / ACTION UCHUN MAJBURIY RO'YXAT

Bu bo'lim — hujjatning asosiy maqsadi. Yangi kod qo'shganda **hammasini**
belgilab chiqing.

- [ ] **1. Autentifikatsiya.** Sahifa boshida `requireAuth()` yoki
      `requireRole(...)`. API'da `createRouteHandler({ roles })`.
      Server action'da `createAction({ roles })`.
- [ ] **2. Ruxsat ikki joyda.** `rbac.ts` dagi `roleAllowedPaths` **va**
      `EXISTING_APP_PAGES`. Action bo'lsa `createAction({ roles })`.
- [ ] **3. Qamrov (scope).** Har bir so'rovda `AND: [..., xScope(user)]`
      yoki `assertCanAccessX(...)`. Yolg'iz `findUnique({ where: { id } })`
      **yo'q**.
- [ ] **4. Kirish validatsiyasi.** `zod` sxemasi — **`searchParams` ham**.
      URL'dagi har bir qiymat foydalanuvchi nazoratida.
- [ ] **5. Serverda qayta tekshirish.** Formadan kelgan id'lar
      (fan, sinf, o'qituvchi, ball) serverda **qaytadan** tekshiriladi.
      Ballni brauzerdan olib ishlatish taqiqlanadi.
- [ ] **6. Rol chegaralari.** `ACCOUNTANT` o'qiydi, yozmaydi.
      `PARENT` faqat o'qiydi va faqat o'z farzandini.
- [ ] **7. Audit.** Har bir yozish amalida `logAudit(...)`.
- [ ] **8. Log tozaligi.** Xom `console.error(error)` **yo'q** —
      `logError(...)` ishlatiladi. `meta` ga parol/token/hash yozilmaydi.
- [ ] **9. Xato matni quruq.** Foydalanuvchiga ketadigan matnda baza
      xatosi, SQL, host, email, fayl yo'li **bo'lmaydi**.
- [ ] **10. "Topilmadi" == "ruxsat yo'q".** Ikkisi bir xil javob beradi.
- [ ] **11. Chegaralar.** Ro'yxat qaytaruvchi endpoint'da sahifalash yoki
      qat'iy `take`. Massiv qabul qilsa `.max(...)`.
- [ ] **12. Fayl yuklash bo'lsa** — 5-bo'limga qarang (kengaytma, hajm,
      qator/ustun chegarasi, formula tozalash).
- [ ] **13. CSV/Excel yuklab berish bo'lsa** — 5-bo'limdagi **ikki yo'l**
      (server va klient) ham tozalanganini tekshiring.

---

## 4. So'rov chegaralari (DDoS va brute force)

| Qatlam | Chegara | Joyi |
|---|---|---|
| Sahifa (GET) | 300 / daqiqa | `middleware.ts` |
| API (`/api/*`) | 60 / daqiqa | `middleware.ts` |
| Server action (POST + `next-action`) | 40 / daqiqa | `middleware.ts` |
| Server action (ikkinchi qatlam) | 40 / daqiqa | `safe-action.ts` |
| Route handler | 30 / daqiqa | `route-guard.ts` |
| **Login** | **5 / 15 daqiqa (login bo'yicha)** va **20 / 15 daqiqa (IP bo'yicha)** | `rate-limit.ts` |

Server action'lar uchun chegara **ikki qatlamda**: `middleware.ts` barcha
`next-action` POST so'rovlarini qamrab oladi (shu jumladan `createAction`
ga o'ralmagan action'larni), `safe-action.ts` esa qo'shimcha qatlam.

### Login himoyasi

- Hisob **topilmasa ham** `bcrypt.compare` soxta xesh bilan bajariladi.
  Sabab: aks holda "hisob yo'q" javobi "parol xato" javobidan ~100 ms
  tez qaytadi va hujumchi **javob vaqtini o'lchab** qaysi email tizimda
  borligini aniqlaydi (user enumeration). Bu fishing uchun tayyor ro'yxat.
- Audit'ga login **maskalangan** holda yoziladi (`maskIdentifier`).
- Xabar matni har doim bir xil — "login yoki parol xato".

### Sessiyani bekor qilish

- JWT serverda saqlanmaydi, shuning uchun `passwordChangedAt` +
  token ichidagi `pwdAt` solishtiriladi. Parol almashtirilsa **barcha**
  eski sessiyalar o'ladi.
- `token.pwdAt` **faqat kirish paytida** yoziladi. Uni davriy tekshiruvda
  yangilash **taqiqlanadi** — aks holda o'g'irlangan token o'zini
  "yangi parol bilan berilgan" qilib ko'rsatib qutulib qolardi.
- Bloklangan hisob: `requireAuth` har so'rovda tekshiradi (darhol),
  `auth.ts` dagi davriy tekshiruv esa 30 daqiqada ikkinchi qatlam.
- Baza javob bermasa sessiya darhol buzilmaydi — 2 soat grace davri.
  Sabab: baza uzilishi barcha foydalanuvchini chiqarib yuborishi kerak emas.

---

## 5. Import va eksport (eng ko'p nuqson chiqqan joy)

### Fayl qabul qilish chegaralari

| Nima | Chegara |
|---|---|
| Kengaytma | faqat `.xlsx`, `.xls` |
| Fayl hajmi | 5 MB |
| Qator | 1000 (o'qishda 1001 da to'xtaydi) |
| Ustun | 200 |
| Body limiti | 6 MB (`serverActions.bodySizeLimit`) |

Qator/ustun chegarasi **o'qish paytida** qo'yiladi — zip bomb'ga qarshi:
5 MB `.xlsx` ochilganda gigabaytlarga aylanishi mumkin.

### Formula injection — IKKI YO'L, IKKISI HAM YOPILISHI SHART

Excel va LibreOffice `=`, `+`, `-`, `@`, `\t`, `\r` bilan **boshlangan**
katakni formula deb **bajaradi**. Import qilinayotgan fayldagi ism
hujumchi nazoratida bo'lishi mumkin.

| Yo'l | Fayl | Himoya |
|---|---|---|
| Server, `.xlsx` yasash | `src/lib/excel.ts` | `sanitizeExcelCell` + `DANGEROUS_CELL_START` |
| **Klient, CSV yasash** | `src/components/import-wizard.tsx` | `sanitizeCsvCell` + o'sha regex nusxasi |

> **SABOQ (PR #66 → PR #80).** PR #66 formula injection'ni **faqat
> serverda** yopdi. Brauzerdagi `toCsv` esa o'sha himoyadan chetda qoldi
> va teshik 14 PR davomida ochiq turdi. Zarar ko'radigan fayl
> `login-parollar.csv` — ichida **ochiq parollar**. Ma'lumot serverdan
> emas, **adminning kompyuteridan** sizadi, server logida iz qolmaydi.
>
> **QOIDA: xavfsizlik yordamchisi yozganda, o'sha mantiqning klient
> tomonida takrorlanmagani tekshirilishi shart.**

`import-wizard.tsx` da regex `excel.ts` dan **nusxalangan**, import
qilinmagan. Sabab: `excel.ts` `xlsx` paketini import qiladi, komponent esa
`"use client"` — import qilsak butun `xlsx` brauzer bundle'iga tushardi.
**Ikkala regex bir xil bo'lib qolishi shart.** Birini o'zgartirsangiz,
ikkinchisini ham o'zgartiring.

Tartib muhim: **avval** formula neytrallanadi, **keyin** qo'shtirnoqqa
olinadi. Teskari tartibda apostrof qo'shtirnoq ichida qolib, Excel katakni
yana formula deb o'qishi mumkin.

### Ikki qadamli import

`preview` **hech narsa yozmaydi**, `commit` esa brauzerdan kelgan
qatorlarni **qaytadan** tekshiradi (`import-commit-guards.ts`). Preview'ni
chetlab o'tib to'g'ridan-to'g'ri `commit` ga qo'lda yasalgan payload
yuborish mumkin — shuning uchun bog'liq id'lar (sinf, fan, o'quv yili,
o'qituvchi) va chegaralar commit'da qaytadan tasdiqlanadi.

---

## 6. Parollar

### Siyosat

| Nima | Qiymat |
|---|---|
| Minimal uzunlik | 8 belgi (`password.ts`) |
| Talab | kamida bitta harf va bitta raqam |
| Xeshlash | bcrypt, 10 round |
| Login formasi | `min(1)` — mavjud hisoblar kiraversin |

### Boshlang'ich parollar (import) — **A REJA**

Import qilinganda tizim parol yasaydi: **12 belgi**, ~60 bit entropiya,
rejection sampling (bias yo'q), **qat'iy prefiks yo'q**, alifbodan
chalkashadigan belgilar (`l o 0 1`) chiqarilgan.

Har bir yangi hisob **`mustChangePassword: true`** bilan yaratiladi — ya'ni
o'g'irlangan boshlang'ich parol faqat o'qituvchi **birinchi marta
kirmasidan oldin** ishlaydi.

> ### `login-parollar.csv` — QAT'IY QOIDA
>
> 1. Fayl **faqat brauzer xotirasida** yasaladi. Serverda saqlanmaydi,
>    `localStorage` ga yozilmaydi, `AuditLog` ga tushmaydi.
> 2. Parollarni tarqatib bo'lgach faylni **DARHOL O'CHIRING**.
> 3. Faylni **loyiha papkasida saqlash taqiqlanadi**. `.gitignore` da
>    `login-parollar*.csv` va `/*.csv` bor, lekin bu oxirgi to'siq —
>    unga tayanmang.
> 4. Faylni Telegram/email orqali guruhga tashlash **taqiqlanadi**.
> 5. Parolni faqat o'sha odamning o'ziga bering.
>
> **Kelajak (3-to'lqin, C variant):** parol o'rniga **bir martalik
> havola** — o'qituvchi o'zi parol qo'yadi, tizim parolni hech qachon
> ko'rmaydi va CSV umuman kerak bo'lmaydi. Yangi jadval + migratsiya
> talab qiladi, shuning uchun keyingi to'lqinga qoldirilgan.

---

## 7. Maxfiy ma'lumot loglarda

Eng ko'p nuqson chiqqan ikkinchi joy. Oqim **ko'rinmas**: javob tanasi toza
bo'lsa ham, log uchinchi tomon xizmatiga (Vercel, Sentry) uzatiladi.

### Qoidalar

1. **Xom `console.error(error)` TAQIQLANADI.** `logError(...)` ishlatiladi.
   Prisma xato matniga so'rovdagi qiymatlarni va ba'zan `DATABASE_URL` ni
   qo'shadi.
2. `logAudit({ meta })` — `meta` `redactMeta` orqali tozalanadi:
   maxfiy kalitlar (`pass`, `parol`, `token`, `secret`, `hash`,
   `credential`, `cookie`, `session`, ...) va qisqa so'zlar
   (`otp`, `pin`, `jwt`, `iv`, ...) `[redacted]` ga aylanadi.
   **Massivlar ham** tozalanadi (`redactList`, 50 element chegarasi).
3. `sanitizeErrorMessage` xato matnidan URL, bcrypt xesh, email va
   telefon raqamini olib tashlaydi. **Tartib muhim: URL birinchi.**
4. Foydalanuvchiga ketadigan xato matni **quruq**: Prisma kodi (`P2002`)
   ham chiqmaydi, `prismaErrorMessage` uni o'zbekcha umumiy matnga
   aylantiradi.
5. Baza so'rovlari logi (`QUERY_LOG`) **ishlab chiqarishda ikki qatlamli
   qulf** bilan o'chirilgan.
6. `seed.ts` xato matnida baza **hosti chop etilmaydi** — xato CI logiga
   tushadi.

---

## 8. HTTP sarlavhalari va brauzer himoyasi

`next.config.mjs`, barcha yo'llarga (`/:path*`):

| Sarlavha | Qiymat |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`; `frame-ancestors 'none'`; `object-src 'none'`; `form-action 'self'`; `base-uri 'self'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=()`, `microphone=()`, `geolocation=()` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (faqat prod) |
| `X-Powered-By` | **o'chirilgan** (`poweredByHeader: false`) |

`'unsafe-eval'` faqat `development` da (Next.js dev rejimi talab qiladi).

Tekshirish:

```bash
npm run build && npm start
curl -I http://localhost:3000/uz/login
```

### Ochiq qayta yo'naltirish (open redirect)

Login'dan keyingi `next` parametri `safeLocale()` orqali tekshiriladi.
Tashqi manzilga (`//yovuz.example`, `https://...`) yo'naltirish mumkin
emas. **Yangi qayta yo'naltirish qo'shsangiz shu funksiyani ishlatish
shart.**

---

## 9. SMS (10-bosqichda ulanadi, chegaralar HOZIR qo'yilgan)

| Chegara | Qiymat |
|---|---|
| Bir o'quvchi, bir kun | 5 xabar |
| Bitta chaqiruv | 200 xabar |

SMS hali jo'natilmaydi, faqat `Message` jadvaliga `QUEUED` bo'lib yoziladi.
Chegara **hozir** kerak: modul ulangan kuni navbatdagi hammasi birdan
jo'nab ketardi. Chegarasiz holatda niyati buzuq (yoki hisobi o'g'irlangan)
o'qituvchi turli sanalarni yuborib bitta ota-onaga cheksiz SMS yog'dirishi,
maktabning balansini yoqib yuborishi yoki raqamni operator tomonidan
bloklanishiga olib kelishi mumkin edi.

Xabar raqami **faqat** o'sha o'quvchining `guardian.phone` dan olinadi.

---

## 10. Seed (demo ma'lumot)

Seed **ma'lum parolli ADMIN** yaratadi — ya'ni xato bazada ishlatilsa,
to'liq huquqli orqa eshik paydo bo'ladi.

Qulf **muhit nomiga emas, NISHON BAZAGA** qo'yilgan:

1. `NODE_ENV=production` — hech qanday holatda ishlamaydi;
2. `DATABASE_URL` hosti lokal bo'lmasa — `SEED_ALLOW_REMOTE=1` majburiy;
3. `SEED_PASSWORD` parol siyosatidan o'tishi shart;
4. nishon lokal bo'lmasa demo hisoblar `mustChangePassword: true` bilan.

> **Nima uchun `NODE_ENV` yetarli emas:** `npm run db:seed` ni `tsx` ishga
> tushiradi va u `NODE_ENV` ni **o'rnatmaydi**. Bo'sh qiymat
> `"development"` ga tushadi — ya'ni `.env` da prod `DATABASE_URL` turgan
> bo'lsa, qulf ochiq qolardi.

---

## 11. Ma'lum ochiq kamchiliklar (halollik bo'limi)

Bu ro'yxat **ataylab** hujjatda turadi. "Hammasi yopilgan" deb yozish
noto'g'ri bo'lardi.

### Infratuzilma

| Kamchilik | Ta'sir | Yechim |
|---|---|---|
| So'rov chegaralari **xotirada** | Ko'p instansiyada (Vercel, PM2 cluster) har biri o'z hisobini yuritadi → amaldagi chegara N barobar yumshoq | Upstash Redis yoki shunga o'xshash umumiy hisoblagich |
| IP almashtirish | Botnet yoki proxy bilan IP bo'yicha chegara chetlab o'tiladi | Faqat infratuzilma darajasida (Cloudflare, WAF) |
| `MAX_KEYS = 20_000` | Chegaradan oshsa eski kalitlar o'chadi — nazariy jihatdan chegarani "yuvish" mumkin | Redis'ga o'tishda hal bo'ladi |

### Kod

| Kamchilik | Holat |
|---|---|
| **Avtomatik sekret skani yo'q** — GitHub Advanced Security yoqilmagan (`run_secret_scanning` ishlamaydi) | Qo'lda tekshirildi: `.env` hech qachon commit qilinmagan. Avtomatik nazorat **yo'q** |
| `middleware.ts` matcher `.*\..*` — nuqtali yo'llar auth middleware'dan chetda | Kuzatuvda. `/api/auth/*` **ataylab** chetda (Auth.js o'zi boshqaradi) |
| `pages.signIn: "/login"` til prefiksisiz | Bitta qo'shimcha 307 → `/uz/login`. Xavfsizlik emas, tezlik/UX |
| Parol siyosati bo'sh — 8 belgi, `Parol123` o'tadi | Import parollari 12 belgi. Qo'lda qo'yilgan parol bo'shroq |
| `previewTeacherImport` / `previewStudentImport` `createAction` ga o'ralmagan | Action darajasidagi 40/min tegmaydi. `middleware.ts` chegarasi ishlaydi |
| `safe-action.ts` xatoni logga yozmasdan yutadi | Kuzatuvchanlik kamchiligi (ma'lumot sizmaydi) |
| Import `catch {}` — sabab yozilmaydi | Xuddi shunday |
| `assignStudentsAction` o'quvchini boshqa sinfdan jimgina ko'chirishi mumkin | Biznes qarori kutilmoqda |
| SSG (`●`) sahifalar: `/dashboard`, `/students`, `/grades`, `/ranking` | Rolga bog'liq kesh yo'qligi tasdiqlanishi kerak |
| Next.js **14.2.15** eskirgan | Yangilash rejalashtirilishi kerak |

---

## 12. Tekshirish usullari

### Sarlavhalar

```bash
npm run build && npm start
curl -I http://localhost:3000/uz/login
```

`X-Powered-By` **bo'lmasligi**, CSP va `X-Frame-Options: DENY`
**bo'lishi** kerak.

### CSV formula injection

1. Import shablonini ilovadan yuklab oling.
2. Ism ustuniga **apostrof bilan** `'=1+1` yozing (apostrof Excel uchun
   "bu matn" belgisi — faylga saqlanmaydi. Apostrofsiz yozsangiz Excel
   o'zi formulaga aylantiradi va test **ishlamaydi**).
3. Sinf ustuniga mavjud bo'lmagan nom (`99-Z`) — qator xatoga uchraydi.
   Ism to'ldirilgan bo'lishi shart, aks holda hisobotga `—` yoziladi.
4. "Tekshirish" → "Xatolarni yuklab olish" → CSV ni **Excel'da** ochish.
5. ✅ `=1+1` matn bo'lib turadi · ❌ `2` chiqsa himoya ishlamayapti.

Google Sheets'da tekshirmang — u formulalarga boshqacha munosabatda.

Test tugagach CSV faylini **o'chirib tashlang**.

### IDOR

Boshqa sinfning o'quvchisi id'sini URL'ga qo'lda qo'yib ko'ring
(`PARENT` yoki begona `TEACHER` hisobi bilan). Natija `/forbidden` yoki
"topilmadi" bo'lishi kerak — **hech qachon** ma'lumot ko'rinmasligi kerak.

### RBAC testlari

```bash
npm test
```

`tests/lib/rbac.test.ts`, `scope.test.ts`, `audit.test.ts` — jami 80 test.
Yangi sahifa qo'shilib `EXISTING_APP_PAGES` ga yozilmasa test **yiqiladi**.

---

## 13. Buzilmasligi kerak bo'lgan texnik qarorlar

Bular xavfsizlik yoki ishlashga bevosita bog'liq — o'zgartirishdan oldin
sababini o'qing:

- **`next/headers` middleware bundle'iga tushmasligi kerak** — shuning
  uchun `rate-limit-core.ts` alohida fayl.
- **`/api/auth/*` auth middleware'dan tashqarida qolishi kerak** —
  matcher: `["/((?!api/auth|_next|_vercel|.*\\..*).*)"]`.
- **Prisma va bcrypt `auth.config.ts` ga kirmasligi kerak** — Edge'da
  ishlamaydi, kirsa login butunlay buziladi.
- **`"use server"` faylidan umumiy mantiqni `export` qilish taqiqlanadi**
  — har bir eksport ochiq HTTP endpoint'ga aylanadi. Shu sababli
  `absence-notice.ts` alohida kutubxona fayli.
- **`excel.ts` ni klient komponentiga import qilish taqiqlanadi** —
  `xlsx` paketi brauzer bundle'iga tushadi.
- **`logger.ts` `audit.ts` dan import qiladi, teskarisi emas.**
- **Prisma sxemasida faqat `//` va `///` izohlar** — `/* */` `P1012` beradi.
