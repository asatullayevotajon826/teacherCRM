import { z } from "zod";
import { Locale, StudentStatus } from "@prisma/client";
import { MAX_IMPORT_ROWS, normalizeKey } from "./excel";
import { passwordSchema } from "./password";

/**
 * IMPORT BIZNES-QOIDALARI
 * =======================
 * Excel qatorini tizim tushunadigan yozuvga aylantirish, tekshirish va
 * commit (yozish) uchun sxemalar. Bu modul bazaga murojaat qilmaydi —
 * sinf/fan izlash va dublikat tekshiruvi action'larda bajariladi.
 *
 * Muhim: qo'lda qo'shish va import BIR XIL qoidaga tayanadi — shu sababli
 * yakuniy yozishdan oldin `studentWriteSchema` / `teacherWriteSchema` ham
 * ishlatiladi (action'lardagi commit qadamiga qarang).
 */

export type ImportMode = "skip" | "update";
export type PreviewStatus = "ready" | "duplicate" | "error";

export type ColumnDef = {
  field: string;
  /** Excel sarlavhasi sifatida qabul qilinadigan variantlar (uz/ru/en). */
  aliases: string[];
  required?: boolean;
};

function pick(values: Record<string, string>, def: ColumnDef): string {
  for (const alias of def.aliases) {
    const key = normalizeKey(alias);
    const value = values[key];
    if (value !== undefined && value !== "") return value.trim();
  }
  return "";
}

function knownKeys(columns: ColumnDef[]): Set<string> {
  const set = new Set<string>();
  columns.forEach((column) => {
    column.aliases.forEach((alias) => set.add(normalizeKey(alias)));
  });
  return set;
}

/** Shablonda bo'lmagan ustunlar — e'tiborsiz qoldiriladi, lekin ogohlantiramiz. */
export function findUnknownColumns(headers: string[], columns: ColumnDef[]): string[] {
  const known = knownKeys(columns);
  return headers.filter((header) => {
    const key = normalizeKey(header);
    return key !== "" && !known.has(key);
  });
}

/* ------------------------------------------------------------------ */
/* Umumiy normallashtiruvchilar                                        */
/* ------------------------------------------------------------------ */

/** "12.03.2010", "12/03/2010", "2010-03-12" → "2010-03-12". */
export function normalizeDate(value: string): string | null {
  const text = value.trim();
  if (text === "") return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }

  const dotted = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/.exec(text);
  if (dotted) {
    return `${dotted[3]}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}`;
  }

  return null;
}

function isRealDate(iso: string): boolean {
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === iso;
}

