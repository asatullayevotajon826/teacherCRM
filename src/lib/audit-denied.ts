import { logAudit } from "./audit";
import { consumeDb } from "./rate-limit-db";

/**
 * XAVFSIZLIK RAD ETISHLARINI DOIMIY QAYD ETISH (H4b)
 * ==================================================
 *
 * NIMA EDI: cheklov (rate limit) va ruxsat rad etishlari faqat `logError`
 * orqali KONSOLGA tushardi. Konsol logi vaqtinchalik: jarayon qayta ishga
 * tushsa yo'qoladi, saqlanish muddati platformaga bog'liq va uni SQL bilan
 * so'rab ko'rishning imkoni yo'q.
 *
 * NEGA XAVFLI: aynan shu yozuvlar hujumning yagona izi bo'ladi —
 * o'g'irlangan sessiya bilan yozish amallarini tsiklda yuborish, rol
 * chegarasini "sinab ko'rish", boshqa rol sahifalariga urinish. Iz
 * yo'qolsa, hodisadan keyin "kim, qachon, nechta urinish qildi" degan
 * savolga javob yo'q. Ya'ni buzilishni ISBOTLAB ham, RAD ETIB ham
 * bo'lmaydi.
 *
 * NIMA QILDIM: rad etishlar `AuditLog` ga `PERMISSION_DENIED` action bilan
 * yoziladi — u baza ichida, uzoq saqlanadi va so'rov qilinadi.
 *
 * QAT'IY TAMOYILLAR
 * -----------------
 * 1. XAVFSIZLIK QARORIGA TA'SIR QILMAYDI. Bu funksiya faqat QAYD ETADI.
 *    Rad etish qarori chaqiruvchida allaqachon qabul qilingan; jurnal
 *    xato bersa ham rad etish kuchda qoladi (`logAudit` hech qachon
 *    `throw` qilmaydi).
 *
 * 2. JURNALNING O'ZI HUJUM QUROLIGA AYLANMASLIGI KERAK. Har rad etilgan
 *    so'rov uchun bitta qator yozilsa, hujumchi ataylab minglab rad
 *    etilgan so'rov yuborib `AuditLog` jadvalini shishirishi mumkin edi
 *    (disk to'lishi = xizmatdan voz kechish). Shuning uchun yozuvlar
 *    DEDUPE qilinadi: bitta foydalanuvchi + sabab juftligi uchun
 *    daqiqada ko'pi bilan `DEDUPE_RULE.limit` ta qator. Hisob `consumeDb`
 *    orqali bazada — ya'ni server qayta ishga tushsa ham, bir nechta
 *    instansiya bo'lsa ham chegara bitta.
 *
 * 3. MAXFIY MA'LUMOT YOZILMAYDI. `meta` ga faqat kod yasagan qiymatlar
 *    tushadi: rol, ruxsat etilgan rollar, chegara, oyna uzunligi, ichki
 *    scope nomi. Foydalanuvchi kiritgan matn, parol, email, telefon va IP
 *    manzil ATAYLAB yozilmaydi:
 *      - IP — shaxsiy ma'lumot, jurnal esa uzoq saqlanadi va ko'p odam
 *        ko'radi; kerak bo'lsa u `logError` orqali serverda qoladi;
 *      - erkin matn — jurnalga o'zboshimcha yozuv kiritish (log injection)
 *        yo'lini ochardi.
 *    Qo'shimcha himoya sifatida `logAudit` `meta` ni `redactMeta` bilan
 *    tozalaydi.
 *
 * 4. FOYDALANUVCHI ANIQ BO'LMASA YOZILMAYDI. `userId` bo'lmasa (masalan
 *    kirmagan so'rov) qator yozilmaydi: bunday yozuvda foydali ma'lumot
 *    yo'q, lekin autentifikatsiyasiz hujumchi uchun jadvalni cheksiz
 *    to'ldirish yo'li paydo bo'lardi. Bunday holatlar `logError` bilan
 *    serverda qayd etiladi.
 */

/** Rad etish sababi. Faqat shu qiymatlar — erkin matn emas. */
export type DenialReason =
  | "role"
  | "rateLimit"
  | "mustChangePassword"
  | "scope";

/**
 * Bitta foydalanuvchi + sabab uchun jurnalga yozish chegarasi.
 *
 * 3 ta yozuv hodisani ko'rish uchun yetarli (birinchi urinish vaqti,
 * davom etayotgani), lekin jadvalni to'ldirish uchun kam.
 */
const DEDUPE_RULE = { limit: 3, windowMs: 60_000 };

export type PermissionDeniedInput = {
  /** Rad etilgan foydalanuvchi. Noma'lum bo'lsa yozuv yozilmaydi. */
  userId: string | null | undefined;
  reason: DenialReason;
  /** Model yoki qorovul nomi: "Page", "Route", "Action", "Student", ... */
  entity: string;
  entityId?: string | null;
  /** Faqat kod yasagan kontekst. Foydalanuvchi kiritmasi TAQIQLANADI. */
  meta?: Record<string, unknown> | null;
};

/**
 * Rad etishni `AuditLog` ga `PERMISSION_DENIED` bilan yozadi.
 *
 * Hech qachon `throw` qilmaydi — chaqiruvchi shundan keyin `redirect()`
 * yoki 403 javobini davom ettiradi.
 */
export async function logPermissionDenied(
  input: PermissionDeniedInput
): Promise<void> {
  const userId = input.userId;
  if (!userId) return;

  // Jurnal yozuvlari soni cheklanadi (2-tamoyil). `consumeDb` nosozlikda
  // `false` qaytaradi — bu holatda yozmaymiz. Xato allaqachon
  // `rate-limit-db.ts` ichida `logError` bilan qayd etilgan, ya'ni jimgina
  // yo'qolmaydi.
  const allowed = await consumeDb(
    `audit:denied:${input.reason}:${userId}`,
    DEDUPE_RULE
  );
  if (!allowed) return;

  await logAudit({
    userId,
    action: "PERMISSION_DENIED",
    entity: input.entity,
    entityId: input.entityId ?? null,
    meta: { reason: input.reason, ...(input.meta ?? {}) },
  });
}
