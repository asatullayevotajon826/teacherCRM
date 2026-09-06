# 🎓 teacherCRM — Maktab CRM

Xususiy maktablar uchun AI bilan boyitilgan CRM tizimi.

O'quvchi va o'qituvchilar bazasi, dars jadvali, davomat, baholar, jarima ball,
choraklik reyting, to'lov/kontrakt (buxgalteriya), hisobotlar, SMS xabarnoma,
3 tillilik (uz/ru/en) va AI modullari (test generatori, o'quvchi tahlili,
yordamchi) bir platformada.

## 🧱 Texnologiyalar

| Qatlam | Texnologiya |
| --- | --- |
| Frontend + Backend | Next.js 14 (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| Ma'lumotlar bazasi | PostgreSQL + Prisma ORM (migrate) |
| Autentifikatsiya | Auth.js v5 — login/parol + RBAC (4 rol) |
| Ko'p tillilik | next-intl (uz / ru / en) |
| Testlar | Vitest + GitHub Actions CI |
| Keyinroq | Vercel AI SDK, Eskiz.uz / Play Mobile (SMS) |

## 📘 Hujjatlar

Barcha hujjatlar `docs/` papkasida. Boshlash uchun:

| Fayl | Nima uchun |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | **Birinchi o'qiladigan fayl** — ish jarayoni va majburiy xavfsizlik ro'yxati |
| [`docs/00-tz-qisqacha.md`](docs/00-tz-qisqacha.md) | Texnik topshiriq qisqartmasi: rollar, RBAC, roadmap |
| [`docs/05-tolqinlar-rejasi.md`](docs/05-tolqinlar-rejasi.md) | Ish tartibi: 6 bosqich × 5 to'lqin |
| [`docs/07-xavfsizlik.md`](docs/07-xavfsizlik.md) | **Xavfsizlik modeli** — hujum yuzasi, himoya choralari, har bir yangi sahifa uchun majburiy ro'yxat, ma'lum ochiq kamchiliklar |
| [`docs/tz/01-umumiy-va-funksional.md`](docs/tz/01-umumiy-va-funksional.md) | To'liq TZ, 1–3-bo'lim: maqsad, atamalar, RBAC, funksional talablar |
| [`docs/tz/02-ai-va-texnik.md`](docs/tz/02-ai-va-texnik.md) | To'liq TZ, 4–11-bo'lim: test moduli, AI, NFR, arxitektura, ERD, roadmap |

## ✅ Talablar

1. **Node.js** 18.18+ (tavsiya: 20) — https://nodejs.org
2. **PostgreSQL** 14+ — https://www.postgresql.org/download/
   - yoki Docker: `docker run --name crm-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16`
3. **npm** (Node bilan birga keladi)

## 🚀 Ishga tushirish

```bash
# 1. Bog'liqliklarni o'rnatish
npm install

# 2. Muhit o'zgaruvchilarini sozlash
cp .env.example .env
#  .env faylida DATABASE_URL va AUTH_SECRET ni to'ldiring
npx auth secret         # AUTH_SECRET generatsiya qilish

# 3. Prisma klientini generatsiya qilish
npm run db:generate

# 4. Migratsiyalarni qo'llash
npx prisma migrate deploy

# 5. Demo ma'lumotlarni yuklash
npm run db:seed

# 6. Ishga tushirish
npm run dev
```

Brauzerda: **http://localhost:3000** (avtomatik `/uz` ga yo'naltiradi).

> Ishlab chiqarish rejimini sinash uchun `npm run build && npm start`.
> Bu rejimda `.env` da **`AUTH_URL`** ko'rsatilishi kerak.

> **Seed faqat lokal bazada ishlaydi.** `DATABASE_URL` lokal host'ga
> ishora qilmasa, seed to'xtaydi — chunki u ma'lum parolli ADMIN hisobini
> yaratadi. Ataylab kerak bo'lsa `SEED_ALLOW_REMOTE=1`.
> Batafsil: [`docs/07-xavfsizlik.md`](docs/07-xavfsizlik.md) 10-bo'lim.

## 👤 Demo hisoblar

| Rol | Login |
| --- | --- |
| Administrator | `admin@maktab.uz` |
| O'qituvchi | `teacher@maktab.uz` |
| Buxgalter | `accountant@maktab.uz` |
| Ota-ona / O'quvchi | `parent@maktab.uz` |

Parol `prisma/seed.ts` da `SEED_PASSWORD` orqali beriladi. Har bir rol o'ziga mos
yon menyuni ko'radi (RBAC).

> **Bu ro'yxat login sahifasida faqat ishlab chiqish rejimida ko'rinadi**
> (`NODE_ENV !== "production"`). Ishlab chiqarish build'ida u umuman
> bundle'ga tushmaydi — aks holda amaldagi ADMIN login'i ochiq sahifada
> yozilib turardi va bu brute force hamda fishing uchun tayyor nishon
> bo'lardi.

## 📂 Loyiha tuzilishi

```text
prisma/
  schema.prisma       # To'liq ma'lumotlar modeli
  migrations/         # Migratsiya tarixi (0_init dan boshlanadi)
  seed.ts             # Demo ma'lumotlar (faqat lokal baza)
messages/             # Tarjimalar: uz.json, ru.json, en.json
docs/                 # Hujjatlar (TZ, konvensiyalar, reja, xavfsizlik)
tests/                # Vitest testlari
src/
  auth.ts             # Auth.js konfiguratsiyasi
  auth.config.ts      # Sessiya, trustHost, callback'lar
  middleware.ts       # Til yo'naltirish + sessiya tekshiruvi + so'rov chegarasi
  i18n/               # i18n konfiguratsiya va navigatsiya
  lib/                # db, env, rbac, scope, audit, logger, rate-limit
  components/         # UI (shadcn), sidebar, til almashtirgich
  app/[locale]/       # Sahifalar (login, dashboard, students, journal, ...)
```

## 🖺 Bosqichlar

1–6-bosqich bajarilgan (poydevor, auth/RBAC, o'quvchi–o'qituvchi bazasi va Excel
import, sinf va dars jadvali, davomat, baho va reyting).

Keyingisi — jarima ball → to'lovlar → hisobot → SMS → test moduli → AI.

Har bosqich ichida qat'iy tartib: **o'lchov → xavfsizlik → tezlik → dizayn →
hujjat** (`docs/05-tolqinlar-rejasi.md`).
