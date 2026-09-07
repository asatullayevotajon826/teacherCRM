import { z } from "zod";
import { dateField, idField, toNumber } from "./academics";
import { ATTENDANCE_STATUSES, type AttendanceStatusValue } from "./attendance";
import { GRADE_MAX, GRADE_MIN, GRADE_TYPES } from "./grades";
import { denseRank } from "./scoring";

/**
 * KUNLIK JURNAL — VALIDATSIYA VA HISOB-KITOB
 * ==========================================
 *
 * Qog'oz jurnalning aynan o'zi, bir kun uchun:
 *
 *   | O'quvchi | Davomat | Matematika | Matematika 2 | Ona tili | ... | O'rtacha | O'rin |
 *
 * Ustunlar — SHU KUNNING DARSLARI. Bir fandan kunda ikki dars bo'lsa ikki
 * ustun chiqadi va ikkinchisi "Matematika 2" deb nomlanadi. Shu sababli baho
 * fanga emas, DARSGA bog'lanadi (`Grade.lessonId`).
 *
 * BAHO TURI (`type`): bitta jurnal ekrani uchta daftarni almashtiradi —
 * kundalik (DAILY), nazorat (CONTROL) va imtihon (EXAM). Tur formadan keladi
 * va serverda zod bilan tekshiriladi. Ilgari server har doim `DAILY` yozardi,
 * shuning uchun `/grades` sahifasidagi "nazorat" va "imtihon" filtrlari
 * abadiy bo'sh chiqardi (TZ 3.6 buzilgan edi).
 *
 * XAVFSIZLIK QOIDASI (egasining talabi): o'qituvchi FAQAT o'zi o'tadigan
 * dars ustuniga baho qo'yadi. Boshqa ustun inputi bloklanadi va tooltip
 * chiqadi. Lekin bu — shunchaki qulaylik: haqiqiy himoya serverda, chunki
 * bloklangan inputni brauzer konsolidan ochib qo'yish mumkin. Server
 * `gradingLessonScope` bilan o'z darslarini o'zi topadi va begona dars
 * ustuniga kelgan qiymatni jimgina tashlab yuboradi.
 *
 * DAVOMAT: `Attendance` darsga bog'langan, shuning uchun jurnaldagi yagona
 * "Davomat" ustuni foydalanuvchining SHU KUNDAGI O'Z darslariga yoziladi.
 * Ya'ni har bir o'qituvchi o'z darsining davomatini o'zi qiladi — va agar
 * o'quvchiga baho qo'yilsa, u avtomatik "keldi" deb belgilanadi (baho olgan
 * bola darsda bo'lgan).
 *
 * Bu fayl faqat ma'lumot shakli va hisob-kitob bilan shug'ullanadi.
 * "Bu odam shu darsga baho qo'yishi mumkinmi?" savoli — scope.ts
 * (`assertCanGradeClassSubject`, `gradingLessonScope`) mas'uliyatida.
 */

// ------------------------------------------------------------------
// Davomat qisqartmalari (kelishilgan: K / SZ / SL / KCH)
// ------------------------------------------------------------------

/**
 * Jadval katagiga yoziladigan qisqartmalar.
 *
 * Nima uchun qisqartma: davomat qiladigan kishi butun sinf uchun tez-tez
 * yozadi, "kelmadi (sababsiz)" deb yozib o'tirmaydi. Jadval tagidagi legenda
 * qisqartmalarning ma'nosini ko'rsatib turadi.
 */
export const ATTENDANCE_ABBREVIATIONS: Record<AttendanceStatusValue, string> = {
  PRESENT: "K",
  ABSENT: "SZ",
  EXCUSED: "SL",
  LATE: "KCH",
};

/** Legenda tartibi — ko'p uchraydigan holat birinchi. */
export const ATTENDANCE_LEGEND_ORDER: readonly AttendanceStatusValue[] = [
  "PRESENT",
  "ABSENT",
  "EXCUSED",
  "LATE",
];

export function abbreviationOf(status: AttendanceStatusValue): string {
  return ATTENDANCE_ABBREVIATIONS[status];
}

