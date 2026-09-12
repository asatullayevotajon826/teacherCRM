import { db } from "./db";
import { logError } from "./logger";
import type { RateRule } from "./rate-limit-core";

/**
 * DOIMIY SO'ROV CHEKLOVI — BAZA ORQALI (PR G4a, G4b)
 * ==================================================
 *
 * TOPILGAN NUQSON
 * ---------------
 * `rate-limit-core.ts` hisoblagichni server jarayonining XOTIRASIDA
 * saqlaydi. Bu ikki teshik qoldirardi:
 *
 *   1. QAYTA ISHGA TUSHIRISH BILAN TOZALASH. Har `npm run build` /
 *      deploy / crash dan keyin hamma hisoblagich NOLGA qaytadi. Login
 *      urinishlari, import urinishlari, yozish amallari — hammasi
 *      "toza varaq". Serverni qayta ishga tushirishga majburlash esa
 *      alohida hujum emas: bulutda jarayon o'zi ham vaqti-vaqti bilan
 *      qayta ko'tariladi (scale-to-zero, yangi deploy).
 *   2. BIR NECHTA INSTANSIYA. Ikki serverda ishlaganda har biri o'z
 *      hisobini yuritadi, ya'ni haqiqiy chegara ikki barobar bo'ladi.
 *      Yuk muvozanatlagich so'rovlarni almashtirib yuborsa, chegara
 *      amalda instansiya soniga ko'payadi.
 *
 * Endi hisob PostgreSQL da — barcha jarayon va instansiya uchun BITTA.
 *
 * ALGORITM: SILJIYDIGAN OYNA (ikki katakchali)
 * --------------------------------------------
 * Eng sodda yechim — "qat'iy oyna" (fixed window): har daqiqa uchun bitta
 * hisoblagich. Uning mashhur kamchiligi bor: chegara 40 bo'lsa, hujumchi
 * 12:00:59 da 40 ta va 12:01:00 da yana 40 ta so'rov yuborib, BIR SONIYA
 * ichida 80 ta so'rov o'tkazadi. Ya'ni chegara amalda ikki barobar
 * bo'shashadi — bu haqiqiy teshik, chetlab o'tish usuli hammaga ma'lum.
 *
 * Shuning uchun ikkita katakcha o'qiladi: joriy oyna va undan oldingisi.
 * Oldingi oyna hisobi u qancha "chiqib ketganiga" qarab vaznlanadi:
 *
 *   taxminiy = joriy + oldingi * (1 - o'tgan_vaqt / oyna)
 *
 * Masalan yangi oyna boshlanganiga 15 soniya bo'lgan bo'lsa, oldingi
 * oynaning 75% i hamon hisobga olinadi. Natijada oyna chegarasidagi
 * portlash to'siladi, lekin bazaga qo'shimcha yuk tushmaydi: ikkala
 * qiymat BITTA so'rovda olinadi.
 *
 * ATOMARLIK (musobaqa holati yo'q)
 * --------------------------------
 * Hisoblagich "o'qib, so'ng yozish" bilan oshirilsa, bir vaqtda kelgan
 * ikki so'rov bir xil qiymatni o'qib, ikkisi ham o'tib ketardi — aynan
 * shu paytda cheklov kerak bo'ladi. Shuning uchun oshirish `INSERT ...
 * ON CONFLICT DO UPDATE ... RETURNING` bilan BITTA SQL amalida bajariladi:
 * PostgreSQL qatorni qulflaydi va yangi qiymatni qaytaradi. Parallel
 * so'rovlar navbatga tushadi, hech biri hisobdan chetda qolmaydi.
 *
 * FAIL-CLOSED (nosozlikda YOPILADI)
 * ---------------------------------
 * SQL xato bersa `consumeDb` `false` qaytaradi, ya'ni so'rov RAD ETILADI.
 * Buni ataylab shunday qildik: "xato bo'lsa o'tkazib yuborish"
 * (fail-open) hujumchiga tayyor retsept beradi — bazani band qilib
 * cheklovni o'chirish. Baza javob bermayotgan paytda ilovaning o'zi ham
 * ishlamaydi (hamma sahifa Prisma ga tayanadi), shuning uchun yopilish
 * qo'shimcha zarar keltirmaydi. Xato albatta `logError` bilan qayd
 * etiladi — jimgina yopilib qolmaydi.
 *
 * O'QISH FUNKSIYASI (`countRecentDb`) esa son emas, XATO holatida `null`
 * qaytaradi — chaqiruvchi "nol" bilan "bilmadim" ni farqlashi kerak.
 * Login cheklovi buni fail-closed deb talqin qiladi (`rate-limit.ts`).
 *
 * MAXFIYLIK
 * ---------
 * Jadvalda `key` turadi. Unga HECH QACHON ochiq shaxsiy ma'lumot
 * yozilmaydi:
 *   - Server Action / import kaliti: `action:<userId>:<ip>` — id va IP;
 *   - Login kaliti: `login:<sha256>` — email/telefon XESHLANADI
 *     (`rate-limit.ts`), aks holda bu jadval urinilgan email va telefon
 *     raqamlari ro'yxatiga aylanardi.
 * Shuningdek:
 *   - qatorlar UZOQ TURMAYDI: eski oynalar avtomatik o'chiriladi (pastda);
 *   - jadvalga parol, matn yoki erkin kiritma yozilmaydi;
 *   - `key` ni faqat kod yasaydi, foydalanuvchi matni unga to'g'ridan
 *     qo'shilmaydi;
 *   - log'ga `key` YOZILMAYDI — faqat chegara va oyna uzunligi.
 *
 * TOZALASH
 * --------
 * Alohida cron yoki fon vazifasi kerak emas: har ~50-chaqiruvda bir marta
 * eskirgan qatorlar o'chiriladi. Aks holda jadval cheksiz o'sib ketardi —
 * ya'ni cheklovning o'zi bazani to'ldirish yo'liga aylanardi.
 */

