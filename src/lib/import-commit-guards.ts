import { db } from "./db";
import { passwordSchema } from "./password";

/**
 * IMPORT COMMIT QADAMI — QAYTA TEKSHIRUV
 * ======================================
 *
 * NIMA UCHUN KERAK (topilgan nuqson):
 *
 * Import ikki qadamli: `preview` faylni o'qiydi va tekshiradi, `commit`
 * esa admin tasdiqlagan qatorlarni yozadi. Muammo shunda edi — `commit`
 * ga kelayotgan ma'lumot fayldan emas, BRAUZERDAN keladi. Ya'ni oradagi
 * qadamda payload'ni qo'lda o'zgartirish mumkin.
 *
 * `preview` da qo'yilgan qoidalar (email formati, parol siyosati, o'quv
 * yili va sinf rahbari bazada bor-yo'qligi) `commit` da QAYTA
 * QO'LLANMAGAN edi. Zod sxemasi faqat "matn, uzunligi 190 dan kam" deb
 * tekshirardi. Natijada qo'lda yasalgan so'rov bilan:
 *   - email o'rniga umuman email bo'lmagan matn yozish
 *   - parol siyosatini (harf + raqam) chetlab o'tib "aaaaaaaa" qo'yish
 *   - sinfni istalgan (yoki mavjud bo'lmagan) o'quv yili / rahbarga
 *     bog'lab qo'yish
 * mumkin edi.
 *
 * QOIDA (egasining talabi): hech qanday tekshiruvni "bu joyga hujum
 * qilmaydi" deb tashlab ketmaymiz. Klientdan kelgan har bir qiymat
 * yozishdan oldin serverda qaytadan tekshiriladi.
 *
 * Eslatma: bu amallar faqat ADMIN uchun ochiq, ya'ni bu "rolni oshirish"
 * teshigi emas. Lekin hisobi o'g'irlangan admin yoki XSS orqali yuborilgan
 * so'rov bazani buzib qo'yishi mumkin — shuning uchun qatlam yopiladi.
 *
 * Bu yerdagi `loadValid*Ids` yordamchilari importdan tashqari oddiy
 * formalarda ham ishlatiladi (o'quvchi/o'qituvchi yaratish) — bog'liq id
 * bazada bor-yo'qligini yozishdan OLDIN tekshirish uchun.
 */

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_EMAIL_LENGTH = 190;
const MIN_PHONE_DIGITS = 7;

/** Email'ni bir ko'rinishga keltiradi (kichik harf, chetlari kesilgan). */
export function normalizeCommitEmail(value?: string | null): string | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  return text === "" ? null : text;
}

export function isValidCommitEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

/**
 * Telefonni bir ko'rinishga keltiradi. Juda qisqa raqam `null` qaytaradi —
 * bunday qiymat login sifatida ishlatilmasligi kerak.
 */
export function normalizeCommitPhone(value?: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  if (text === "") return null;

  const digits = text.replace(/[^\d]/g, "");
  if (digits.length < MIN_PHONE_DIGITS) return null;

  return text.startsWith("+") || digits.length > 9 ? `+${digits}` : digits;
}

/**
 * Boshlang'ich parol siyosati.
 *
 * TUZATILGAN NUQSON (G2a): bu funksiya parol qoidasini O'ZI takrorlab
 * yozgan edi — `value.length >= 8 && harf && raqam`. Natijada tizimda
 * ikki xil siyosat yashab turdi:
 *
 *   - forma orqali hisob yaratilsa `passwordSchema` (12 belgi, lug'at va
 *     naqsh tekshiruvi bilan) ishlardi;
 *   - Excel import orqali hisob yaratilsa SHU YERDAGI bo'sh qoida
 *     ishlardi, ya'ni `Maktab12` yoki `admin123` kabi parol bilan
 *     o'qituvchi hisobi bemalol yaratilardi.
 *
 * Import — aynan ommaviy yo'l: bitta fayl bilan o'nlab hisob ochiladi.
 * Shuning uchun eng zaif parollar aynan shu yo'ldan kirib kelardi.
 *
 * Endi qoida bitta manbadan olinadi: `passwordSchema`. Ya'ni siyosat
 * o'zgarsa (masalan chegara 12 dan 14 ga chiqsa) import ham avtomatik
 * ergashadi — qoidani ikkinchi joyda yangilash esdan chiqishi mumkin emas,
 * chunki ikkinchi joy endi yo'q.
 */
export function isStrongInitialPassword(value: string): boolean {
  return passwordSchema.safeParse(value).success;
}

/** Berilgan id'lardan bazada HAQIQATDA mavjud bo'lganlarini qaytaradi. */
async function existingIds(
  ids: Array<string | null | undefined>,
  loader: (unique: string[]) => Promise<Array<{ id: string }>>
): Promise<Set<string>> {
  const unique = Array.from(
    new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))
  );
  if (unique.length === 0) return new Set<string>();

  const rows = await loader(unique);
  return new Set(rows.map((row) => row.id));
}

export function loadValidAcademicYearIds(
  ids: Array<string | null | undefined>
): Promise<Set<string>> {
  return existingIds(ids, (unique) =>
    db.academicYear.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    })
  );
}

export function loadValidTeacherIds(
  ids: Array<string | null | undefined>
): Promise<Set<string>> {
  return existingIds(ids, (unique) =>
    db.teacher.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    })
  );
}

export function loadValidClassIds(
  ids: Array<string | null | undefined>
): Promise<Set<string>> {
  return existingIds(ids, (unique) =>
    db.class.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    })
  );
}

export function loadValidSubjectIds(
  ids: Array<string | null | undefined>
): Promise<Set<string>> {
  return existingIds(ids, (unique) =>
    db.subject.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    })
  );
}
