"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { createAction } from "@/lib/safe-action";
import { describeErrorSafely } from "@/lib/audit";
import { logError } from "@/lib/logger";
import { checkImportHeaders } from "@/lib/import-guards";
import { PREVIEW_RATE_LIMIT_MESSAGE, allowImportPreview } from "@/lib/import-preview-limit";
import {
  loadValidAcademicYearIds,
  loadValidClassIds,
  loadValidTeacherIds,
} from "@/lib/import-commit-guards";
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  isAllowedExcelFile,
  normalizeKey,
  parseExcel,
} from "@/lib/excel";
import {
  STUDENT_TEMPLATE_HEADERS,
  findUnknownColumns,
  type ImportOutcome,
  type PreviewResult,
  type PreviewRow,
} from "@/lib/imports";
import {
  CLASS_COLUMNS,
  classImportPayloadSchema,
  mapClassRow,
  type ClassCommitRow,
} from "@/lib/class-imports";

/**
 * SINFLARNI EXCEL'DAN IMPORT (faqat ADMIN)
 * ========================================
 * Ikki qadam:
 *   1. previewClassImport — faylni o'qiydi va tekshiradi, HECH NARSA yozmaydi.
 *   2. commitClassImport  — admin tasdiqlagan qatorlarni bazaga yozadi.
 *
 * Dublikat mezoni: bir o'quv yilida bir xil nomdagi sinf (schema'dagi
 * @@unique([name, academicYearId]) bilan bir xil qoida).
 *
 * XAVFSIZLIK — TUZATILGAN NUQSON: `commit` ga kelgan `academicYearId`,
 * `homeroomTeacherId` va `existingId` fayldan emas, BRAUZERDAN keladi.
 * Ilgari ular qaytadan tekshirilmasdi (izohda "tekshiriladi" deb yozilgan
 * bo'lsa ham), ya'ni qo'lda yasalgan so'rov sinfni istalgan o'quv yiliga
 * yoki istalgan o'qituvchiga bog'lab qo'yishi mumkin edi. Endi har bir id
 * yozishdan oldin bazada mavjudligi bilan solishtiriladi.
 *
 * O'QUV YILI MAJBURIY (PR F2): ilgari joriy o'quv yili belgilanmagan bo'lsa
 * import sinfni YILSIZ yaratardi (faqat ogohlantirish yozib). Bunday sinf
 * takrorlanishga qarshi cheklovdan chetda qolardi. Endi bunday qator
 * "xato" deb belgilanadi va umuman yozilmaydi.
 *
 * CHEKLOV VA QAYD ETISH (PR G3b): PR G2b preview cheklovini, PR G3 esa
 * xatolarni qayd etishni o'quvchi va o'qituvchi importiga qo'shgan edi —
 * lekin AYNAN SHU FAYL ikkisida ham chetda qolgan. Ya'ni sinf importi
 * uchinchi oqim bo'lib, cheklovsiz va izsiz ishlab turgan edi. Shu bilan
 * uchta import oqimining hammasi bir xil qoidaga keltirildi.
 */

export type ClassPreviewState =
  | { ok: true; data: PreviewResult<ClassCommitRow> }
  | { ok: false; error: string };

export type ClassCommitState =
  | { ok: true; data: ImportOutcome }
  | { ok: false; error: string };

/** Sinf kaliti: nom + o'quv yili. */
function classKey(name: string, academicYearId: string | null) {
  return `${normalizeKey(name)}|${academicYearId ?? ""}`;
}

/* ------------------------------------------------------------------ */
/* 1-qadam: ko'rib chiqish                                             */
/* ------------------------------------------------------------------ */