/** Har nechta chaqiruvda bir marta eski qatorlarni tozalash. */
const CLEANUP_EVERY = 50;

/**
 * Eng uzun oyna — login cheklovi (15 daqiqa). Undan kattaroq zaxira bilan
 * o'chiramiz, aks holda hali kerak bo'ladigan katakchani o'chirib qo'yish
 * mumkin (o'chirilgan katakcha = chegara nolga qaytishi).
 */
const MIN_CLEANUP_AGE_MS = 60 * 60 * 1000;

let callsSinceCleanup = 0;

type CountRow = { cur: number | null; prev: number | null };

type WindowInfo = {
  /** Joriy oyna boshi. */
  current: Date;
  /** Oldingi oyna boshi. */
  previous: Date;
  /** Oldingi oyna hisobining hali "chiqib ketmagan" ulushi (0..1). */
  previousWeight: number;
};

/**
 * Oyna chegaralarini hisoblaydi. Bitta joyda turadi, chunki o'qish va
 * yozish AYNAN bir xil oyna ustida ishlashi shart — aks holda yozilgan
 * urinish boshqa katakchaga tushib, hisobdan chetda qolardi.
 */
function windowsFor(windowMs: number): WindowInfo {
  const now = Date.now();
  const startMs = Math.floor(now / windowMs) * windowMs;
  return {
    current: new Date(startMs),
    previous: new Date(startMs - windowMs),
    previousWeight: Math.max(0, 1 - (now - startMs) / windowMs),
  };
}

/**
 * Eskirgan hisoblagich qatorlarini o'chiradi.
 *
 * Xatosi so'rovni BUZMAYDI: tozalash — uy ishi, cheklov qaroriga aloqasi
 * yo'q. Shuning uchun o'z `try/catch` ida turadi.
 */
async function maybeCleanup(windowMs: number): Promise<void> {
  callsSinceCleanup += 1;
  if (callsSinceCleanup < CLEANUP_EVERY) return;
  callsSinceCleanup = 0;

  const cutoff = new Date(Date.now() - Math.max(windowMs * 2, MIN_CLEANUP_AGE_MS));

  try {
    await db.$executeRaw`DELETE FROM "RateHit" WHERE "windowStart" < ${cutoff}`;
  } catch (error) {
    logError("rate-limit-db", error, { stage: "cleanup" });
  }
}

/**
 * So'rovni "iste'mol qiladi" — hisob bazada saqlanadi.
 *
 * `rate-limit-core.ts` dagi `consume` bilan bir xil shartnoma, farqi —
 * asinxron va jarayonlar orasida umumiy.
 *
 * @returns `true` — ruxsat berildi, `false` — chegaradan oshdi yoki
 *          hisoblagich ishlamadi (fail-closed).
 */