/**
 * Katakchaga yozilgan qisqartmani holatga aylantiradi.
 *
 * Katta-kichik harf va bo'sh joy farq qilmaydi ("k", " K " — hammasi keldi).
 * Tanish bo'lmagan matn `null` qaytaradi va bunday katakcha butunlay
 * e'tiborsiz qoldiriladi: xato qaytarish o'rniga jimgina tashlab yuborish
 * bu yerda to'g'ri, chunki forma to'g'ri ishlaganda bunday qiymat kelmaydi.
 */
export function statusFromAbbreviation(
  value: unknown
): AttendanceStatusValue | null {
  if (typeof value !== "string") return null;

  switch (value.trim().toUpperCase()) {
    case "K":
      return "PRESENT";
    case "SZ":
      return "ABSENT";
    case "SL":
      return "EXCUSED";
    case "KCH":
      return "LATE";
    default:
      return null;
  }
}

// ------------------------------------------------------------------
// Forma maydonlari
// ------------------------------------------------------------------

/** Baho katakchasi: "jg:<studentId>:<lessonId>". */
export const GRADE_FIELD_PREFIX = "jg:";

/** Davomat katakchasi: "ja:<studentId>". */
export const ATTENDANCE_FIELD_PREFIX = "ja:";

/** Katakcha kaliti — klient va server bir xil kalitdan foydalanadi. */
export function journalCellKey(studentId: string, lessonId: string): string {
  return `${studentId}|${lessonId}`;
}

// ------------------------------------------------------------------
// Ustun nomlari
// ------------------------------------------------------------------

export type LessonColumnInput = {
  id: string;
  subjectId: string;
  subjectName: string;
};

export type LessonColumn = LessonColumnInput & {
  /** Ustun sarlavhasi: "Matematika", "Matematika 2", "Matematika 3" ... */
  label: string;
  /** Shu fan kun ichida nechanchi marta uchradi. */
  occurrence: number;
};

/**
 * Dars ro'yxatini ustunlarga aylantiradi va takrorlangan fan nomini
 * raqamlab chiqadi.
 *
 * Darslar VAQT bo'yicha tartiblangan holda kelishi kerak — shunda "Matematika"
 * ertalabki dars, "Matematika 2" keyingi dars bo'ladi. Aks holda raqamlar
 * jadvaldagi tartibga mos kelmaydi.
 */
export function buildLessonColumns(
  lessons: LessonColumnInput[]
): LessonColumn[] {
  const seen = new Map<string, number>();

  return lessons.map((lesson) => {
    const occurrence = (seen.get(lesson.subjectId) ?? 0) + 1;
    seen.set(lesson.subjectId, occurrence);

    return {
      ...lesson,
      occurrence,
      label:
        occurrence === 1
          ? lesson.subjectName
          : `${lesson.subjectName} ${occurrence}`,
    };
  });
}

// ------------------------------------------------------------------
// Saqlash sxemasi
// ------------------------------------------------------------------

/**
 * Baho turini tozalaydi. Bo'sh yoki noma'lum qiymat kelsa `DAILY` —
 * jurnalning sukutdagi holati. Katta-kichik harf farq qilmaydi.
 *
 * Diqqat: bu yerda `null` qaytarilmaydi, chunki tur MAJBURIY maydon. Noto'g'ri
 * turni jimgina `DAILY` ga aylantirish xato qaytarishdan xavfsizroq: aks holda
 * eski (turi yo'q) forma yuborilganda saqlash butunlay ishlamay qolardi.
 */
function toGradeType(value: unknown): unknown {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string") return "DAILY";

  const text = first.trim().toUpperCase();
  return GRADE_TYPES.some((type) => type === text) ? text : "DAILY";
}

