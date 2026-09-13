import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { env } from "../src/lib/env";
import { passwordError } from "../src/lib/password";
import { describeErrorSafely } from "../src/lib/audit";
import { logError } from "../src/lib/logger";

const db = new PrismaClient();

/**
 * SEED — FAQAT LOKAL BAZA UCHUN (1-to'lqin, xavfsizlik)
 * ====================================================
 *
 * NIMA UCHUN QAT'IY QULF KERAK:
 * Seed ma'lum parolli demo hisoblarni yaratadi — shu jumladan ADMIN. Agar u
 * xato bazaga ishlatilsa, tizimda to'liq huquqli orqa eshik paydo bo'ladi.
 *
 * Ilgari qulf faqat `NODE_ENV === "production"` edi va bu YETARLI EMAS:
 * `npm run db:seed` buyrug'ini `tsx` ishga tushiradi va u `NODE_ENV` ni
 * o'rnatmaydi. Bo'sh qiymat `env.ts` da `"development"` ga tushadi. Ya'ni
 * `.env` faylida ishlab chiqarish `DATABASE_URL` turgan bo'lsa, qulf ochiq
 * qolardi va demo ADMIN real bazaga yozilardi.
 *
 * Shuning uchun endi ASOSIY mezon — muhit nomi emas, NISHON BAZA:
 *   1. `NODE_ENV=production` bo'lsa — hech qanday holatda ishlamaydi;
 *   2. `DATABASE_URL` hosti lokal bo'lmasa — `SEED_ALLOW_REMOTE=1` majburiy
 *      (ataylab, bilib turib yoziladigan tasdiq);
 *   3. `SEED_PASSWORD` parol siyosatidan o'tishi shart;
 *   4. nishon lokal bo'lmasa, demo hisoblar `mustChangePassword: true` bilan
 *      yaratiladi — birinchi kirishda parol almashtirish majburiy bo'ladi.
 *
 * LOG GIGIENASI (H4a): fayl oxiridagi `catch` ilgari xom xatoni
 * `console.error` ga berardi. Prisma xatosi matnida yozilmoqchi bo'lgan
 * qator qiymatlari (email, parol hash) va ulanish satri bo'ladi, stack esa
 * fayl yo'llarini oshkor qiladi. Seed masofaviy nishonda yoki CI da
 * ishlaganda bu matn uchinchi tomon logiga tushadi. Endi xato `logError`
 * orqali yoziladi va lokal ishlab chiqishdan tashqari holatda
 * `describeErrorSafely` bilan tozalanadi.
 */

/** Lokal deb hisoblanadigan hostlar. Boshqa hamma narsa "masofaviy". */
const LOCAL_DB_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "host.docker.internal",
]);

/** `DATABASE_URL` dan host nomini oladi. O'qib bo'lmasa `null`. */
function databaseHost(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "" ? null : hostname;
  } catch {
    return null;
  }
}

/**
 * Nishon baza lokalmi? Host o'qib bo'lmasa `false` — shubhada eng qattiq
 * yo'l tanlanadi (fail-closed), ya'ni log ham tozalanadi.
 */
function targetIsLocalDatabase(): boolean {
  const host = databaseHost(env.DATABASE_URL);
  return host !== null && LOCAL_DB_HOSTS.has(host);
}

/**
 * Seed ishlashiga ruxsat bormi — tekshiradi va nishon lokalligini qaytaradi.
 * Shubha bo'lsa TO'XTATADI (fail-closed): seed ishlamagani ma'lumot
 * buzilganidan yaxshi.
 */
function assertSafeSeedTarget(): { targetIsLocal: boolean } {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Seed NODE_ENV=production da ishlamaydi. Demo hisoblar prod'ga tushmasligi kerak."
    );
  }

  const host = databaseHost(env.DATABASE_URL);
  if (host === null) {
    throw new Error(
      "DATABASE_URL dan host o'qib bo'lmadi. Seed to'xtatildi — nishon baza " +
        "noaniq bo'lsa demo hisob yaratmaymiz."
    );
  }

  const targetIsLocal = LOCAL_DB_HOSTS.has(host);

  if (!targetIsLocal && env.SEED_ALLOW_REMOTE !== "1") {
    /*
     * XOST NOMI ATAYLAB CHOP ETILMAYDI.
     *
     * Ilgari bu matnda `host: "${host}"` bor edi. Xato `process.exit(1)`
     * bilan chiqadi, ya'ni matn CI logiga tushadi — log esa uchinchi tomon
     * xizmatida saqlanadi va ko'pincha kengroq doiraga ko'rinadi.
     * Baza hosti razvedka uchun qiymatli: hujumchi qaysi provayder va
     * qaysi manzil ishlatilayotganini biladi.
     *
     * Xostni ko'rish kerak bo'lsa u `.env` faylida turadi — loglardan
     * o'qish shart emas.
     */
    throw new Error(
      "Seed to'xtatildi: DATABASE_URL lokal bazaga ishora qilmaydi.\n" +
        "Seed ma'lum parolli demo ADMIN hisobini yaratadi — bu masofaviy " +
        "bazada to'liq huquqli orqa eshik degani.\n" +
        "Nishon manzilni `.env` dagi DATABASE_URL dan tekshiring " +
        "(host nomi bu xabarda ataylab ko'rsatilmadi — xabar CI logiga tushadi).\n" +
        "Agar bu ataylab qilinayotgan bo'lsa (masalan sinov serveri), " +
        "SEED_ALLOW_REMOTE=1 qo'yib qayta ishga tushiring."
    );
  }

  return { targetIsLocal };
}