export async function consumeDb(key: string, rule: RateRule): Promise<boolean> {
  const { current, previous, previousWeight } = windowsFor(rule.windowMs);

  let currentCount = 0;
  let previousCount = 0;

  try {
    // Joriy katakchani atomar oshiramiz VA oldingi katakchani o'qiymiz —
    // bitta borish-kelishda.
    const rows = await db.$queryRaw<CountRow[]>`
      WITH upserted AS (
        INSERT INTO "RateHit" ("key", "windowStart", "count")
        VALUES (${key}, ${current}, 1)
        ON CONFLICT ("key", "windowStart")
        DO UPDATE SET "count" = "RateHit"."count" + 1
        RETURNING "count"
      )
      SELECT
        (SELECT "count" FROM upserted) AS "cur",
        COALESCE(
          (
            SELECT "count" FROM "RateHit"
            WHERE "key" = ${key} AND "windowStart" = ${previous}
          ),
          0
        ) AS "prev"
    `;

    currentCount = Number(rows[0]?.cur ?? 0);
    previousCount = Number(rows[0]?.prev ?? 0);
  } catch (error) {
    // Hisoblagich ishlamasa — YOPAMIZ. Sababi yuqoridagi izohda.
    logError("rate-limit-db", error, {
      stage: "consume",
      limit: rule.limit,
      windowMs: rule.windowMs,
    });
    return false;
  }

  await maybeCleanup(rule.windowMs);

  return currentCount + previousCount * previousWeight <= rule.limit;
}

/**
 * Oyna ichidagi urinishlar sonini O'QIYDI — hisobni oshirmaydi (PR G4b).
 *
 * Login cheklovi uchun kerak: u yerda tekshirish va yozish AJRALGAN.
 * Faqat MUVAFFAQIYATSIZ urinish hisoblanadi, muvaffaqiyatli kirish esa
 * hisoblagichni oshirmasligi kerak — aks holda ko'p ishlaydigan admin
 * o'zini o'zi bloklab qo'yardi.
 *
 * @returns taxminiy son (siljiydigan oyna bo'yicha), yoki `null` —
 *          hisoblagichni o'qib bo'lmadi. `null` ni "nol" deb talqin
 *          qilish TAQIQLANADI: bu cheklovni jimgina o'chirib qo'yardi.
 */
export async function countRecentDb(
  key: string,
  windowMs: number
): Promise<number | null> {
  const { current, previous, previousWeight } = windowsFor(windowMs);

  try {
    const rows = await db.$queryRaw<CountRow[]>`
      SELECT
        COALESCE(
          (
            SELECT "count" FROM "RateHit"
            WHERE "key" = ${key} AND "windowStart" = ${current}
          ),
          0
        ) AS "cur",
        COALESCE(
          (
            SELECT "count" FROM "RateHit"
            WHERE "key" = ${key} AND "windowStart" = ${previous}
          ),
          0
        ) AS "prev"
    `;

    const currentCount = Number(rows[0]?.cur ?? 0);
    const previousCount = Number(rows[0]?.prev ?? 0);

    return currentCount + previousCount * previousWeight;
  } catch (error) {
    logError("rate-limit-db", error, { stage: "count", windowMs });
    return null;
  }
}

/**
 * Bitta urinishni yozib qo'yadi (PR G4b).
 *
 * Xato bo'lsa qayd etiladi, lekin chaqiruvchiga uzatilmaydi: bu funksiya
 * login javobini kechiktirmasligi yoki buzmasligi kerak. Yozib
 * bo'lmagan urinish hisobga tushmaydi — shu holat PR tavsifida ochiq
 * yozilgan.
 */
export async function recordDb(key: string, windowMs: number): Promise<void> {
  const { current } = windowsFor(windowMs);

  try {
    await db.$executeRaw`
      INSERT INTO "RateHit" ("key", "windowStart", "count")
      VALUES (${key}, ${current}, 1)
      ON CONFLICT ("key", "windowStart")
      DO UPDATE SET "count" = "RateHit"."count" + 1
    `;
  } catch (error) {
    logError("rate-limit-db", error, { stage: "record", windowMs });
    return;
  }

  await maybeCleanup(windowMs);
}

/**
 * Kalit hisoblagichini butunlay tozalaydi (PR G4b).
 *
 * Muvaffaqiyatli kirishdan keyin shu login hisobini nolga qaytarish
 * uchun. IP hisoblagichi ATAYLAB tozalanmaydi: aks holda hujumchi bitta
 * o'z hisobiga muvaffaqiyatli kirib, IP chegarasini har safar
 * "yuvib tashlashi" mumkin bo'lardi.
 */
export async function resetDbKey(key: string): Promise<void> {
  try {
    await db.$executeRaw`DELETE FROM "RateHit" WHERE "key" = ${key}`;
  } catch (error) {
    logError("rate-limit-db", error, { stage: "reset" });
  }
}