function toJournalInput(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;

  const source = raw as Record<string, unknown>;

  const grades: Array<{
    studentId: string;
    lessonId: string;
    value: unknown;
  }> = [];
  const attendance: Array<{ studentId: string; status: unknown }> = [];

  for (const [key, value] of Object.entries(source)) {
    const first = Array.isArray(value) ? value[0] : value;
    const text = typeof first === "string" ? first.trim() : first;

    if (key.startsWith(GRADE_FIELD_PREFIX)) {
      const parts = key.slice(GRADE_FIELD_PREFIX.length).split(":");
      if (parts.length !== 2) continue;

      const studentId = parts[0].trim();
      const lessonId = parts[1].trim();
      if (studentId === "" || lessonId === "") continue;

      // Bo'sh katakcha = bahoni O'CHIRISH.
      grades.push({
        studentId,
        lessonId,
        value: text === "" || text === undefined ? null : text,
      });
      continue;
    }

    if (key.startsWith(ATTENDANCE_FIELD_PREFIX)) {
      const studentId = key.slice(ATTENDANCE_FIELD_PREFIX.length).trim();
      if (studentId === "") continue;

      const status = statusFromAbbreviation(text);
      // Bo'sh yoki tanish bo'lmagan qisqartma — davomat o'zgartirilmaydi.
      if (status === null) continue;

      attendance.push({ studentId, status });
    }
  }

  return {
    classId: source.classId,
    date: source.date,
    type: source.type,
    grades,
    attendance,
  };
}

/**
 * Jurnalni saqlash sxemasi.
 *
 * `max` chegaralari Server Action'ga qo'lda yuborilgan katta so'rovdan
 * himoya qiladi: 30 o'quvchi × ~8 dars ≈ 240 katakcha, shuning uchun 900
 * yetarlicha keng, lekin cheksiz emas.
 */
export const journalSaveSchema = z.preprocess(
  toJournalInput,
  z.object({
    classId: idField,
    date: dateField,
    type: z.preprocess(toGradeType, z.enum(GRADE_TYPES)),
    grades: z
      .array(
        z.object({
          studentId: z.string().min(1),
          lessonId: z.string().min(1),
          value: z.union([
            z.null(),
            z.preprocess(
              toNumber,
              z.number().int().min(GRADE_MIN).max(GRADE_MAX)
            ),
          ]),
        })
      )
      .max(900),
    attendance: z
      .array(
        z.object({
          studentId: z.string().min(1),
          status: z.enum(ATTENDANCE_STATUSES),
        })
      )
      .max(300),
  })
);

export type JournalSaveInput = z.infer<typeof journalSaveSchema>;

// ------------------------------------------------------------------
// Reyting (o'rin)
// ------------------------------------------------------------------

export type RankRow = { id: string; average: number | null };

/**
 * O'rtacha ball bo'yicha o'rin belgilaydi.
 *
 * Mantiqning o'zi `./scoring` dagi `denseRank` da — ilgari shu yerda
 * `ranking.ts` dagi `rankByScore` ning deyarli aynan nusxasi turgan edi.
 * Bu yerda faqat jurnal sahifasi kutgan SHAKL yasaladi: `Map` emas, oddiy
 * obyekt, va o'rinsiz qolganlar umuman kalit sifatida bo'lmaydi.
 *
 * Qoidalar (`denseRank` da tushuntirilgan):
 *   - baho umuman yo'q o'quvchi o'rinsiz qoladi;
 *   - teng ballar TENG o'rin oladi;
 *   - o'rinlar UZILMAYDI: 95, 95, 90, 85 → 1, 1, 2, 3.
 *
 * `topN` berilsa faqat dastlabki N DARAJA belgilanadi — bir darajada bir
 * necha bola bo'lishi mumkin, ya'ni N dan ko'p bola chiqishi normal.
 */
export function rankByAverage(
  rows: RankRow[],
  topN?: number | null
): Record<string, number> {
  const ranked = denseRank(
    rows.map((row) => ({ id: row.id, value: row.average })),
    topN
  );

  const result: Record<string, number> = {};
  ranked.forEach((place, id) => {
    result[id] = place;
  });

  return result;
}

/**
 * "7" → 7, "" yoki axlat → null (searchParams ishonchsiz manba).
 *
 * Yagona manba `./scoring`. Ilgari shu yerda alohida nusxa bor edi va u
 * `ranking.ts` dagi nusxadan FARQ QILARDI: kasr son (`"7.9"`) bu yerda
 * `null` bo'lib, chegara butunlay olib tashlanardi. Endi ikki sahifa bir xil
 * qoidaga bo'ysunadi.
 */
export { parseTopN } from "./scoring";
