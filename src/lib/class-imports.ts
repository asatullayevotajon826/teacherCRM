import { z } from "zod";
import { MAX_IMPORT_ROWS, normalizeKey } from "./excel";
import { GRADES } from "./classes";
import type { ColumnDef, MappedRow } from "./imports";

/**
 * SINFLARNI EXCEL'DAN IMPORT — BIZNES QOIDALARI
 * ============================================
 * Bu modul bazaga murojaat qilmaydi: faqat Excel qatorini tushunarli
 * ma'lumotga aylantiradi va tekshiradi. O'quv yili / sinf rahbari izlash va
 * dublikat aniqlash `classes/import/actions.ts` da bajariladi.
 *
 * O'quvchi va o'qituvchi importi bilan bir xil naqsh: `imports.ts` dagi
 * `ColumnDef` va `MappedRow` tiplaridan foydalanamiz.
 */

export const CLASS_COLUMNS: ColumnDef[] = [
  {
    field: "name",
    required: true,
    aliases: [
      "Sinf nomi",
      "Sinf",
      "Class",
      "Class name",
      "Класс",
      "Название класса",
    ],
  },
  {
    field: "grade",
    aliases: ["Parallel", "Sinf raqami", "Grade", "Параллель"],
  },
  {
    field: "academicYear",
    aliases: ["O'quv yili", "Academic year", "Учебный год"],
  },
  {
    field: "homeroomTeacher",
    aliases: [
      "Sinf rahbari",
      "Homeroom teacher",
      "Классный руководитель",
    ],
  },
];

/** GRADES readonly tuple — solishtirish uchun oddiy massivga ko'chiramiz. */
const GRADE_VALUES: number[] = [...GRADES];

function pick(values: Record<string, string>, def: ColumnDef): string {
  for (const alias of def.aliases) {
    const value = values[normalizeKey(alias)];
    if (value !== undefined && value !== "") return value.trim();
  }
  return "";
}

export type ClassImportRow = {
  name: string;
  grade: number;
  /** Excel'da yozilgan o'quv yili nomi (bo'sh bo'lsa joriy yil olinadi). */
  academicYearName?: string;
  /** Sinf rahbari: email, telefon yoki F.I.Sh. */
  homeroomTeacher?: string;
};

/**
 * "9-A" → 9. Parallel ustuni bo'sh qolsa, sinf nomining boshidagi raqamdan
 * aniqlanadi — amalda maktablar ustunni ko'p hollarda to'ldirmaydi.
 */
function gradeFromName(name: string): number | null {
  const matched = /^\s*(\d{1,2})/.exec(name);
  if (!matched) return null;
  const value = Number(matched[1]);
  return Number.isInteger(value) ? value : null;
}

export function mapClassRow(
  values: Record<string, string>
): MappedRow<ClassImportRow> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const get = (field: string) => {
    const def = CLASS_COLUMNS.find((column) => column.field === field);
    return def ? pick(values, def) : "";
  };

  const name = get("name");
  if (name === "") errors.push("Sinf nomi bo'sh.");
  if (name.length > 40) errors.push("Sinf nomi juda uzun (40 belgidan ko'p).");

  let grade: number | null = null;
  const rawGrade = get("grade");
  if (rawGrade !== "") {
    const parsed = Number(rawGrade.replace(/[^\d]/g, ""));
    grade = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    if (grade === null) {
      errors.push(`Parallel raqami tushunilmadi: "${rawGrade}".`);
    }
  } else if (name !== "") {
    grade = gradeFromName(name);
    if (grade === null) {
      errors.push(
        "Parallel ustuni bo'sh va sinf nomidan aniqlanmadi (masalan \"9-A\" deb yozing yoki Parallel ustunini to'ldiring)."
      );
    } else {
      warnings.push(`Parallel sinf nomidan olindi: ${grade}.`);
    }
  }

  if (grade !== null && !GRADE_VALUES.includes(grade)) {
    errors.push(
      `Parallel ${GRADE_VALUES[0]}–${GRADE_VALUES[GRADE_VALUES.length - 1]} oralig'ida bo'lishi kerak (kelgan qiymat: ${grade}).`
    );
  }

  const academicYearName = get("academicYear");
  const homeroomTeacher = get("homeroomTeacher");

  if (errors.length > 0 || grade === null) {
    return { row: null, errors, warnings };
  }

  return {
    row: {
      name,
      grade,
      academicYearName: academicYearName === "" ? undefined : academicYearName,
      homeroomTeacher: homeroomTeacher === "" ? undefined : homeroomTeacher,
    },
    errors,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Commit sxemasi                                                      */
/* ------------------------------------------------------------------ */

/**
 * Brauzerdan kelgan qatorlar. Bog'liq yozuvlar (o'quv yili, rahbar)
 * preview qadamida id'ga aylantirilgan bo'ladi, lekin commit paytida
 * ularning mavjudligi qaytadan tekshiriladi.
 *
 * PARALLEL CHEGARASI (tuzatilgan nuqson): bu sxema ilgari `min(1).max(20)`
 * deb yozilgan edi, holbuki formadagi `classWriteSchema` faqat `GRADES`
 * (1–11) ni qabul qiladi. Ya'ni `preview` ni chetlab o'tib to'g'ridan-to'g'ri
 * `commit` ga qo'lda yasalgan payload yuborsa, 12–20 parallelli sinf
 * yaratish mumkin edi. Bunday sinfni keyin formada tahrirlash IMKONSIZ
 * bo'lardi (validatsiya o'tmaydi) va reyting "parallel" qamrovi kutilmagan
 * guruhni hisoblab qolardi.
 *
 * Endi chegara `GRADES` ning o'zidan olinadi — ro'yxat o'zgarsa ikki joyni
 * qo'lda moslashtirish kerak bo'lmaydi.
 *
 * O'QUV YILI MAJBURIY (PR F2): ilgari `nullable().optional()` edi va
 * `commit` bosqichi `academicYearId: null` bilan sinf yaratardi. Bunday
 * sinf sxemadagi @@unique([name, academicYearId]) qoidasidan CHETDA qolardi
 * (NULL o'zi bilan teng emas) — ya'ni import har safar ishga tushganda
 * bir xil nomli yangi "9-A" qo'shilaverardi. Endi baza ustuni ham NOT NULL.
 */
const classCommitRowSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  name: z.string().min(1).max(40),
  grade: z
    .number()
    .int()
    .refine((value) => GRADE_VALUES.includes(value), {
      message: "Parallel ruxsat etilgan ro'yxatda yo'q.",
    }),
  academicYearId: z.string().min(1),
  homeroomTeacherId: z.string().min(1).nullable().optional(),
  existingId: z.string().min(1).nullable().optional(),
});

export const classImportPayloadSchema = z.object({
  mode: z.enum(["skip", "update"]),
  fileName: z.string().max(200).optional(),
  rows: z.array(classCommitRowSchema).min(1).max(MAX_IMPORT_ROWS),
});

export type ClassCommitRow = z.infer<typeof classCommitRowSchema>;

/* ------------------------------------------------------------------ */
/* Shablon                                                             */
/* ------------------------------------------------------------------ */

export const CLASS_TEMPLATE_HEADERS = [
  "Sinf nomi",
  "Parallel",
  "O'quv yili",
  "Sinf rahbari",
];

export const CLASS_TEMPLATE_SAMPLE = [
  "9-A",
  "9",
  "2025-2026",
  "madina@maktab.uz",
];