/** Telefonni bir ko'rinishga keltiradi: faqat raqam va boshdagi "+". */
export function normalizePhone(value: string): string {
  const text = value.trim();
  if (text === "") return "";
  const digits = text.replace(/[^\d]/g, "");
  if (digits === "") return "";
  return text.startsWith("+") || digits.length > 9 ? `+${digits}` : digits;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function matchOption(value: string, options: Record<string, string[]>): string | null {
  const key = normalizeKey(value);
  if (key === "") return null;
  for (const [result, variants] of Object.entries(options)) {
    if (variants.some((variant) => normalizeKey(variant) === key)) return result;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* O'QUVCHI                                                            */
/* ------------------------------------------------------------------ */

export const STUDENT_COLUMNS: ColumnDef[] = [
  { field: "lastName", required: true, aliases: ["Familiya", "Last name", "Фамилия"] },
  { field: "firstName", required: true, aliases: ["Ism", "First name", "Имя"] },
  {
    field: "dateOfBirth",
    aliases: ["Tug'ilgan sana", "Date of birth", "Дата рождения"],
  },
  { field: "gender", aliases: ["Jinsi", "Gender", "Пол"] },
  { field: "address", aliases: ["Manzil", "Address", "Адрес"] },
  { field: "className", aliases: ["Sinf", "Class", "Класс"] },
  { field: "status", aliases: ["Holat", "Status", "Статус"] },
  {
    field: "guardianName",
    aliases: ["Vasiy F.I.Sh.", "Vasiy", "Guardian name", "Ф.И.О. родителя", "Родитель"],
  },
  {
    field: "guardianPhone",
    aliases: ["Vasiy telefon", "Guardian phone", "Телефон родителя"],
  },
  {
    field: "guardianRelation",
    aliases: ["Qarindoshlik", "Relation", "Родство"],
  },
];

const GENDER_OPTIONS: Record<string, string[]> = {
  male: ["o'g'il", "ogil", "o'g'il bola", "erkak", "male", "m", "м", "мальчик", "мужской"],
  female: ["qiz", "qiz bola", "ayol", "female", "f", "ж", "девочка", "женский"],
};

const STUDENT_STATUS_OPTIONS: Record<string, string[]> = {
  ACTIVE: ["faol", "active", "активен", "актив"],
  GRADUATED: ["bitirgan", "graduated", "выпускник", "выпустился"],
  LEFT: ["chiqib ketgan", "ketgan", "left", "выбыл", "ушел"],
};

export type StudentImportRow = {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  gender?: "male" | "female";
  address?: string;
  className?: string;
  status: StudentStatus;
  guardianName?: string;
  guardianPhone?: string;
  guardianRelation?: string;
};

export type MappedRow<T> = { row: T | null; errors: string[]; warnings: string[] };

export function mapStudentRow(values: Record<string, string>): MappedRow<StudentImportRow> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const get = (field: string) => {
    const def = STUDENT_COLUMNS.find((column) => column.field === field);
    return def ? pick(values, def) : "";
  };

  const lastName = get("lastName");
  const firstName = get("firstName");
  if (lastName === "") errors.push("Familiya bo'sh.");
  if (firstName === "") errors.push("Ism bo'sh.");
  if (lastName.length > 80) errors.push("Familiya juda uzun (80 belgidan ko'p).");
  if (firstName.length > 80) errors.push("Ism juda uzun (80 belgidan ko'p).");

  let dateOfBirth: string | undefined;
  const rawDate = get("dateOfBirth");
  if (rawDate !== "") {
    const iso = normalizeDate(rawDate);
    if (!iso || !isRealDate(iso)) {
      errors.push(`Tug'ilgan sana formati noto'g'ri: "${rawDate}" (YYYY-MM-DD yoki KK.OO.YYYY).`);
    } else {
      dateOfBirth = iso;
    }
  }

  let gender: "male" | "female" | undefined;
  const rawGender = get("gender");
  if (rawGender !== "") {
    const matched = matchOption(rawGender, GENDER_OPTIONS);
    if (!matched) {
      warnings.push(`Jinsi tushunilmadi: "${rawGender}" — bo'sh qoldiriladi.`);
    } else {
      gender = matched as "male" | "female";
    }
  }

  let status: StudentStatus = StudentStatus.ACTIVE;
  const rawStatus = get("status");
  if (rawStatus !== "") {
    const matched = matchOption(rawStatus, STUDENT_STATUS_OPTIONS);
    if (!matched) {
      warnings.push(`Holat tushunilmadi: "${rawStatus}" — "faol" deb olinadi.`);
    } else {
      status = matched as StudentStatus;
    }
  }

  const address = get("address");
  const className = get("className");
  const guardianName = get("guardianName");
  const guardianPhone = normalizePhone(get("guardianPhone"));
  const guardianRelation = get("guardianRelation");

  if (guardianName !== "" && guardianPhone === "") {
    warnings.push("Vasiy telefoni yo'q — vasiy yozuvi yaratilmaydi.");
  }
  if (guardianName === "" && guardianPhone !== "") {
    warnings.push("Vasiy F.I.Sh. yo'q — vasiy yozuvi yaratilmaydi.");
  }

  if (errors.length > 0) return { row: null, errors, warnings };

  return {
    row: {
      firstName,
      lastName,
      dateOfBirth,
      gender,
      address: address === "" ? undefined : address.slice(0, 200),
      className: className === "" ? undefined : className,
      status,
      guardianName: guardianName === "" ? undefined : guardianName.slice(0, 200),
      guardianPhone: guardianPhone === "" ? undefined : guardianPhone.slice(0, 200),
      guardianRelation: guardianRelation === "" ? undefined : guardianRelation.slice(0, 200),
    },
    errors,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* O'QITUVCHI                                                          */
/* ------------------------------------------------------------------ */

export const TEACHER_COLUMNS: ColumnDef[] = [
  {
    field: "fullName",
    required: true,
    aliases: ["F.I.Sh.", "FISH", "Ism familiya", "Full name", "Ф.И.О.", "ФИО"],
  },
  { field: "email", aliases: ["Email", "E-mail", "Pochta", "Почта"] },
  { field: "phone", aliases: ["Telefon", "Phone", "Телефон"] },
  { field: "subjects", aliases: ["Fanlar", "Fan", "Subjects", "Предметы", "Предмет"] },
  {
    field: "locale",
    aliases: ["Interfeys tili", "Til", "Locale", "Language", "Язык"],
  },
  { field: "status", aliases: ["Holat", "Status", "Статус"] },
  {
    field: "password",
    aliases: ["Boshlang'ich parol", "Parol", "Password", "Пароль"],
  },
];

const LOCALE_OPTIONS: Record<string, string[]> = {
  uz: ["uz", "uzbek", "o'zbek", "ozbek", "узбекский"],
  ru: ["ru", "rus", "russian", "русский"],
  en: ["en", "eng", "english", "ingliz", "английский"],
};

const ACTIVE_OPTIONS: Record<string, string[]> = {
  yes: ["faol", "active", "ha", "yes", "1", "true", "активен", "да"],
  no: ["faolsiz", "nofaol", "inactive", "yo'q", "yoq", "no", "0", "false", "неактивен", "нет"],
};

export type TeacherImportRow = {
  fullName: string;
  email?: string;
  phone?: string;
  subjectNames: string[];
  locale: Locale;
  isActive: boolean;
  password?: string;
};

export function mapTeacherRow(values: Record<string, string>): MappedRow<TeacherImportRow> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const get = (field: string) => {
    const def = TEACHER_COLUMNS.find((column) => column.field === field);
    return def ? pick(values, def) : "";
  };

  const fullName = get("fullName");
  if (fullName === "") errors.push("F.I.Sh. bo'sh.");
  if (fullName.length > 120) errors.push("F.I.Sh. juda uzun (120 belgidan ko'p).");

  const email = normalizeEmail(get("email"));
  const phone = normalizePhone(get("phone"));

  if (email === "" && phone === "") {
    errors.push("Email yoki telefon — kamida bittasi kiritilishi kerak (login sifatida ishlatiladi).");
  }
  if (email !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.push(`Email formati noto'g'ri: "${email}".`);
  }
  if (phone !== "" && phone.replace(/[^\d]/g, "").length < 7) {
    errors.push(`Telefon raqami juda qisqa: "${phone}".`);
  }

  const subjectNames = get("subjects")
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (subjectNames.length > 30) {
    errors.push("Fanlar soni 30 dan oshmasligi kerak.");
  }

  let locale: Locale = Locale.uz;
  const rawLocale = get("locale");
  if (rawLocale !== "") {
    const matched = matchOption(rawLocale, LOCALE_OPTIONS);
    if (!matched) {
      warnings.push(`Til tushunilmadi: "${rawLocale}" — "uz" deb olinadi.`);
    } else {
      locale = matched as Locale;
    }
  }

  let isActive = true;
  const rawStatus = get("status");
  if (rawStatus !== "") {
    const matched = matchOption(rawStatus, ACTIVE_OPTIONS);
    if (!matched) {
      warnings.push(`Holat tushunilmadi: "${rawStatus}" — "faol" deb olinadi.`);
    } else {
      isActive = matched === "yes";
    }
  }

  /**
   * PAROL — QOIDA BITTA MANBADAN (G2b)
   *
   * Ilgari bu yerda qoida qo'lda takrorlangan edi: `length < 8 || harf yo'q ||
   * raqam yo'q`. Ya'ni forma 12 belgi talab qilganda import 8 belgini
   * "tayyor" deb ko'rsatardi. Endi tekshiruv `passwordSchema` ning o'zi —
   * xato matni ham shundan olinadi, shuning uchun chegara o'zgarsa bu yerda
   * yangilash kerak bo'lmaydi (unutish ehtimoli nolga tushadi).
   */
  let password: string | undefined;
  const rawPassword = get("password");
  if (rawPassword !== "") {
    const checked = passwordSchema.safeParse(rawPassword);
    if (!checked.success) {
      const reason =
        checked.error.issues[0]?.message ?? "Parol siyosatiga mos emas.";
      errors.push(`${reason} Yoki ustunni bo'sh qoldiring — tizim o'zi kuchli parol yasaydi.`);
    } else {
      password = rawPassword;
    }
  }

  if (errors.length > 0) return { row: null, errors, warnings };

  return {
    row: {
      fullName,
      email: email === "" ? undefined : email,
      phone: phone === "" ? undefined : phone,
      subjectNames,
      locale,
      isActive,
      password,
    },
    errors,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Boshlang'ich parol generatori                                       */
/* ------------------------------------------------------------------ */

/**
 * Adashtiruvchi belgilar (l, o, 0, 1) ataylab kiritilmagan — parol qo'lda
 * yoki qog'ozdan ko'chiriladi.
 *
 * Alifbo uzunligi 32 (24 harf + 8 raqam) — 256 ga butun bo'linadi, ya'ni
 * `bayt % 32` da modulo qoldiq bias'i yo'q.
 */
const PASSWORD_LETTERS = "abcdefghijkmnpqrstuvwxyz";
const PASSWORD_DIGITS = "23456789";
const PASSWORD_ALPHABET = PASSWORD_LETTERS + PASSWORD_DIGITS;

/** Har bir belgi ~5 bit → 12 belgi ≈ 60 bit. */
export const INITIAL_PASSWORD_LENGTH = 12;

/**
 * Bir tekis taqsimlangan tasodifiy indeks.
 *
 * NIMA UCHUN REJECTION SAMPLING: `bayt % 24` da 0..15 oralig'idagi harflar
 * qolganlaridan ko'proq chiqadi (256 = 10*24 + 16). Bu taqsimotni qiyshaytiradi
 * va parolni taxmin qilishni osonlashtiradi. Shuning uchun oxirgi to'liq
 * bo'lmagan blokka tushgan baytni rad etib, qaytadan olamiz.
 */
function randomIndex(limit: number): number {
  const ceiling = Math.floor(256 / limit) * limit;
  const byte = new Uint8Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(byte);
    if (byte[0] < ceiling) return byte[0] % limit;
  }
}

function randomChar(alphabet: string): string {
  return alphabet[randomIndex(alphabet.length)];
}

/**
 * Excel'da parol ustuni bo'sh bo'lsa ishlatiladi.
 * Natija `passwordSchema` talabiga mos: 12 belgi, harf va raqam bor, lug'at
 * va naqsh tekshiruvlaridan o'tadi (tasodifiy belgilar).
 *
 * OLDINGI NUSXADAGI NUQSONLAR (tuzatildi):
 *
 *   1. Qat'iy `Maktab` prefiksi. Bir bitga ham entropiya qo'shmasdi, lekin
 *      formatni oshkor qilardi: bitta parolni ko'rgan odam qolganlarining
 *      ham shu prefiks bilan boshlanishini bilib olardi va taxmin maydonini
 *      faqat tasodifiy qismga qisqartirardi.
 *   2. Oxirgi raqam `bytes[0] % 10` edi — birinchi harf ham SHU BAYTdan
 *      (`bytes[0] % 32`) olinardi. Ya'ni raqam mustaqil emas: birinchi harfni
 *      bilgan odam uchun raqam variantlari keskin kamayardi.
 *   3. Umumiy kuch ~40 bit edi. Endi ~60 bit.
 *
 * Kamida bitta harf va bitta raqam KAFOLATLANADI (aks holda tasodifan faqat
 * harflardan iborat parol chiqib `passwordSchema` ni buzishi mumkin edi), lekin
 * ular aralashtiriladi — qat'iy pozitsiyada qolsa yana format oshkor bo'lardi.
 */
export function generateInitialPassword(): string {
  const chars = [randomChar(PASSWORD_LETTERS), randomChar(PASSWORD_DIGITS)];
  while (chars.length < INITIAL_PASSWORD_LENGTH) {
    chars.push(randomChar(PASSWORD_ALPHABET));
  }

  // Fisher-Yates: kafolatlangan harf va raqam boshida turib qolmasin.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    const swap = chars[i];
    chars[i] = chars[j];
    chars[j] = swap;
  }

  return chars.join("");
}

/* ------------------------------------------------------------------ */
/* Ko'rib chiqish (preview) va commit sxemalari                        */
/* ------------------------------------------------------------------ */

export type PreviewRow<T> = {
  rowNumber: number;
  status: PreviewStatus;
  /** Foydalanuvchiga ko'rsatiladigan nom ("Karimov Ali"). */
  label: string;
  /** Qo'shimcha ustun (sinf / aloqa). */
  detail: string;
  messages: string[];
  /** Faqat status "ready" yoki "duplicate" bo'lganda to'ldiriladi. */
  row: T | null;
  /** Dublikat topilgan mavjud yozuv id'si. */
  existingId: string | null;
};

export type PreviewResult<T> = {
  fileName: string;
  total: number;
  ready: number;
  duplicates: number;
  errors: number;
  unknownColumns: string[];
  rows: PreviewRow<T>[];
};

export type ImportOutcome = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  messages: string[];
  /** Yangi yaratilgan o'qituvchi hisoblarining bir martalik parollari. */
  credentials: { name: string; login: string; password: string }[];
};

const studentCommitRowSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  dateOfBirth: z.string().optional(),
  gender: z.enum(["male", "female"]).optional(),
  address: z.string().max(200).optional(),
  className: z.string().max(200).optional(),
  status: z.nativeEnum(StudentStatus),
  guardianName: z.string().max(200).optional(),
  guardianPhone: z.string().max(200).optional(),
  guardianRelation: z.string().max(200).optional(),
  existingId: z.string().min(1).nullable().optional(),
});

