import { createHash } from "node:crypto";

/**
 * SO'ROV CHEKLOVI — KALIT YASASH (PR G4c)
 * =======================================
 *
 * Kalitlar endi BAZADA saqlanadi (`RateHit` jadvali), shuning uchun
 * kalitning ichida nima turishi — maxfiylik masalasi. Shu mantiq alohida,
 * toza faylga ajratildi: uni bazasiz test qilish mumkin
 * (`tests/lib/rate-limit.test.ts`).
 *
 * NEGA LOGIN XESHLANADI
 * ---------------------
 * Login — email yoki telefon raqami, ya'ni shaxsiy ma'lumot. Uni ochiq
 * saqlaganda `RateHit` jadvali **"tizimga kirishga urinilgan email va
 * telefonlar ro'yxati"**ga aylanardi. Ya'ni parol sinashga qarshi himoya
 * o'zi yangi ma'lumot sizish yo'lini yaratardi — bazaga o'qish huquqi
 * bo'lgan har kim (yoki sizib chiqqan zaxira nusxasi) haqiqiy
 * foydalanuvchilar ro'yxatini olardi. Bu fishing uchun tayyor material.
 *
 * Yechim: SHA-256. Xesh bir tomonlama — bir xil login har doim bir xil
 * kalit beradi (cheklov ishlashi uchun shu yetadi), lekin kalitdan
 * loginni tiklab bo'lmaydi.
 *
 * TUZ (salt) QO'SHILMADI — ONGLI QAROR
 * ------------------------------------
 * Maxfiy tuz qo'shilsa lug'at bo'yicha taqqoslash ("bu xesh
 * admin@maktab.uz nikimi?") ham imkonsiz bo'lardi. Qo'shilmadi, chunki:
 *   - tuz `AUTH_SECRET` ga bog'lanardi, uni almashtirish esa barcha
 *     hisoblagichni bir zumda yo'qotardi (ya'ni cheklovni nolga qaytarardi
 *     — aynan biz yopgan teshik);
 *   - bu jadvaldagi qatorlar bir soatdan kam yashaydi.
 * Kamchilik hujjatda (`docs/07-xavfsizlik.md`) ochiq yozilgan.
 */

/** Xesh uzunligi: to'qnashuv ehtimoli amalda nol, kalit qisqa qoladi. */
const HASH_LENGTH = 32;

/**
 * Loginni solishtirishga yaroqli shaklga keltiradi.
 *
 * Normalizatsiya xavfsizlik uchun ham kerak: "Admin@Maktab.uz " va
 * "admin@maktab.uz" bir xil hisoblanmasa, hujumchi har safar harf
 * registrini o'zgartirib yangi hisoblagich olardi va 5 urinish chegarasi
 * cheksiz bo'lib qolardi.
 */
export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/** Login identifikatorining bir tomonlama xeshi (ochiq matn saqlanmaydi). */
export function loginKeyHash(login: string): string {
  return createHash("sha256")
    .update(normalizeLogin(login))
    .digest("hex")
    .slice(0, HASH_LENGTH);
}

/** Login bo'yicha hisoblagich kaliti. */
export function loginKeyFor(login: string): string {
  return `login:${loginKeyHash(login)}`;
}

/**
 * IP bo'yicha hisoblagich kaliti.
 *
 * IP aniqlanmasa hammasi bitta `ip:unknown` kalitiga tushadi — bu ataylab:
 * "noma'lum" holatni cheklovsiz qoldirish sarlavhani olib tashlash bilan
 * chegarani chetlab o'tish yo'lini ochardi.
 */
export function ipKeyFor(ip: string): string {
  const trimmed = typeof ip === "string" ? ip.trim() : "";
  return `ip:${trimmed || "unknown"}`;
}
