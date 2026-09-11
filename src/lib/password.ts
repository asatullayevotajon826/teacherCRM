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
 * NEGA 8 DAN 12 GA OSHIRILDI (PR G1)
 * ----------------------------------
 * Tizimda o'quvchilarning bahosi, reytingi, ota-ona telefoni va shartnoma
 * summasi bor — ya'ni hisob buzilsa shaxsiy ma'lumot sizib chiqadi.
 *
 * 8 belgili parol bugungi kunda **himoya emas**: xesh o'g'irlansa oddiy
 * videokarta bilan barcha 8 belgili variantlarni tekshirib chiqish mumkin.
 * 12 belgi bu vaqtni minglab barobar oshiradi. bcrypt (10 rounds) sekin
 * xeshlash bilan yordam beradi, lekin qisqa parolni qutqarmaydi.
 *
 * Uzunlik yetarli emas: eng ko'p ishlatiladigan parollar lug'atdan bir zumda
 * topiladi. Shuning uchun pastda 4 qatlam tekshiruv bor:
 *   1) uzunlik (12–128)
 *   2) harf + raqam birga
 *   3) mashhur/zaif parollar (lug'at hujumi)
 *   4) klaviatura va takror naqshlari ("aaaa", "123456", "qwerty")
 *
 * MUHIM: bu qoidalar TEKSHIRUV, sir emas. Parolning o'zi hech qayerga
 * yozilmaydi — na logga, na auditga (`audit.ts` redaksiya qiladi), na
 * xato xabariga.
 */

export const MIN_PASSWORD_LENGTH = 12;

/**
 * bcrypt 72 baytdan keyingi qismni JIMGINA tashlab yuboradi. 128 belgi
 * chegarasi shuning uchun ham kerak: foydalanuvchi "uzun parol qo'ydim" deb
 * o'ylab, amalda faqat boshlang'ich qismi ishlayotganini bilmay qolmasin.
 */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Eng ko'p uchraydigan zaif parollar. Hujumchi birinchi navbatda shularni
 * sinaydi, shuning uchun 12 belgidan uzun bo'lsa ham ruxsat berilmaydi
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
