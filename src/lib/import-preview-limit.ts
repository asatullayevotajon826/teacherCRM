import { consumeDb } from "./rate-limit-db";
import { getRequestIp } from "./rate-limit";

/**
 * IMPORT PREVIEW SO'ROV CHEKLOVI
 * ==============================
 *
 * TOPILGAN NUQSON:
 *
 * Yozish amallari `createAction` orqali o'tadi va u har bir chaqiruvni
 * cheklaydi (40/min). Lekin importning BIRINCHI qadami — `preview` —
 * `createAction` dan o'tmaydi: u `useFormState` bilan ishlaydigan oddiy
 * Server Action bo'lib, argument sifatida `FormData` va fayl oladi,
 * `createAction` esa zod sxemasi bilan tekshiriladigan oddiy obyekt kutadi.
 * Natijada preview HECH QANDAY cheklovsiz qolgan edi.
 *
 * NEGA XAVFLI:
 *
 * Preview eng "og'ir" amal: 5 MB gacha faylni to'liq xotiraga o'qiydi,
 * Excel'ni parse qiladi (1000 qatorgacha) va ustiga bazadan BARCHA sinf,
 * o'quvchi yoki o'qituvchi ro'yxatini tortadi (`findMany`). Ya'ni bitta
 * so'rov — sezilarli CPU va xotira.
 *
 * Bu yozish amali bo'lmagani uchun "xavfsiz" ko'rinadi, lekin aslida
 * xizmatni to'xtatish (DoS) uchun eng qulay nuqta edi: hisobi bo'lgan
 * admin (yoki uning o'g'irlangan sessiyasi) skript bilan bir vaqtda
 * o'nlab 5 MB faylni yuborsa, server xotirasi to'lib butun tizim
 * javob bermay qolardi. Bazaga hech narsa yozilmaydi — lekin maktab
 * ishlay olmaydi.
 *
 * CHEGARA NEGA 10:
 *
 * Odam bir daqiqada faylni tanlab, yuklab, natijani ko'zdan kechirib
 * ikki-uch martadan ko'p takrorlamaydi (xatolarni tuzatib qayta yuklash
 * ham shu oraliqqa sig'adi). 10 — qulaylik uchun keng zaxira, skript
 * uchun esa juda kam. Umumiy 40/min qoidasidan pastroq, chunki bu amal
 * oddiy yozishdan ancha qimmat.
 *
 * KALIT: foydalanuvchi + IP — `safe-action.ts` dagi mantiqning aynan o'zi.
 * Faqat IP bo'yicha cheklash bitta maktab tarmog'idagi hammani birga
 * bloklardi; faqat foydalanuvchi bo'yicha cheklash esa bir nechta hisobni
 * parallel ishlatib chetlab o'tishga imkon berardi.
 *
 * HISOB QAYERDA (PR G4a da o'zgardi):
 *
 * Ilgari hisoblagich server xotirasida edi — qayta ishga tushirish uni
 * nolga qaytarardi, ya'ni chegarani "tozalash" yo'li bor edi. Endi
 * `consumeDb` orqali PostgreSQL da: barcha jarayon va instansiya uchun
 * bitta hisob. Chegara va xabar o'zgarmadi.
 */
const PREVIEW_RULE = { limit: 10, windowMs: 60_000 };

export const PREVIEW_RATE_LIMIT_MESSAGE =
  "Fayl juda ko'p marta yuklandi. Bir daqiqadan keyin urinib ko'ring.";

/**
 * Import preview'iga ruxsat bormi.
 *
 * @returns `true` — davom etish mumkin, `false` — chegaradan oshdi.
 */
export async function allowImportPreview(userId: string): Promise<boolean> {
  const ip = await getRequestIp();
  return consumeDb(`import-preview:${userId}:${ip}`, PREVIEW_RULE);
}
