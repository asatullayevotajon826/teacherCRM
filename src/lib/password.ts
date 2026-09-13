import { z } from "zod";

/**
 * PAROL SIYOSATI
 * ==============
 *
 * Login formasi (`z.string().min(1)`) o'zgarmaydi — mavjud hisoblar (shu
 * jumladan demo) kiraversin. Bu sxema FAQAT yangi parol yaratish va
 * o'zgartirish uchun: o'qituvchi qo'shish, /change-password.
 *
 * `mustChangePassword` — User maydoni + middleware + /change-password sahifasi.
 * Parolni tiklash (SMS) — 10-bosqich.
 *
 * NEGA CHEGARA 12 DAN 8 GA TUSHIRILDI (H4e)
 * -----------------------------------------
 * Bu — tizim egasining ataylab qabul qilgan qarori: 12 belgi amalda
 * ishlashga xalal berdi. Admin har bir o'qituvchi uchun qo'lda 12 belgili
 * parol o'ylab topishi kerak edi, natijada eng ehtimolli oqibat —
 * qog'ozga yozib qo'yilgan yoki hammaga bir xil berilgan parol. Ya'ni
 * qattiq qoida himoyani oshirmasdan, uni chetlab o'tishga majburlardi.
 *
 * HALOL BAHO: 8 belgi 12 dan ZAIFROQ. Agar parol xeshlari o'g'irlansa,
 * 8 belgili parolni ochish sezilarli darajada arzonroq. Bu xavf yo'qolgani
 * yo'q — u ongli ravishda qabul qilindi.
 *
 * Shuning uchun qolgan qatlamlar TEGILMADI va ular endi yanada muhim:
 *   1) uzunlik (8–128)
 *   2) harf + raqam birga
 *   3) mashhur/zaif parollar (lug'at hujumi)
 *   4) klaviatura va takror naqshlari ("aaaa", "123456", "qwerty")
 *
 * Qisqa parolni himoya qiladigan asosiy to'siq — ONLAYN urinishni
 * cheklash: `rate-limit-db.ts` (login uchun 5 urinish / 15 daqiqa, IP
 * uchun 20) va bcrypt (10 rounds) sekin xeshlash. Ya'ni brauzer orqali
 * parolni sinab topish amalda imkonsiz; xavf faqat baza o'g'irlangan
 * holatda qoladi.
 *
 * KELAJAK UCHUN TAVSIYA (hozir bajarilmadi): 8 belgiga ruxsat berilgani
 * uchun ikki faktorli kirish yoki parol o'rniga SMS-kod eng kuchli
 * yaxshilanish bo'ladi. Uzunlikni qaytarib oshirish o'rniga shu yo'l
 * tanlanishi kerak.
 *
 * MUHIM: bu qoidalar TEKSHIRUV, sir emas. Parolning o'zi hech qayerga
 * yozilmaydi — na logga, na auditga (`audit.ts` redaksiya qiladi), na
 * xato xabariga.
 */

/**
 * Yagona manba. Bu raqamni O'ZGARTIRISH KIFOYA — quyidagi hammasi
 * avtomatik ergashadi:
 *   - `passwordSchema` (server tekshiruvi)
 *   - `passwordRuleText` (formadagi qoida matni, uch tilda)
 *   - `teacher-form.tsx` dagi `minLength` (brauzer tekshiruvi)
 *   - `isStrongInitialPassword` (Excel import orqali hisob yaratish)
 *
 * Ya'ni tizimda parol qoidasi IKKINCHI nusxada yozilmagan.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * bcrypt 72 baytdan keyingi qismni JIMGINA tashlab yuboradi. 128 belgi
 * chegarasi shuning uchun ham kerak: foydalanuvchi "uzun parol qo'ydim" deb
 * o'ylab, amalda faqat boshlang'ich qismi ishlayotganini bilmay qolmasin.
 */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Eng ko'p uchraydigan zaif parollar. Hujumchi birinchi navbatda shularni
 * sinaydi, shuning uchun uzunligi yetarli bo'lsa ham ruxsat berilmaydi
 * (masalan "parolparolparol").
 *
 * Ro'yxat ataylab QISQA: uzun lug'at bu yerda emas, serverdagi urinish
 * cheklovi (rate-limit) bilan hal qilinadi. Bu yerda faqat eng ko'r-ko'rona
 * variantlar to'sib qo'yiladi.
 */
