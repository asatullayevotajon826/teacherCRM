import { db } from "./db";
import { logError } from "./logger";
import type { RateRule } from "./rate-limit-core";

/**
 * DOIMIY SO'ROV CHEKLOVI — BAZA ORQALI (PR G4a)
 * =============================================
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
 * SQL xato bersa `false` qaytadi, ya'ni so'rov RAD ETILADI. Buni ataylab
 * shunday qildik: "xato bo'lsa o'tkazib yuborish" (fail-open) hujumchiga
 * tayyor retsept beradi — bazani band qilib cheklovni o'chirish. Baza
 * javob bermayotgan paytda ilovaning o'zi ham ishlamaydi (hamma sahifa
 * Prisma ga tayanadi), shuning uchun yopilish qo'shimcha zarar keltirmaydi.
 * Xato albatta `logError` bilan qayd etiladi — jimgina yopilib qolmaydi.
 *
 * MAXFIYLIK
 * ---------
 * Jadvalda `key` turadi, u `action:<userId>:<ip>` ko'rinishida. Ya'ni
 * IP manzil — shaxsiy ma'lumot — bazada saqlanadi. Shuning uchun:
 *   - qatorlar UZOQ TURMAYDI: eski oynalar avtomatik o'chiriladi (pastda);
 *   - jadvalga hech qanday parol, email, telefon yoki matn yozilmaydi;
 *   - `key` ni faqat kod yasaydi, foydalanuvchi kiritgan matn unga
 *     qo'shilmaydi (aks holda jadvalga o'zboshimcha ma'lumot kiritish
 *     yo'li ochilardi);
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
  const now = Date.now();
  const windowStartMs = Math.floor(now / rule.windowMs) * rule.windowMs;
  const windowStart = new Date(windowStartMs);
  const prevWindowStart = new Date(windowStartMs - rule.windowMs);

  let current = 0;
  let previous = 0;

  try {
    // Joriy katakchani atomar oshiramiz VA oldingi katakchani o'qiymiz —
    // bitta borish-kelishda.
    const rows = await db.$queryRaw<CountRow[]>`
      WITH upserted AS (
        INSERT INTO "RateHit" ("key", "windowStart", "count")
        VALUES (${key}, ${windowStart}, 1)
        ON CONFLICT ("key", "windowStart")
        DO UPDATE SET "count" = "RateHit"."count" + 1
        RETURNING "count"
      )
      SELECT
        (SELECT "count" FROM upserted) AS "cur",
        COALESCE(
          (
            SELECT "count" FROM "RateHit"
            WHERE "key" = ${key} AND "windowStart" = ${prevWindowStart}
          ),
          0
        ) AS "prev"
    `;

    current = Number(rows[0]?.cur ?? 0);
    previous = Number(rows[0]?.prev ?? 0);
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

  // Siljiydigan oyna: oldingi oynaning hali "chiqib ketmagan" ulushi.
  const elapsed = now - windowStartMs;
  const previousWeight = Math.max(0, 1 - elapsed / rule.windowMs);
  const estimated = current + previous * previousWeight;

  return estimated <= rule.limit;
}
