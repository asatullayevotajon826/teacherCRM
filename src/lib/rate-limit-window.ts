/**
 * SO'ROV CHEKLOVI — OYNA MATEMATIKASI (PR G4c)
 * ============================================
 *
 * Bu fayl ATAYLAB toza: bazaga, `next/headers` ga yoki boshqa hech
 * narsaga bog'liq emas. Sababi — uni **test qilish mumkin bo'lishi
 * kerak**. Ilgari bu mantiq `rate-limit-db.ts` ichida, Prisma bilan bir
 * faylda turardi, ya'ni uni tekshirish uchun haqiqiy PostgreSQL kerak
 * bo'lardi va amalda hech qachon tekshirilmasdi.
 *
 * Nima uchun bu muhim: bu yerdagi bir belgilik xato (masalan `-` o'rniga
 * `+`) cheklovni **jimgina** ishlamas holga keltiradi. Ilova xato
 * bermaydi, log toza bo'ladi, faqat himoya yo'q bo'ladi. Shuning uchun
 * mantiq ajratildi va `tests/lib/rate-limit.test.ts` bilan qulflandi.
 *
 * ALGORITM: ikki katakchali siljiydigan oyna
 * ------------------------------------------
 * "Qat'iy oyna" (har daqiqa uchun bitta hisoblagich) mashhur teshik
 * qoldiradi: chegara 40 bo'lsa, hujumchi 12:00:59 da 40 ta va 12:01:00 da
 * yana 40 ta so'rov yuborib, BIR SONIYA ichida 80 ta so'rov o'tkazadi.
 *
 * Shuning uchun joriy va oldingi katakcha birga hisoblanadi, oldingisi
 * esa qancha "chiqib ketganiga" qarab vaznlanadi:
 *
 *   taxminiy = joriy + oldingi * (1 - o'tgan_vaqt / oyna)
 *
 * Bu ANIQ siljiydigan oyna emas — taqribiy. Lekin yuqoridagi ikki
 * barobar portlash teshigini yopadi va bazaga faqat ikki katakcha
 * saqlashni talab qiladi (har so'rov vaqtini alohida saqlash kerak emas).
 */

export type WindowInfo = {
  /** Joriy oyna boshi. */
  current: Date;
  /** Oldingi oyna boshi. */
  previous: Date;
  /** Oldingi oyna hisobining hali "chiqib ketmagan" ulushi (0..1). */
  previousWeight: number;
};

/**
 * Oyna chegaralarini hisoblaydi.
 *
 * Bitta joyda turishi SHART: o'qish va yozish aynan bir xil oyna ustida
 * ishlashi kerak — aks holda yozilgan urinish boshqa katakchaga tushib,
 * hisobdan chetda qolardi (ya'ni cheklov ishlamay qolardi).
 *
 * @param windowMs oyna uzunligi (ms). Musbat, chekli son bo'lishi shart.
 * @param nowMs hozirgi vaqt — faqat test uchun beriladi.
 * @throws noto'g'ri `windowMs` da. Jimgina `NaN` bilan davom etish
 *         cheklovni butunlay o'chirib qo'yardi, shuning uchun bu yerda
 *         ataylab qattiq to'xtaymiz.
 */
export function windowsFor(windowMs: number, nowMs: number = Date.now()): WindowInfo {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("rate-limit: windowMs musbat son bo'lishi shart");
  }
  if (!Number.isFinite(nowMs)) {
    throw new Error("rate-limit: nowMs noto'g'ri");
  }

  const startMs = Math.floor(nowMs / windowMs) * windowMs;
  const elapsed = nowMs - startMs;

  return {
    current: new Date(startMs),
    previous: new Date(startMs - windowMs),
    // 0..1 oralig'idan chiqmasligi kafolatlanadi: manfiy vazn hisobni
    // kamaytirib, chegarani yumshatib qo'yardi.
    previousWeight: Math.min(1, Math.max(0, 1 - elapsed / windowMs)),
  };
}

/**
 * Oynadagi taxminiy urinishlar soni.
 *
 * Manfiy kirishlar 0 ga tenglashtiriladi: bazadagi buzilgan yoki
 * kutilmagan qiymat hisobni kamaytirib, chegarani yumshatmasligi kerak.
 */
export function estimateCount(
  currentCount: number,
  previousCount: number,
  previousWeight: number
): number {
  const cur = Number.isFinite(currentCount) ? Math.max(0, currentCount) : 0;
  const prev = Number.isFinite(previousCount) ? Math.max(0, previousCount) : 0;
  const weight = Number.isFinite(previousWeight)
    ? Math.min(1, Math.max(0, previousWeight))
    : 1; // noaniq bo'lsa eng qattiq variant

  return cur + prev * weight;
}