export const studentImportPayloadSchema = z.object({
  mode: z.enum(["skip", "update"]),
  fileName: z.string().max(200).optional(),
  rows: z.array(studentCommitRowSchema).min(1).max(MAX_IMPORT_ROWS),
});

const teacherCommitRowSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  fullName: z.string().min(1).max(120),
  email: z.string().max(190).optional(),
  phone: z.string().max(30).optional(),
  subjectNames: z.array(z.string().max(120)).max(30),
  locale: z.nativeEnum(Locale),
  isActive: z.boolean(),
  /**
   * Klientdan kelgan parol SXEMA DARAJASIDA ham siyosatdan o'tadi (G2b).
   * Ilgari bu yerda `z.string().min(8).max(128)` turardi — ya'ni qo'lda
   * yasalgan so'rov bilan zaif parol sxemadan o'tib ketardi va faqat
   * keyingi qatlamda to'xtatilardi. Endi birinchi darvozada to'xtaydi.
   */
  password: passwordSchema.optional(),
  existingId: z.string().min(1).nullable().optional(),
});

export const teacherImportPayloadSchema = z.object({
  mode: z.enum(["skip", "update"]),
  fileName: z.string().max(200).optional(),
  rows: z.array(teacherCommitRowSchema).min(1).max(MAX_IMPORT_ROWS),
});