async function main() {
  const { targetIsLocal } = assertSafeSeedTarget();

  const seedPassword = env.SEED_PASSWORD;
  if (!seedPassword) {
    throw new Error(
      "SEED_PASSWORD .env da yo'q. .env.example ni ko'rib qo'ying."
    );
  }

  // Demo hisob ham parol siyosatidan o'tishi kerak: "123" kabi parol bilan
  // yaratilgan hisob keyin esdan chiqib qolsa, bu ochiq teshik bo'lib qoladi.
  const weak = passwordError(seedPassword);
  if (weak) {
    throw new Error(`SEED_PASSWORD parol siyosatiga mos emas: ${weak}`);
  }

  console.log(
    `🌱 Seed boshlandi... (nishon: ${
      targetIsLocal ? "lokal baza" : "MASOFAVIY baza — SEED_ALLOW_REMOTE=1"
    })`
  );

  const passwordHash = await bcrypt.hash(seedPassword, 10);

  const users: { email: string; fullName: string; role: Role }[] = [
    { email: "admin@maktab.uz", fullName: "Bosh Administrator", role: Role.ADMIN },
    { email: "teacher@maktab.uz", fullName: "Aziz O'qituvchi", role: Role.TEACHER },
    { email: "accountant@maktab.uz", fullName: "Malika Buxgalter", role: Role.ACCOUNTANT },
    { email: "parent@maktab.uz", fullName: "Karim Ota-ona", role: Role.PARENT },
  ];

  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      update: {
        fullName: u.fullName,
        role: u.role,
        // `isActive` BU YERDA ATAYLAB YO'Q (H4a).
        //
        // Ilgari `isActive: true` turardi. Natijada ADMIN tomonidan
        // BLOKLANGAN demo hisob (masalan ishdan ketgan o'qituvchi yoki
        // suiiste'mol qilgan hisob) seed har qayta ishlaganda yana
        // faollashib qolardi — ya'ni seed bloklashni bekor qiladigan
        // yo'lga aylanardi. Hisobning faol/bloklangan holati faqat ADMIN
        // qaroriga bog'liq bo'lishi kerak, seed unga tegmaydi.
      },
      create: {
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        passwordHash,
        // Lokal ishlab chiqishda qulaylik uchun parol almashtirish talab
        // qilinmaydi. Lokal bo'lmagan nishonda esa MAJBURIY — ma'lum parol
        // bilan uzoq muddat turib qolmasligi uchun.
        mustChangePassword: !targetIsLocal,
      },
    });
  }
  console.log(
    `✅ ${users.length} ta foydalanuvchi. Yangi hisob paroli: SEED_PASSWORD. Mavjud hisob paroli o'zgarmaydi.`
  );

  const subjects = [
    { nameUz: "Matematika", nameRu: "Математика", nameEn: "Mathematics" },
    { nameUz: "Fizika", nameRu: "Физика", nameEn: "Physics" },
    { nameUz: "Ona tili", nameRu: "Родной язык", nameEn: "Native language" },
    { nameUz: "Ingliz tili", nameRu: "Английский язык", nameEn: "English" },
    { nameUz: "Tarix", nameRu: "История", nameEn: "History" },
  ];
  for (const s of subjects) {
    const exists = await db.subject.findFirst({ where: { nameUz: s.nameUz } });
    if (!exists) await db.subject.create({ data: s });
  }
  console.log(`✅ ${subjects.length} ta fan yaratildi`);

  const admin = await db.user.findUnique({ where: { email: "admin@maktab.uz" } });
  const criteria = [
    { name: "Darsga kechikish", points: 1, category: "Intizom" },
    { name: "Darsni sababsiz qoldirish", points: 3, category: "Davomat" },
    { name: "Forma qoidasini buzish", points: 1, category: "Forma" },
    { name: "Darsda tartibsizlik", points: 2, category: "Intizom" },
  ];
  for (const c of criteria) {
    const exists = await db.penaltyCriterion.findFirst({ where: { name: c.name } });
    if (!exists) {
      await db.penaltyCriterion.create({
        data: { ...c, createdById: admin?.id },
      });
    }
  }
  console.log(`✅ ${criteria.length} ta jarima mezoni yaratildi`);

  const yearName = "2025-2026";
  let year = await db.academicYear.findFirst({ where: { name: yearName } });
  if (!year) {
    year = await db.academicYear.create({
      data: {
        name: yearName,
        startDate: new Date("2025-09-01"),
        endDate: new Date("2026-05-31"),
        isCurrent: true,
      },
    });
    const quarters = [
      { name: 1, startDate: "2025-09-01", endDate: "2025-11-02" },
      { name: 2, startDate: "2025-11-10", endDate: "2025-12-28" },
      { name: 3, startDate: "2026-01-12", endDate: "2026-03-22" },
      { name: 4, startDate: "2026-04-01", endDate: "2026-05-31" },
    ];
    for (const q of quarters) {
      await db.quarter.create({
        data: {
          name: q.name,
          startDate: new Date(q.startDate),
          endDate: new Date(q.endDate),
          academicYearId: year.id,
        },
      });
    }
    console.log("✅ O'quv yili va 4 ta chorak yaratildi");
  }

  const teacherUser = await db.user.findUnique({
    where: { email: "teacher@maktab.uz" },
  });
  const parentUser = await db.user.findUnique({
    where: { email: "parent@maktab.uz" },
  });
  if (!teacherUser || !parentUser || !year) {
    throw new Error("Seed: foydalanuvchi yoki o'quv yili topilmadi");
  }

  const teacher = await db.teacher.upsert({
    where: { userId: teacherUser.id },
    update: {},
    create: { userId: teacherUser.id },
  });

  let klass = await db.class.findFirst({ where: { name: "9-A" } });
  if (!klass) {
    klass = await db.class.create({
      data: {
        name: "9-A",
        grade: 9,
        academicYearId: year.id,
        homeroomTeacherId: teacher.id,
      },
    });
  }

  let guardian = await db.guardian.findFirst({
    where: { userId: parentUser.id },
  });
  if (!guardian) {
    guardian = await db.guardian.create({
      data: {
        userId: parentUser.id,
        fullName: parentUser.fullName,
        phone: "+998901234567",
        relation: "ota",
      },
    });
  }

  const demoStudents = [
    {
      firstName: "Ali",
      lastName: "Karimov",
      guardianId: guardian.id,
    },
    {
      firstName: "Madina",
      lastName: "Tursunova",
      guardianId: null as string | null,
    },
  ];
  for (const s of demoStudents) {
    const exists = await db.student.findFirst({
      where: { firstName: s.firstName, lastName: s.lastName },
    });
    if (!exists) {
      await db.student.create({
        data: {
          firstName: s.firstName,
          lastName: s.lastName,
          classId: klass.id,
          guardianId: s.guardianId,
          status: "ACTIVE",
        },
      });
    }
  }
  console.log("✅ Demo sinf 9-A va 2 ta o'quvchi yaratildi");

  console.log("🌱 Seed yakunlandi.");
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    /*
     * XATO LOGI TOZALANADI (H4a).
     *
     * Ilgari shu yerda `console.error("❌ Seed xatosi:", e)` turardi va xom
     * `Error` obyekti chop etilardi. Bu ikki xil sizishga yo'l ochadi:
     *   1. Prisma xato MATNI — yozilmoqchi bo'lgan qator qiymatlari (email,
     *      `passwordHash`) va ba'zan `postgresql://user:parol@host/db`
     *      ulanish satri;
     *   2. stack — server fayl yo'llari va ichki tuzilma (razvedka uchun).
     *
     * Endi:
     *   - lokal nishon + `NODE_ENV !== "production"` bo'lsa, xom xato
     *     `logError` orqali chiqadi — nosozlikni topish uchun stack kerak,
     *     bu log esa lokal terminaldan tashqariga chiqmaydi;
     *   - qolgan HAMMA holatda (masofaviy nishon, CI, prod, host noaniq)
     *     xato `describeErrorSafely` bilan tozalanadi: URL, email, telefon
     *     va bcrypt hash o'rniga o'rin egallovchi qo'yiladi, matn 500
     *     belgiga qisqaradi va stack butunlay tashlanadi.
     */
    const safeToShowStack =
      env.NODE_ENV !== "production" && targetIsLocalDatabase();

    logError(
      "prisma/seed",
      safeToShowStack ? e : new Error(describeErrorSafely(e))
    );

    await db.$disconnect();
    process.exit(1);
  });
