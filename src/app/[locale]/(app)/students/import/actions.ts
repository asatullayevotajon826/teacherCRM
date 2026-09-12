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
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  isAllowedExcelFile,
  normalizeKey,
  parseExcel,
} from "@/lib/excel";
import {
  STUDENT_COLUMNS,
  TEACHER_TEMPLATE_HEADERS,
  findUnknownColumns,
  mapStudentRow,
  studentImportPayloadSchema,
  type ImportOutcome,
  type PreviewResult,
  type PreviewRow,
  type StudentCommitRow,
} from "@/lib/imports";

/**
 * O'QUVCHILARNI EXCEL'DAN IMPORT (faqat ADMIN)
 * ============================================
 * Ikki qadam:
 *   1. previewStudentImport — faylni o'qiydi, tekshiradi, HECH NARSA yozmaydi.
 *   2. commitStudentImport  — admin tasdiqlagan qatorlarni bazaga yozadi.
 *
 * Fayl serverda saqlanmaydi: oqimda o'qiladi va xotirada qoladi.
 * Ikkinchi qadam ham qaytadan validatsiya qiladi — brauzerdan kelgan
 * ma'lumotga ishonmaymiz.
 *
 * XATOLARNI QAYD ETISH (PR G3): ilgari bu fayldagi `catch` bloklari
 * xatoni butunlay jim yutib yuborardi — faqat `failed` hisoblagichi
 * oshardi. Natijada "nega 12 qator yozilmadi?" degan savolga javob
 * topishning IMKONI YO'Q edi va ataylab qilinayotgan hujum (masalan
 * qayta-qayta buzuq payload yuborish) normal xatodan farq qilmasdi.
 * Endi sabab `logError` orqali xavfsiz ko'rinishda serverda qoladi.
 */

export type StudentPreviewState =
  | { ok: true; data: PreviewResult<StudentCommitRow> }
  | { ok: false; error: string };

export type StudentCommitState =
  | { ok: true; data: ImportOutcome }
  | { ok: false; error: string };

function toDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Sinf nomi -> id xaritasi ("9-A", "9a" kabi yozilishlar bir xil hisoblanadi). */
async function loadClassMap(): Promise<Map<string, string>> {
  const classes = await db.class.findMany({ select: { id: true, name: true } });
  const map = new Map<string, string>();
  classes.forEach((item) => {
    map.set(normalizeKey(item.name), item.id);
  });
  return map;
}

/** Mavjud o'quvchilar kaliti: familiya|ism|tug'ilgan sana. */
async function loadStudentKeys(): Promise<Map<string, string>> {
  const students = await db.student.findMany({
    select: { id: true, firstName: true, lastName: true, dateOfBirth: true },
  });
  const map = new Map<string, string>();
  students.forEach((student) => {
    map.set(studentKey(student.lastName, student.firstName, student.dateOfBirth), student.id);
  });
  return map;
}

function studentKey(lastName: string, firstName: string, dateOfBirth?: Date | string | null) {
  const iso =
    dateOfBirth instanceof Date
      ? dateOfBirth.toISOString().slice(0, 10)
      : typeof dateOfBirth === "string"
        ? dateOfBirth
        : "";
  return `${normalizeKey(lastName)}|${normalizeKey(firstName)}|${iso}`;
}

async function upsertGuardian(input: {
  guardianName?: string;
  guardianPhone?: string;
  guardianRelation?: string;
  existingId?: string | null;
}) {
  if (!input.guardianName || !input.guardianPhone) {
    return input.existingId ?? undefined;
  }

  if (input.existingId) {
    await db.guardian.update({
      where: { id: input.existingId },
      data: {
        fullName: input.guardianName,
        phone: input.guardianPhone,
        relation: input.guardianRelation,
      },
    });
    return input.existingId;
  }

  const guardian = await db.guardian.create({
    data: {
      fullName: input.guardianName,
      phone: input.guardianPhone,
      relation: input.guardianRelation,
    },
  });
  return guardian.id;
}

/* ------------------------------------------------------------------ */
/* 1-qadam: ko'rib chiqish                                             */
/* ------------------------------------------------------------------ */