export type StudentCommitRow = z.infer<typeof studentCommitRowSchema>;
export type TeacherCommitRow = z.infer<typeof teacherCommitRowSchema>;

/* ------------------------------------------------------------------ */
/* Shablon fayllari                                                    */
/* ------------------------------------------------------------------ */

export const STUDENT_TEMPLATE_HEADERS = [
  "Familiya",
  "Ism",
  "Tug'ilgan sana",
  "Jinsi",
  "Manzil",
  "Sinf",
  "Holat",
  "Vasiy F.I.Sh.",
  "Vasiy telefon",
  "Qarindoshlik",
];

export const STUDENT_TEMPLATE_SAMPLE = [
  "Karimov",
  "Ali",
  "2010-03-12",
  "o'g'il",
  "Toshkent sh., Chilonzor 5",
  "9-A",
  "faol",
  "Karimov Bahodir",
  "+998901234567",
  "ota",
];

export const TEACHER_TEMPLATE_HEADERS = [
  "F.I.Sh.",
  "Email",
  "Telefon",
  "Fanlar",
  "Interfeys tili",
  "Holat",
  "Boshlang'ich parol",
];

export const TEACHER_TEMPLATE_SAMPLE = [
  "Tursunova Madina",
  "madina@maktab.uz",
  "+998901234567",
  "Matematika, Fizika",
  "uz",
  "faol",
  "",
];
