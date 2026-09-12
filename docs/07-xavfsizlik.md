# 07 — Xavfsizlik qoidalari va hujum yuzasi

> **Bu hujjat majburiy.** Loyihada yangi sahifa, API yoki server action
> qo'shilganda quyidagi 3-bo'limdagi ro'yxat **to'liq** bajarilishi shart.
> "Bu joyga hujum qilmaydi" degan asos bilan biror bandni tashlab ketish
> **taqiqlanadi**.

Oxirgi yangilanish: 2-to'lqin, G4 (PR #59–#96).

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

| Qatlam | Chegara | Joyi | Hisob qayerda |
|---|---|---|---|
| Sahifa (GET) | 300 / daqiqa | `middleware.ts` | **xotirada** (Edge) |
| API (`/api/*`) | 60 / daqiqa | `middleware.ts` | **xotirada** (Edge) |
| Server action (POST + `next-action`) | 40 / daqiqa | `middleware.ts` | **xotirada** (Edge) |
| Server action (ikkinchi qatlam) | 40 / daqiqa | `safe-action.ts` | **bazada** (`RateHit`) |
| Import preview | 10 / daqiqa | `import-preview-limit.ts` | **bazada** |
| Route handler | 30 / daqiqa | `route-guard.ts` | **xotirada** |
| **Login** | **5 / 15 daqiqa (login bo'yicha)** va **20 / 15 daqiqa (IP bo'yicha)** | `rate-limit.ts` | **bazada** |

Server action'lar uchun chegara **ikki qatlamda**: `middleware.ts` barcha
`next-action` POST so'rovlarini qamrab oladi (shu jumladan `createAction`
ga o'ralmagan action'larni), `safe-action.ts` esa qo'shimcha qatlam.

### Hisob qayerda saqlanadi (PR G4a–G4c)

Ilgari **hamma** hisoblagich server jarayonining xotirasida edi. Bu ikki
teshik qoldirardi:

1. **Qayta ishga tushirish hisobni nolga qaytaradi** — har deploy, crash
   yoki bulutdagi avtomatik ko'tarilish barcha urinishni o'chirib
   tashlardi. "5 urinishdan keyin bloklanadi" degan qoida amalda kafolat
   emasdi.
2. **Bir nechta instansiya** — har biri o'z hisobini yuritib, amaldagi
   chegarani instansiya soniga ko'paytirardi.

Endi eng muhim qatlamlar (**login**, **server action**, **import
preview**) hisobini PostgreSQL dagi `RateHit` jadvalida yuritadi
(`rate-limit-db.ts`): jarayon qayta ko'tarilsa ham, bir necha instansiya
bo'lsa ham chegara **bitta va davomli**.

> **ISTISNO (ochiq qolgan joy):** `middleware.ts` va `route-guard.ts`
> chegaralari **hamon xotirada**. Sababi: middleware **Edge** muhitida
> ishlaydi, u yerda Prisma **umuman ishlamaydi**. Shuning uchun loyihada
> ataylab **ikkita** hisoblagich bor: `rate-limit-core.ts` (Edge, xotira)
> va `rate-limit-db.ts` (Node, baza). Middleware'ni Node muhitiga
> o'tkazish har so'rov tezligiga ta'sir qiladi — qaror kechiktirilgan.

### Algoritm: ikki katakchali siljiydigan oyna

"Qat'iy oyna" (har daqiqa uchun bitta hisoblagich) mashhur teshik
qoldiradi: chegara 40 bo'lsa, hujumchi `12:00:59` da 40 ta va `12:01:00`
da yana 40 ta so'rov yuborib **bir soniyada 80 ta** so'rov o'tkazadi.
Shuning uchun joriy va oldingi katakcha birga hisoblanadi, oldingisi esa
vaznlanadi:

```
taxminiy = joriy + oldingi * (1 - o'tgan_vaqt / oyna)
```