export async function previewStudentImport(
  _prev: StudentPreviewState | null,
  formData: FormData
): Promise<StudentPreviewState> {
  const user = await requireAdmin();

  // So'rov cheklovi: bu qadam `createAction` dan o'tmaydi (u FormData va
  // fayl bilan ishlamaydi), shuning uchun cheklov ochiq qolgan edi —
  // sababi `import-preview-limit.ts` da batafsil yozilgan.
  if (!(await allowImportPreview(user.id))) {
    logError("import:student:preview", new Error("preview cheklovi ishga tushdi"), {
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
    // Buzuq yoki ataylab shikastlangan fayl — parser xatosi qayd etiladi.
    // Fayl NOMI log'ga yozilmaydi: u foydalanuvchi kiritadigan matn va
    // ichida shaxsiy ma'lumot bo'lishi mumkin. Faqat hajmi qoldiriladi.
    logError("import:student:preview", error, {
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

  // Sarlavhalar mos kelmasa qatorlarni tekshirishning ma'nosi yo'q — barchasi
  // "Familiya bo'sh" bo'lib chiqadi va sabab noma'lum ko'rinadi.
  const headerError = checkImportHeaders({
    headers: parsed.headers,
    columns: STUDENT_COLUMNS,
    otherTemplateHeaders: TEACHER_TEMPLATE_HEADERS,
    otherTemplateName: "o'qituvchilar",
  });
  if (headerError) {
    return { ok: false, error: headerError };
  }

  const [classMap, existingKeys] = await Promise.all([loadClassMap(), loadStudentKeys()]);
  const seenInFile = new Map<string, number>();

  const rows: PreviewRow<StudentCommitRow>[] = parsed.rows.map((sheetRow) => {
    const mapped = mapStudentRow(sheetRow.values);
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
    const label = `${data.lastName} ${data.firstName}`;

    let classId: string | undefined;
    if (data.className) {
      classId = classMap.get(normalizeKey(data.className));
      if (!classId) {
        return {
          rowNumber: sheetRow.rowNumber,
          status: "error" as const,
          label,
          detail: data.className,
          messages: [
            ...messages,
            `Sinf topilmadi: "${data.className}". Avval sinfni yarating yoki ustunni bo'sh qoldiring.`,
          ],
          row: null,
          existingId: null,
        };
      }
    }

    const key = studentKey(data.lastName, data.firstName, data.dateOfBirth);
    const duplicateOfRow = seenInFile.get(key);
    const existingId = existingKeys.get(key) ?? null;

    const commitRow: StudentCommitRow = {
      rowNumber: sheetRow.rowNumber,
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth,
      gender: data.gender,
      address: data.address,
      className: classId ? data.className : undefined,
      status: data.status,
      guardianName: data.guardianName,
      guardianPhone: data.guardianPhone,
      guardianRelation: data.guardianRelation,
      existingId,
    };

    const detail = [data.className ?? "sinfsiz", data.dateOfBirth ?? ""]
      .filter((part) => part !== "")
      .join(" · ");

    if (duplicateOfRow) {
      return {
        rowNumber: sheetRow.rowNumber,
        status: "error" as const,
        label,
        detail,
        messages: [...messages, `Fayl ichida takrorlangan (${duplicateOfRow}-qator bilan bir xil).`],
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
        messages: [...messages, "Bu o'quvchi bazada allaqachon bor."],
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
      unknownColumns: findUnknownColumns(parsed.headers, STUDENT_COLUMNS),
      rows,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 2-qadam: yozish                                                     */
/* ------------------------------------------------------------------ */

/**
 * Takrorlanmaydigan sabablar ro'yxati (eng ko'pi 5 ta).
 *
 * 500 qatorli import butunlay yiqilsa, 500 ta bir xil sabab yozishning
 * ma'nosi yo'q — log ham, audit jurnali ham shishadi. Shuning uchun
 * sabablar takrorsiz yig'iladi va audit `meta` siga qo'shiladi: admin
 * jurnalda "nega yozilmadi" degan savolga javob ko'radi.
 */
const MAX_FAILURE_REASONS = 5;

function collectReason(reasons: string[], reason: string): void {
  if (reasons.length >= MAX_FAILURE_REASONS) return;
  if (reasons.includes(reason)) return;
  reasons.push(reason);
}

const commitAction = createAction({
  roles: ["ADMIN"],
  schema: studentImportPayloadSchema,
  handler: async (input, user): Promise<ImportOutcome & { failureReasons: string[] }> => {
    const classMap = await loadClassMap();
    const failureReasons: string[] = [];
    const outcome: ImportOutcome = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      messages: [],
      credentials: [],
    };

    for (const row of input.rows) {
      // Dublikat: admin tanloviga qarab o'tkazib yuboriladi yoki yangilanadi.
      if (row.existingId && input.mode === "skip") {
        outcome.skipped += 1;
        continue;
      }

      const classId = row.className ? classMap.get(normalizeKey(row.className)) : undefined;
      if (row.className && !classId) {
        outcome.failed += 1;
        collectReason(failureReasons, "sinf topilmadi");
        if (outcome.messages.length < 20) {
          outcome.messages.push(`${row.rowNumber}-qator: sinf topilmadi ("${row.className}").`);
        }
        continue;
      }

      try {
        if (row.existingId) {
          const existing = await db.student.findUnique({
            where: { id: row.existingId },
            select: { id: true, guardianId: true },
          });
          if (!existing) {
            // Klientdan kelgan `existingId` bazada yo'q. Bu oddiy holat ham
            // bo'lishi mumkin (preview'dan keyin o'quvchi o'chirilgan), lekin
            // qo'lda yasalgan so'rovning izi ham shunday ko'rinadi — shuning
            // uchun jim o'tib ketmaymiz.
            outcome.failed += 1;
            collectReason(failureReasons, "yangilanadigan o'quvchi topilmadi");
            if (outcome.messages.length < 20) {
              outcome.messages.push(
                `${row.rowNumber}-qator: yangilanadigan o'quvchi topilmadi.`
              );
            }
            continue;
          }

          const guardianId = await upsertGuardian({
            guardianName: row.guardianName,
            guardianPhone: row.guardianPhone,
            guardianRelation: row.guardianRelation,
            existingId: existing.guardianId,
          });

          await db.student.update({
            where: { id: existing.id },
            data: {
              firstName: row.firstName,
              lastName: row.lastName,
              dateOfBirth: toDate(row.dateOfBirth) ?? null,
              gender: row.gender ?? null,
              address: row.address ?? null,
              classId: classId ?? null,
              status: row.status,
              guardianId: guardianId ?? null,
            },
          });
          outcome.updated += 1;
        } else {
          const guardianId = await upsertGuardian({
            guardianName: row.guardianName,
            guardianPhone: row.guardianPhone,
            guardianRelation: row.guardianRelation,
          });

          await db.student.create({
            data: {
              firstName: row.firstName,
              lastName: row.lastName,
              dateOfBirth: toDate(row.dateOfBirth),
              gender: row.gender,
              address: row.address,
              classId,
              status: row.status,
              guardianId,
            },
            select: { id: true },
          });
          outcome.created += 1;
        }
      } catch (error) {
        outcome.failed += 1;

        /**
         * ILGARI SHU YERDA `catch {}` TURARDI — xato izsiz yo'qolardi.
         *
         * `describeErrorSafely` xato matnidan email, telefon, bcrypt xeshi
         * va ulanish satrini olib tashlaydi — ya'ni sabab saqlanadi, lekin
         * maxfiy qiymat log'ga (va audit jurnaliga) tushmaydi.
         *
         * Qator raqami ataylab `logError` ga berilmaydi — u foydalanuvchi
         * faylidan keladi; audit `meta` sida umumiy hisob yetarli.
         */
        const reason = describeErrorSafely(error);
        collectReason(failureReasons, reason);
        logError("import:student:commit", error, {
          stage: "write",
          userId: user.id,
          mode: input.mode,
        });

        if (outcome.messages.length < 20) {
          outcome.messages.push(`${row.rowNumber}-qator: yozib bo'lmadi.`);
        }
      }
    }

    revalidatePath("/students");
    return { ...outcome, failureReasons };
  },
  audit: {
    action: "CREATE",
    entity: "StudentImport",
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

export async function commitStudentImport(payload: unknown): Promise<StudentCommitState> {
  const result = await commitAction(payload);
  if (!result.ok) return { ok: false, error: result.error };

  // `failureReasons` faqat server jurnali uchun — interfeysga chiqmaydi.
  const { failureReasons: _unused, ...outcome } = result.data;
  return { ok: true, data: outcome };
}