export async function previewClassImport(
  _prev: ClassPreviewState | null,
  formData: FormData
): Promise<ClassPreviewState> {
  const user = await requireAdmin();

  // So'rov cheklovi: bu qadam `createAction` dan o'tmaydi (u FormData va
  // fayl bilan ishlamaydi), shuning uchun cheklov ochiq qolgan edi —
  // sababi `import-preview-limit.ts` da batafsil yozilgan. Sinf preview'i
  // ham bazadan BARCHA sinf, o'quv yili va o'qituvchi ro'yxatini tortadi,
  // ya'ni boshqa importlar bilan bir xil darajada "qimmat" amal.
  if (!(await allowImportPreview(user.id))) {
    logError("import:class:preview", new Error("preview cheklovi ishga tushdi"), {
      stage: "rateLimit",
      userId: user.id,
    });
    return { ok: false, error: PREVIEW_RATE_LIMIT_MESSAGE };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Fayl tanlanmadi." };
  }
  if (!isAllowedExcelFile(file.name)) {
    return { ok: false, error: "Faqat Excel fayl qabul qilinadi (.xlsx yoki .xls)." };
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, error: "Fayl hajmi 5 MB dan oshmasligi kerak." };
  }

  let parsed;
  try {
    parsed = parseExcel(await file.arrayBuffer());
  } catch (error) {
    // Fayl nomi log'ga yozilmaydi (foydalanuvchi matni) — faqat hajmi.
    logError("import:class:preview", error, {
      stage: "parse",
      userId: user.id,
      fileSize: file.size,
    });
    return { ok: false, error: "Faylni o'qib bo'lmadi. U Excel fayl ekanini tekshiring." };
  }

  if (parsed.rows.length === 0) {
    return {
      ok: false,
      error: "Faylda ma'lumot topilmadi. Birinchi qator ustun sarlavhalari bo'lishi kerak.",
    };
  }
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `Bir faylda ${MAX_IMPORT_ROWS} qatorgacha bo'lishi mumkin. Faylni bo'laklab yuklang.`,
    };
  }

  const headerError = checkImportHeaders({
    headers: parsed.headers,
    columns: CLASS_COLUMNS,
    otherTemplateHeaders: STUDENT_TEMPLATE_HEADERS,
    otherTemplateName: "o'quvchilar",
  });
  if (headerError) {
    return { ok: false, error: headerError };
  }

  const [years, teachers, existingClasses] = await Promise.all([
    db.academicYear.findMany({ select: { id: true, name: true, isCurrent: true } }),
    db.teacher.findMany({
      select: {
        id: true,
        user: { select: { fullName: true, email: true, phone: true } },
      },
    }),
    db.class.findMany({ select: { id: true, name: true, academicYearId: true } }),
  ]);

  const yearMap = new Map<string, string>();
  years.forEach((year) => yearMap.set(normalizeKey(year.name), year.id));
  const currentYearId = years.find((year) => year.isCurrent)?.id ?? null;

  // Rahbarni email, telefon yoki F.I.Sh. bo'yicha topamiz.
  const teacherMap = new Map<string, string>();
  teachers.forEach((teacher) => {
    const keys = [
      teacher.user.email ?? "",
      teacher.user.phone ?? "",
      teacher.user.fullName,
    ];
    keys.forEach((key) => {
      const normalized = normalizeKey(key);
      if (normalized !== "" && !teacherMap.has(normalized)) {
        teacherMap.set(normalized, teacher.id);
      }
    });
  });

  const existingMap = new Map<string, string>();
  existingClasses.forEach((klass) => {
    existingMap.set(classKey(klass.name, klass.academicYearId), klass.id);
  });

  const seenInFile = new Map<string, number>();

  const rows: PreviewRow<ClassCommitRow>[] = parsed.rows.map((sheetRow) => {
    const mapped = mapClassRow(sheetRow.values);
    const messages = [...mapped.errors, ...mapped.warnings];

    if (!mapped.row) {
      return {
        rowNumber: sheetRow.rowNumber,
        status: "error" as const,
        label: "—",
        detail: "",
        messages,
        row: null,
        existingId: null,
      };
    }

    const data = mapped.row;
    const label = data.name;

    // O'quv yili: yozilgan bo'lsa aniq topilishi shart, aks holda joriy yil.
    // Ikkalasi ham bo'lmasa — qator YOZILMAYDI (PR F2).
    let academicYearId: string;
    if (data.academicYearName) {
      const found = yearMap.get(normalizeKey(data.academicYearName));
      if (!found) {
        return {
          rowNumber: sheetRow.rowNumber,
          status: "error" as const,
          label,
          detail: data.academicYearName,
          messages: [
            ...messages,
            `O'quv yili topilmadi: "${data.academicYearName}". Avval "O'quv yillari" bo'limida yarating yoki ustunni bo'sh qoldiring.`,
          ],
          row: null,
          existingId: null,
        };
      }
      academicYearId = found;
    } else if (currentYearId === null) {
      return {
        rowNumber: sheetRow.rowNumber,
        status: "error" as const,
        label,
        detail: "",
        messages: [
          ...messages,
          "O'quv yili ustuni bo'sh va joriy o'quv yili belgilanmagan. \"O'quv yillari\" bo'limida joriy yilni belgilang yoki ustunni to'ldiring.",
        ],
        row: null,
        existingId: null,
      };
    } else {
      academicYearId = currentYearId;
      messages.push("O'quv yili ustuni bo'sh — joriy o'quv yili olinadi.");
    }

    let homeroomTeacherId: string | null = null;
    if (data.homeroomTeacher) {
      const found = teacherMap.get(normalizeKey(data.homeroomTeacher));
      if (!found) {
        return {
          rowNumber: sheetRow.rowNumber,
          status: "error" as const,
          label,
          detail: data.homeroomTeacher,
          messages: [
            ...messages,
            `Sinf rahbari topilmadi: "${data.homeroomTeacher}". Email, telefon yoki F.I.Sh. ni o'qituvchilar ro'yxatidagidek yozing.`,
          ],
          row: null,
          existingId: null,
        };
      }
      homeroomTeacherId = found;
    }

    const key = classKey(data.name, academicYearId);
    const duplicateOfRow = seenInFile.get(key);
    const existingId = existingMap.get(key) ?? null;

    const yearLabel =
      years.find((year) => year.id === academicYearId)?.name ?? "—";
    const detail = [`${data.grade}-parallel`, yearLabel, data.homeroomTeacher ?? ""]
      .filter((part) => part !== "")
      .join(" · ");

    const commitRow: ClassCommitRow = {
      rowNumber: sheetRow.rowNumber,
      name: data.name,
      grade: data.grade,
      academicYearId,
      homeroomTeacherId,
      existingId,
    };

    if (duplicateOfRow) {
      return {
        rowNumber: sheetRow.rowNumber,
        status: "error" as const,
        label,
        detail,
        messages: [
          ...messages,
          `Fayl ichida takrorlangan (${duplicateOfRow}-qator bilan bir xil).`,
        ],
        row: null,
        existingId,
      };
    }

    seenInFile.set(key, sheetRow.rowNumber);

    if (existingId) {
      return {
        rowNumber: sheetRow.rowNumber,
        status: "duplicate" as const,
        label,
        detail,
        messages: [...messages, "Bu o'quv yilida shu nomdagi sinf allaqachon bor."],
        row: commitRow,
        existingId,
      };
    }

    return {
      rowNumber: sheetRow.rowNumber,
      status: "ready" as const,
      label,
      detail,
      messages,
      row: commitRow,
      existingId: null,
    };
  });

  return {
    ok: true,
    data: {
      fileName: file.name,
      total: rows.length,
      ready: rows.filter((row) => row.status === "ready").length,
      duplicates: rows.filter((row) => row.status === "duplicate").length,
      errors: rows.filter((row) => row.status === "error").length,
      unknownColumns: findUnknownColumns(parsed.headers, CLASS_COLUMNS),
      rows,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 2-qadam: yozish                                                     */
/* ------------------------------------------------------------------ */

/**
 * Takrorlanmaydigan sabablar ro'yxati (eng ko'pi 5 ta) — o'quvchi va
 * o'qituvchi importidagi mantiqning aynan o'zi. 500 ta bir xil sababni
 * yozish log'ni ham, audit jurnalini ham foydasiz qilardi.
 */
const MAX_FAILURE_REASONS = 5;

function collectReason(reasons: string[], reason: string): void {
  if (reasons.length >= MAX_FAILURE_REASONS) return;
  if (reasons.includes(reason)) return;
  reasons.push(reason);
}

const commitAction = createAction({
  roles: ["ADMIN"],
  schema: classImportPayloadSchema,
  handler: async (
    input,
    user
  ): Promise<ImportOutcome & { failureReasons: string[] }> => {
    const failureReasons: string[] = [];
    const outcome: ImportOutcome = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      messages: [],
      credentials: [],
    };

    /**
     * Klientdan kelgan bog'lanish id'lari — bazada bor-yo'qligi bitta
     * so'rovda tekshiriladi (har qator uchun alohida so'rov qilmaymiz).
     */
    const [validYears, validTeachers, validClasses] = await Promise.all([
      loadValidAcademicYearIds(input.rows.map((row) => row.academicYearId)),
      loadValidTeacherIds(input.rows.map((row) => row.homeroomTeacherId)),
      loadValidClassIds(input.rows.map((row) => row.existingId)),
    ]);

    const addMessage = (text: string) => {
      if (outcome.messages.length < 20) outcome.messages.push(text);
    };

    for (const row of input.rows) {
      if (row.existingId && input.mode === "skip") {
        outcome.skipped += 1;
        continue;
      }

      // Begona yoki o'chirilgan id — qator butunlay tashlanadi.
      // O'quv yili endi MAJBURIY, shuning uchun shart `row.academicYearId &&`
      // bilan boshlanmaydi: id har doim bo'lishi va mavjud bo'lishi kerak.
      if (!validYears.has(row.academicYearId)) {
        outcome.failed += 1;
        collectReason(failureReasons, "o'quv yili topilmadi");
        addMessage(`${row.rowNumber}-qator: o'quv yili topilmadi (ma'lumot eskirgan bo'lishi mumkin).`);
        continue;
      }
      if (row.homeroomTeacherId && !validTeachers.has(row.homeroomTeacherId)) {
        outcome.failed += 1;
        collectReason(failureReasons, "sinf rahbari topilmadi");
        addMessage(`${row.rowNumber}-qator: sinf rahbari topilmadi.`);
        continue;
      }
      if (row.existingId && !validClasses.has(row.existingId)) {
        outcome.failed += 1;
        collectReason(failureReasons, "yangilanadigan sinf topilmadi");
        addMessage(`${row.rowNumber}-qator: yangilanadigan sinf topilmadi.`);
        continue;
      }

      try {
        if (row.existingId) {
          await db.class.update({
            where: { id: row.existingId },
            data: {
              name: row.name,
              grade: row.grade,
              academicYearId: row.academicYearId,
              homeroomTeacherId: row.homeroomTeacherId ?? null,
            },
          });
          outcome.updated += 1;
        } else {
          await db.class.create({
            data: {
              name: row.name,
              grade: row.grade,
              academicYearId: row.academicYearId,
              homeroomTeacherId: row.homeroomTeacherId ?? null,
            },
            select: { id: true },
          });
          outcome.created += 1;
        }
      } catch (error) {
        outcome.failed += 1;

        /**
         * ILGARI SHU YERDA `catch {}` TURARDI — va ustiga foydalanuvchiga
         * TAXMINIY sabab ko'rsatilardi ("Sinf rahbari boshqa sinfga
         * biriktirilgan bo'lishi mumkin"). Ikki xato bir vaqtda edi:
         *   1. Server hech qayerga hech narsa yozmasdi — ya'ni skript
         *      bilan qilinadigan urinish (unique buzilishi, begona id,
         *      baza cheklovlarini "sinab ko'rish") izsiz qolardi.
         *   2. Admin noto'g'ri diagnoz olardi: haqiqiy sabab baza uzilishi
         *      yoki boshqa cheklov bo'lsa ham, xabar rahbarni ko'rsatardi.
         *
         * Endi haqiqiy sabab `describeErrorSafely` orqali tozalanib
         * serverda va audit jurnalida saqlanadi; foydalanuvchiga esa
         * taxmin emas, neytral xabar ko'rsatiladi (texnik detal tashqariga
         * chiqmaydi).
         */
        const reason = describeErrorSafely(error);
        collectReason(failureReasons, reason);
        logError("import:class:commit", error, {
          stage: "write",
          userId: user.id,
          mode: input.mode,
          isUpdate: Boolean(row.existingId),
        });

        addMessage(`${row.rowNumber}-qator: yozib bo'lmadi. Sabab jurnalga qayd etildi.`);
      }
    }

    revalidatePath("/classes");
    revalidatePath("/schedule");
    return { ...outcome, failureReasons };
  },
  audit: {
    action: "CREATE",
    entity: "ClassImport",
    meta: (input, result) => ({
      fileName: input.fileName ?? null,
      mode: input.mode,
      rows: input.rows.length,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
      // Nega yozilmadi — endi jurnalda ko'rinadi (tozalangan matn).
      failureReasons: result.failureReasons,
    }),
  },
});

export async function commitClassImport(payload: unknown): Promise<ClassCommitState> {
  const result = await commitAction(payload);
  if (!result.ok) return { ok: false, error: result.error };

  // `failureReasons` faqat server jurnali uchun — interfeysga chiqmaydi.
  const { failureReasons: _unused, ...outcome } = result.data;
  return { ok: true, data: outcome };
}