Bu **aniq** siljiydigan oyna emas, taqribiy — lekin yuqoridagi ikki
barobar portlash teshigini yopadi. Mantiq `rate-limit-window.ts` da
(bazaga bog'liq emas) va `tests/lib/rate-limit.test.ts` bilan qulflangan.
Sabab: bu yerdagi bir belgilik xato **jimgina** ketadi — ilova ishlaydi,
log toza bo'ladi, faqat himoya yo'q bo'ladi.

Oshirish **atomar**: `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`.
"O'qib, so'ng yozish" usulida bir vaqtda kelgan ikki so'rov bir xil
qiymatni o'qib, ikkisi ham o'tib ketardi.

### Cheklov kalitlari va maxfiylik

Kalitlar bazada saqlanadi, shuning uchun ularning ichida nima turishi
maxfiylik masalasi (`rate-limit-keys.ts`):

- Server action / import: `action:<userId>:<ip>`;
- **Login: `login:<sha256>`** — email/telefon **xeshlanadi**. Ochiq
  qoldirilsa `RateHit` jadvali "tizimga kirishga urinilgan email va
  telefonlar ro'yxati"ga aylanardi, ya'ni himoyaning o'zi yangi sizish
  yo'lini yaratardi;
- IP aniqlanmasa `ip:unknown` — "noma'lum" holat cheklovsiz qolmaydi;
- jadvalda **faqat** kalit + oyna boshi + son turadi (parol, ism, erkin
  matn yo'q), qatorlar eskirgach avtomatik o'chiriladi;
- `logError` ga **kalit yozilmaydi** — faqat chegara va oyna uzunligi.

### Login himoyasi

- Hisob **topilmasa ham** `bcrypt.compare` soxta xesh bilan bajariladi.
  Sabab: aks holda "hisob yo'q" javobi "parol xato" javobidan ~100 ms
  tez qaytadi va hujumchi **javob vaqtini o'lchab** qaysi email tizimda
  borligini aniqlaydi (user enumeration). Bu fishing uchun tayyor ro'yxat.
- Login cheklovida tekshirish va yozish **ajralgan**: faqat
  **muvaffaqiyatsiz** urinish hisoblanadi, aks holda kun bo'yi ishlaydigan
  admin o'zini o'zi bloklab qo'yardi.
- Muvaffaqiyatli kirish shu login hisobini tozalaydi, lekin **IP hisobi
  tozalanmaydi** — aks holda hujumchi o'z hisobiga kirib IP chegarasini
  har safar "yuvib tashlardi".
- Hisoblagichni o'qib bo'lmasa urinish **cheklangan** deb qaraladi
  (fail-closed): "bilmadim" ni "nol" deb talqin qilish bazani band qilib
  chegarani o'chirish yo'lini ochardi.
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
| Minimal uzunlik | **12 belgi** (`password.ts`, PR G1) |
| Talab | kamida bitta harf va bitta raqam |
| Maksimal uzunlik | 128 belgi (bcrypt cheklovi va DoS uchun) |
| Xeshlash | bcrypt, 10 round |
| Login formasi | `min(1)` — mavjud hisoblar kiraversin |

Siyosat **bitta joyda** turadi (`password.ts`) va import, seed, parol
almashtirish — hammasi shu yerga qaraydi. Sabab (PR G2a saboqi): siyosat
ikki joyda takrorlansa, biri eskirib qoladi va tekshiruv jimgina
yumshaydi.

> **Ochiq kamchilik:** siyosatdan **oldin** yaratilgan, 12 belgidan qisqa
> paroli bor hisoblar majburan almashtirishga tushmaydi. Yechim —
> `mustChangePassword: true` ni ommaviy qo'yish (alohida kichik PR).

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
7. **Jim `catch` taqiqlanadi** (PR G3, G3b, G3c saboqi): rad etilgan
   amal, tashlab ketilgan qator yoki IDOR urinishi hisob bilan
   `logError(...)` ga tushishi kerak. Aks holda hujum belgisi umuman
   ko'rinmaydi.

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
| **`middleware.ts` va `route-guard.ts` chegaralari hamon xotirada** | Ko'p instansiyada har biri o'z hisobini yuritadi → sahifa/API chegarasi N barobar yumshoq; qayta ishga tushirish hisobni nollaydi | Middleware'ni Node runtime'ga o'tkazish (tezlikka ta'sir qiladi) yoki tashqi WAF |
| IP almashtirish | Botnet yoki proxy bilan IP bo'yicha chegara chetlab o'tiladi | Faqat infratuzilma darajasida (Cloudflare, WAF) |
| `MAX_KEYS = 20_000` (xotiradagi qatlam) | Chegaradan oshsa eski kalitlar o'chadi — nazariy jihatdan chegarani "yuvish" mumkin | Shu qatlam bazaga ko'chirilsa hal bo'ladi |
| Cheklovga urilish bo'yicha **ogohlantirish (alert) yo'q** | Kimdir parol sinayotganini faqat qo'lda log/`AuditLog` ko'rib bilish mumkin | Monitoring xizmati ulanishi kerak |
| **Avtomatik sekret skani yo'q** — GitHub Advanced Security yoqilmagan | `.env` tasodifan commit qilinsa avtomatik ogohlantirish bo'lmaydi | GHAS yoqish yoki repozitoriyni yopiq qilish |

> **Eskirgan yozuv olib tashlandi:** ilgari bu jadvalda "barcha so'rov
> chegaralari xotirada, yechim — Redis" deb turardi. Login, server action
> va import chegaralari PR G4a–G4b da PostgreSQL ga ko'chirildi; Redis
> **kerak emas** deb qaror qilindi (yangi xizmat, yangi maxfiy kalit,
> yangi nosozlik nuqtasi va oylik to'lov — hozirgi hajmda asossiz).
> Ochiq qolgan yagona qatlam — Edge middleware, yuqoridagi birinchi qator.

### Kod

| Kamchilik | Holat |
|---|---|
| Login xeshiga maxfiy "tuz" qo'shilmagan | Ongli qaror: tuz `AUTH_SECRET` ga bog'lanardi, uni almashtirish barcha hisoblagichni nollab, biz yopgan teshikni qaytarardi. Qatorlar bir soatdan kam yashaydi |
| `recordDb` xatosi so'rovni buzmaydi (faqat log) | Baza yozishni rad etsa o'sha urinish hisobga kirmay qolishi mumkin. O'qish fail-closed bo'lgani uchun cheklov o'chib qolmaydi |
| `consumeDb` / `countRecentDb` ning **SQL yo'li** avtomatik testda emas | Haqiqiy PostgreSQL kerak. Oyna matematikasi va kalitlar testlangan (`tests/lib/rate-limit.test.ts`), SQL qo'lda tekshiriladi |
| `middleware.ts` matcher `.*\..*` — nuqtali yo'llar auth middleware'dan chetda | Kuzatuvda. `/api/auth/*` **ataylab** chetda (Auth.js o'zi boshqaradi) |
| `pages.signIn: "/login"` til prefiksisiz | Bitta qo'shimcha 307 → `/uz/login`. Xavfsizlik emas, tezlik/UX |
| 12 belgidan qisqa **mavjud** parollar majburan almashtirilmaydi | Alohida kichik PR kutilmoqda |
| `prisma/seed.ts` dagi `SEED_PASSWORD` siyosat orqali tekshirilishi tasdiqlanishi kerak | Tekshirilmagan — shuning uchun "yopilgan" deb yozilmaydi |
| `assignStudentsAction` o'quvchini boshqa sinfdan jimgina ko'chirishi mumkin | Biznes qarori kutilmoqda |
| `AcademicYear.isCurrent` bazada yagona emas (faqat ilova darajasida) | Musobaqa holatida ikki "joriy yil" bo'lishi mumkin |
| PR #86 dagi 8 `NOT VALID` CHECK hali `VALIDATE` qilinmagan | Egasi bajarishi kerak |
| Rad etishlar faqat konsol/`AuditLog` ga tushadi | Markazlashgan kuzatuv yo'q |
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

### So'rov cheklovi doimiyligi (PR G4)

Eng muhim qo'lda sinov — **hisob serverdan keyin ham yashashi**:

1. Bir hisobga ketma-ket **6 marta** noto'g'ri parol kiriting → 6-si
   bloklanadi.
2. Serverni `Ctrl+C` bilan to'xtatib **qayta ishga tushiring**.
3. Shu hisobga **to'g'ri parol** bilan kiring → hamon bloklangan bo'lishi
   kerak. Agar kirib ketsa, doimiy cheklov ishlamayapti.
4. `psql`: `SELECT * FROM "RateHit" WHERE "key" LIKE 'login:%';` →
   kalitda **email/telefon ko'rinmasligi** kerak (faqat xesh).
5. `SELECT COUNT(*) FROM "RateHit";` — bir necha yuzdan oshib ketmasligi
   kerak (tozalash ishlayotganini ko'rsatadi).

### Avtomatik testlar

```bash
npm test
```

`tests/lib/` ichida: `rbac.test.ts`, `scope.test.ts`, `audit.test.ts`,
`password.test.ts`, `scoring.test.ts`, `import-commit-guards.test.ts`,
`rate-limit.test.ts`. Aniq son bu yerda **ataylab yozilmadi** — eskirib
qolardi; `npm test` natijasi haqiqiy manba.

Yangi sahifa qo'shilib `EXISTING_APP_PAGES` ga yozilmasa test **yiqiladi**.

---

## 13. Buzilmasligi kerak bo'lgan texnik qarorlar

Bular xavfsizlik yoki ishlashga bevosita bog'liq — o'zgartirishdan oldin
sababini o'qing:

- **`next/headers` middleware bundle'iga tushmasligi kerak** — shuning
  uchun `rate-limit-core.ts` alohida fayl.
- **`rate-limit-window.ts` va `rate-limit-keys.ts` toza qolishi kerak** —
  ularga `db`, `next/headers` yoki boshqa muhitga bog'liq import
  qo'shilsa, testlar haqiqiy baza talab qilib qoladi va cheklov mantig'i
  yana tekshirilmay ketadi.
- **`/api/auth/*` auth middleware'dan tashqarida qolishi kerak** —
  matcher: `["/((?!api/auth|_next|_vercel|.*\\..*).*)"]`.
- **Prisma va bcrypt `auth.config.ts` ga kirmasligi kerak** — Edge'da
  ishlamaydi, kirsa login butunlay buziladi.
- **Prisma ni Edge (middleware) da ishlatish mumkin emas** — shu sababli
  middleware chegaralari xotirada (4-bo'limdagi istisno).
- **`"use server"` faylidan umumiy mantiqni `export` qilish taqiqlanadi**
  — har bir eksport ochiq HTTP endpoint'ga aylanadi. Shu sababli
  `absence-notice.ts` alohida kutubxona fayli.
- **`excel.ts` ni klient komponentiga import qilish taqiqlanadi** —
  `xlsx` paketi brauzer bundle'iga tushadi.
- **`logger.ts` `audit.ts` dan import qiladi, teskarisi emas.**
- **Prisma sxemasida faqat `//` va `///` izohlar** — `/* */` `P1012` beradi.