const WEAK_FRAGMENTS = [
  "password",
  "parol",
  "qwerty",
  "asdfgh",
  "zxcvbn",
  "iloveyou",
  "letmein",
  "welcome",
  "admin123",
  "123456",
  "654321",
  "abc123",
];

/** "aaaa", "1111" kabi 4 va undan ko'p bir xil belgi ketma-ket. */
function hasRepeatRun(value: string): boolean {
  let run = 1;
  for (let i = 1; i < value.length; i += 1) {
    if (value[i] === value[i - 1]) {
      run += 1;
      if (run >= 4) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

/** "12345", "edcba" kabi 5 va undan uzun ketma-ket oshib/kamayib boruvchi qator. */
function hasSequenceRun(value: string): boolean {
  let up = 1;
  let down = 1;
  for (let i = 1; i < value.length; i += 1) {
    const diff = value.charCodeAt(i) - value.charCodeAt(i - 1);
    up = diff === 1 ? up + 1 : 1;
    down = diff === -1 ? down + 1 : 1;
    if (up >= 5 || down >= 5) return true;
  }
  return false;
}

export const passwordSchema = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `Parol kamida ${MIN_PASSWORD_LENGTH} belgi bo'lishi kerak.`
  )
  .max(MAX_PASSWORD_LENGTH, "Parol juda uzun.")
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: "Parolda kamida bitta harf va bitta raqam bo'lishi kerak.",
  })
  .refine(
    (value) => {
      const plain = value.toLowerCase();
      return !WEAK_FRAGMENTS.some((fragment) => plain.includes(fragment));
    },
    {
      message:
        "Bu parol juda ko'p ishlatiladigan parollarga o'xshaydi. Boshqa parol tanlang.",
    }
  )
  .refine((value) => !hasRepeatRun(value), {
    message: "Parolda bir xil belgi ketma-ket 4 marta takrorlanmasligi kerak.",
  })
  .refine((value) => !hasSequenceRun(value.toLowerCase()), {
    message:
      "Parolda ketma-ket qator (masalan 12345 yoki abcde) bo'lmasligi kerak.",
  });

export type PasswordInput = z.infer<typeof passwordSchema>;

/** Yangi parolni tekshiradi. Xato bo'lsa xabar, to'g'ri bo'lsa null. */
export function passwordError(value: string): string | null {
  const parsed = passwordSchema.safeParse(value);
  if (parsed.success) return null;
  return parsed.error.issues[0]?.message ?? "Parol talabga mos emas.";
}

/**
 * Formalardagi qoida matni.
 *
 * Nega `messages/*.json` da emas: matn ichida `MIN_PASSWORD_LENGTH` raqami
 * bor. Agar u tarjima faylida qo'lda yozilsa, chegara o'zgarganda uch tilda
 * ham yangilash esdan chiqib, forma NOTO'G'RI qoidani ko'rsatib turardi
 * (foydalanuvchi "8 belgi yetadi" deb o'ylaydi, server rad etadi). Shu yerda
 * bitta manba — raqam avtomatik mos keladi.
 */
export function passwordRuleText(locale: string): string {
  const min = MIN_PASSWORD_LENGTH;
  if (locale === "ru") {
    return `Минимум ${min} символов, обязательно буква и цифра. Нельзя использовать распространённые пароли и последовательности (12345, qwerty).`;
  }
  if (locale === "en") {
    return `At least ${min} characters, with a letter and a digit. Common passwords and sequences (12345, qwerty) are not allowed.`;
  }
  return `Kamida ${min} belgi, ichida harf va raqam bo'lsin. Mashhur parollar va ketma-ket qatorlar (12345, qwerty) ishlatilmaydi.`;
}
