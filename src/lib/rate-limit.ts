/**
 * LOGIN RATE LIMIT (Punkt 6)
 * ==========================
 *
 * `authorize()` da cheklov yo'q edi — skript soatda minglab parol sinashi mumkin.
 * 15 daqiqada login bo'yicha 5, IP bo'yicha 20 urinish.
 *
 * Muhim: limitga tushganda ham javob oddiy login xatosi bilan bir xil.
 * Aks holda hujumchi "bu hisob bor" deb aniqlab oladi.
 *
 * HISOB QAYERDA (PR G4b da o'zgardi)
 * ----------------------------------
 * Ilgari hisob `rate-limit-core.ts` orqali server XOTIRASIDA edi. Bu
 * parol sinashga qarshi eng muhim to'siqni bo'sh qoldirardi: serverni
 * qayta ishga tushirish (yangi deploy, crash, bulutdagi avtomatik
 * ko'tarilish) barcha urinish hisobini NOLGA qaytarardi. Ya'ni "15
 * daqiqada 5 urinish" amalda kafolat emasdi. Bir nechta instansiyada esa
 * chegara instansiya soniga ko'payardi.
 *
 * Endi hisob PostgreSQL da (`rate-limit-db.ts`): server qayta ishga
 * tushsa ham, bir necha instansiya bo'lsa ham chegara BITTA va davomli.
 *
 * LOGIN KALITI XESHLANADI (maxfiylik)
 * -----------------------------------
 * Kalit endi bazada saqlanadi, shuning uchun unga ochiq email yoki
 * telefon YOZILMAYDI: u SHA-256 bilan xeshlanadi. Aks holda `RateHit`
 * jadvali "tizimga kirishga urinilgan email va telefonlar ro'yxati"ga
 * aylanardi — ya'ni cheklovning o'zi yangi ma'lumot sizish yo'lini
 * yaratardi. Xesh bir tomonlama: taqqoslash uchun yetadi, o'qish uchun
 * yaramaydi.
 *
 * Xeshga maxfiy "tuz" qo'shilmadi: bu maxfiylikni bir pog'ona oshirardi,
 * lekin `AUTH_SECRET` ni shu qatlamga bog'lab qo'yardi (uni almashtirish
 * barcha hisoblagichni yo'qotardi). Bu jadvaldagi qatorlar bir soatdan
 * kam yashaydi, shuning uchun xesh yetarli deb hisoblandi — bu ongli
 * qaror, hujjatda ochiq yozildi.
 *
 * NOSOZLIKDA YOPILADI (fail-closed)
 * ---------------------------------
 * Hisoblagichni o'qib bo'lmasa (`null`), urinish CHEKLANGAN deb qaraladi.
 * "Bilmadim" ni "nol" deb talqin qilish bazani band qilib parol sinash
 * chegarasini o'chirish yo'lini ochardi. Login uchun bu xavfsiz tanlov:
 * baza javob bermayotganda parolni tekshirishning o'zi ham mumkin emas.
 */

import { createHash } from "node:crypto";
import { countRecentDb, recordDb, resetDbKey } from "./rate-limit-db";

const WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const IP_MAX_ATTEMPTS = 20;

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/**
 * Login identifikatorini bir tomonlama xeshga aylantiradi.
 * 32 belgi — to'qnashuv ehtimoli amalda nol, lekin kalit qisqa qoladi.
 */
function hashLogin(login: string): string {
  return createHash("sha256")
    .update(normalizeLogin(login))
    .digest("hex")
    .slice(0, 32);
}

export function loginAttemptKeys(login: string, ip: string) {
  return {
    loginKey: `login:${hashLogin(login)}`,
    ipKey: `ip:${ip || "unknown"}`,
  };
}

/**
 * Login yoki IP limitidan oshganmi.
 *
 * Hisoblagich o'qilmasa `true` qaytadi (fail-closed).
 */
export async function isLoginRateLimited(
  login: string,
  ip: string
): Promise<boolean> {
  const { loginKey, ipKey } = loginAttemptKeys(login, ip);

  const [loginCount, ipCount] = await Promise.all([
    countRecentDb(loginKey, WINDOW_MS),
    countRecentDb(ipKey, WINDOW_MS),
  ]);

  if (loginCount === null || ipCount === null) return true;

  return loginCount >= LOGIN_MAX_ATTEMPTS || ipCount >= IP_MAX_ATTEMPTS;
}

/** Muvaffaqiyatsiz urinishni hisobga oladi. */
export async function recordLoginFailure(
  login: string,
  ip: string
): Promise<void> {
  const { loginKey, ipKey } = loginAttemptKeys(login, ip);

  await Promise.all([
    recordDb(loginKey, WINDOW_MS),
    recordDb(ipKey, WINDOW_MS),
  ]);
}

/**
 * Muvaffaqiyatli kirishdan keyin shu login hisoblagichini tozalaydi.
 * IP hisoblagichi ataylab tozalanmaydi (sababi `resetDbKey` izohida).
 */
export async function clearLoginFailures(login: string): Promise<void> {
  const { loginKey } = loginAttemptKeys(login, "unused");
  await resetDbKey(loginKey);
}

/** So'rov IP si (Node runtime). Proxy orqasida x-forwarded-for / x-real-ip. */
export async function getRequestIp(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0]?.trim() || "unknown";
    }
    return h.get("x-real-ip")?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}
