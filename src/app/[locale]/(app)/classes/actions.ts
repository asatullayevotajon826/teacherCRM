"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { createAction, formDataToObject } from "@/lib/safe-action";
import { redirectNever } from "@/lib/auth-guard";
import { idOnlySchema, type SaveResult } from "@/lib/academics";
import {
  classStudentSchema,
  classStudentsSchema,
  classUpdateSchema,
  classWriteSchema,
} from "@/lib/classes";

export type ClassFormState = { error?: string };

const DUPLICATE_MESSAGE =
  "Bu o'quv yilida shu nomdagi sinf allaqachon mavjud.";

/**
 * AuditLog ga yoziladigan ID ro'yxati uchun chegara.
 *
 * `redactMeta` massivni 50 elementda kesadi, lekin bu yerda ham aniq
 * chegara qo'yamiz: qaysi son yozilgani kodni o'qiganda ko'rinib turishi
 * kerak, kutubxonaning ichki qoidasiga tayanmasin.
 */
const AUDIT_ID_LIMIT = 50;

function revalidateClasses(classId?: string) {
  revalidatePath("/classes");
  revalidatePath("/students");
  revalidatePath("/schedule");
  if (classId) revalidatePath(`/classes/${classId}`);
}

const createClassAction = createAction({
  roles: ["ADMIN"],
  schema: classWriteSchema,
  handler: async (input): Promise<SaveResult> => {
    // O'quv yili endi MAJBURIY (PR F2) — `?? null` olib tashlandi.
    // Begona yoki o'chirilgan id kelib qolmasligi uchun mavjudligini
    // yozishdan oldin tekshiramiz: aks holda baza xatosi (P2003) ko'rinar,
    // foydalanuvchi esa nima bo'lganini tushunmasdi.
    const year = await db.academicYear.findUnique({
      where: { id: input.academicYearId },
      select: { id: true },
    });
    if (!year) {
      return { ok: false, message: "O'quv yili topilmadi. Sahifani yangilang." };
    }

    const duplicate = await db.class.findFirst({
      where: {
        name: input.name,
        academicYearId: input.academicYearId,
      },
      select: { id: true },
    });
    if (duplicate) return { ok: false, message: DUPLICATE_MESSAGE };

    const created = await db.class.create({
      data: {
        name: input.name,
        grade: input.grade,
        academicYearId: input.academicYearId,
        homeroomTeacherId: input.homeroomTeacherId ?? null,
      },
      select: { id: true },
    });
    revalidateClasses(created.id);
    return { ok: true, id: created.id };
  },
  audit: {
    action: "CREATE",
    entity: "Class",
    entityId: (_input, result) => (result.ok ? result.id : null),
    meta: (input) => ({ name: input.name, grade: input.grade }),
  },
});

const updateClassAction = createAction({
  roles: ["ADMIN"],
  schema: classUpdateSchema,
  handler: async (input): Promise<SaveResult> => {
    const year = await db.academicYear.findUnique({
      where: { id: input.academicYearId },
      select: { id: true },
    });
    if (!year) {
      return { ok: false, message: "O'quv yili topilmadi. Sahifani yangilang." };
    }

    const duplicate = await db.class.findFirst({
      where: {
        name: input.name,
        academicYearId: input.academicYearId,
        id: { not: input.id },
      },
      select: { id: true },
    });
    if (duplicate) return { ok: false, message: DUPLICATE_MESSAGE };

    await db.class.update({
      where: { id: input.id },
      data: {
        name: input.name,
        grade: input.grade,
        academicYearId: input.academicYearId,
        homeroomTeacherId: input.homeroomTeacherId ?? null,
      },
    });
    revalidateClasses(input.id);
    return { ok: true, id: input.id };
  },
  audit: {
    action: "UPDATE",
    entity: "Class",
    entityId: (input) => input.id,
  },
});

const deleteClassAction = createAction({
  roles: ["ADMIN"],
  schema: idOnlySchema,
  handler: async (input): Promise<{ deleted: boolean }> => {
    // Sinf o'chirilsa darslari ham o'chadi (Cascade), davomat esa darsga
    // bog'langan. Shuning uchun bo'sh bo'lmagan sinf o'chirilmaydi.
    const target = await db.class.findUnique({
      where: { id: input.id },
      select: { _count: { select: { students: true, lessons: true } } },
    });
    if (!target) return { deleted: false };
    if (target._count.students > 0 || target._count.lessons > 0) {
      return { deleted: false };
    }

    await db.class.delete({ where: { id: input.id } });
    revalidateClasses();
    return { deleted: true };
  },
  audit: {
    action: "DELETE",
    entity: "Class",
    entityId: (input) => input.id,
    meta: (_input, result) => ({ deleted: result.deleted }),
  },
});

type AssignOutcome = {
  /** Haqiqatan biriktirilgan o'quvchilar soni. */
  moved: number;
  /** Boshqa sinfda bo'lgani uchun TEGILMAGAN o'quvchilar soni. */
  blocked: number;
  /** Bazada topilmagan ID lar soni (o'chirilgan yoki soxta). */
  missing: number;
  /** Allaqachon shu sinfda bo'lganlar — xato emas, shunchaki ish yo'q. */
  already: number;
  /**
   * O'qish va yozish orasida boshqa admin tomonidan band qilinganlar.
   * Bu son 0 dan katta bo'lsa — poyga holati yuz bergan va
   * ikkinchi qorovul ishlagan.
   */
  raced: number;
};

/**
 * O'QUVCHILARNI SINFGA BIRIKTIRISH — QAT'IY YO'L (kundalik amal).
 *
 * NIMA XATO EDI:
 * Avvalgi kod `updateMany({ where: { id: { in: input.studentIds } } })`
 * qilardi. Ya'ni ID ro'yxatiga tushgan o'quvchi ALLAQACHON boshqa sinfda
 * bo'lsa ham jimgina shu sinfga ko'chib ketardi. Buning uchun hujum ham
 * kerak emasdi: ikki admin bir vaqtda ishlasa, birining ekranidagi
 * "sinfsizlar" ro'yxati eskirib qolardi va u saqlaganda o'quvchi ikkinchi
 * sinfdan tortib olinardi.
 *
 * NEGA XAVFLI:
 * Tizimda "o'quvchi qaysi sinfda edi" tarixi saqlanmaydi — faqat joriy
 * `Student.classId`. Baholar esa darsga, dars sinfga bog'langan. Demak
 * o'quvchi ko'chirilganda eski sinfning jurnali va reytingi ORQAGA QARAB
 * o'zgaradi, o'quvchining o'zi esa u ro'yxatda yo'q.
 *
 * NIMA QILINDI (kelishilgan "C" varianti):
 * Bu amal — KUNDALIK yo'l va u boshqa sinfga UMUMAN tegmaydi. Faqat
 * sinfi yo'q (`classId = null`) o'quvchilar biriktiriladi. Boshqa sinfdagi
 * o'quvchi ro'yxatga tushsa — u yozilmaydi, soni qaytariladi va
 * foydalanuvchiga aniq xabar ko'rsatiladi.
 *
 * Ataylab ko'chirish uchun pastdagi `moveStudentsAction` bor: u eski sinf
 * ID sini AuditLog ga yozadi. Shunday qilib shoshib bosilgan tugma
 * ma'lumotni buzmaydi, kerakli ish esa bloklanmaydi.
 *
 * IKKI QATLAM:
 *  1) o'qish paytida `classId` tekshiriladi (aniq xabar berish uchun);
 *  2) `updateMany` ning SHARTIDA ham `classId: null` turadi.
 * Ikkinchisi majburiy: birinchi tekshiruv bilan yozuv orasida boshqa
 * admin o'quvchini band qilib qo'yishi mumkin. Bunda baza qatorni
 * o'zgartirmaydi va `raced` soni buni ko'rsatadi.
 */
const assignStudentsAction = createAction({
  roles: ["ADMIN"],
  schema: classStudentsSchema,
  handler: async (input): Promise<AssignOutcome> => {
    const empty: AssignOutcome = {
      moved: 0,
      blocked: 0,
      missing: 0,
      already: 0,
      raced: 0,
    };

    const target = await db.class.findUnique({
      where: { id: input.classId },
      select: { id: true },
    });
    if (!target) {
      return { ...empty, missing: input.studentIds.length };
    }

    // Bir xil ID ikki marta kelsa hisob-kitob buzilmasin.
    const ids = Array.from(new Set(input.studentIds));

    const students = await db.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, classId: true },
    });

    const missing = ids.length - students.length;
    const free = students.filter((student) => student.classId === null);
    const already = students.filter(
      (student) => student.classId === target.id
    ).length;
    const blockedIds = students
      .filter(
        (student) => student.classId !== null && student.classId !== target.id
      )
      .map((student) => student.id);

    let moved = 0;
    if (free.length > 0) {
      const result = await db.student.updateMany({
        // `classId: null` — ikkinchi qorovul. Yuqoridagi o'qishdan keyin
        // o'quvchi band bo'lib qolgan bo'lsa, bu qator tegilmaydi.
        where: { id: { in: free.map((student) => student.id) }, classId: null },
        data: { classId: target.id },
      });
      moved = result.count;
    }

    revalidateClasses(target.id);
    return {
      moved,
      blocked: blockedIds.length,
      missing,
      already,
      raced: free.length - moved,
    };
  },
  audit: {
    action: "UPDATE",
    entity: "Class",
    entityId: (input) => input.classId,
    // Endi faqat `moved` emas: rad etilgan holatlar ham yozib qoldiriladi.
    // Bloklangan ID lar saqlanadi, chunki "nega bu o'quvchi qo'shilmadi?"
    // degan savolga keyin javob berish kerak bo'ladi.
    meta: (input, result) => ({
      requested: input.studentIds.length,
      moved: result.moved,
      blockedOtherClass: result.blocked,
      missing: result.missing,
      alreadyInClass: result.already,
      raced: result.raced,
      studentIds: input.studentIds.slice(0, AUDIT_ID_LIMIT),
    }),
  },
});

type MoveOutcome = {
  /** Haqiqatan ko'chirilgan o'quvchilar soni. */
  moved: number;
  /** Sinfi yo'q bo'lgani uchun TEGILMAGANLAR — ular kundalik amal orqali qo'shiladi. */
  skippedUnassigned: number;
  /** Bazada topilmagan ID lar soni. */
  missing: number;
  /** Allaqachon shu sinfda bo'lganlar. */
  already: number;
  /** O'qish va yozish orasida holati o'zgarganlar (poyga). */
  raced: number;
  /** Kim qaysi sinfdan olindi — AuditLog uchun. */
  moves: Array<{ studentId: string; from: string }>;
};

/**
 * O'QUVCHINI BOSHQA SINFDAN KO'CHIRISH — ATAYLAB BOSILADIGAN AMAL.
 *
 * NEGA ALOHIDA AMAL:
 * Yuqoridagi kundalik biriktirish boshqa sinfga umuman tegmaydi. Lekin
 * maktabda o'quvchi yil o'rtasida 9-A dan 9-B ga o'tishi odatiy hol.
 * Shuning uchun ko'chirish mumkin — ammo faqat shu amal orqali va HAR
 * DOIM iz qoldirib. Ya'ni xavfli harakat kundalik harakatdan ajratilgan:
 * shoshib bosilgan "biriktirish" tugmasi boshqa sinfni buzmaydi.
 *
 * NIMA YOZIB QOLDIRILADI:
 * `moves` massivida har bir o'quvchining ESKI SINF ID si bor. Bu majburiy,
 * chunki tizimda sinf tarixi jadvali yo'q: bu yozuv bo'lmasa "farzandim
 * nega 9-B da?" degan savolga javob beradigan manba qolmaydi.
 *
 * QARAMA-QARSHI YO'NALISH:
 * Sinfi yo'q o'quvchi bu amalga tushsa — TEGILMAYDI. Aks holda bu amal
 * kundalik yo'lning dublikatiga aylanib, H3a dagi qat'iylikni aylanib
 * o'tish yo'li bo'lib qolardi.
 */
const moveStudentsAction = createAction({
  roles: ["ADMIN"],
  schema: classStudentsSchema,
  handler: async (input): Promise<MoveOutcome> => {
    const empty: MoveOutcome = {
      moved: 0,
      skippedUnassigned: 0,
      missing: 0,
      already: 0,
      raced: 0,
      moves: [],
    };

    const target = await db.class.findUnique({
      where: { id: input.classId },
      select: { id: true },
    });
    if (!target) {
      return { ...empty, missing: input.studentIds.length };
    }

    const ids = Array.from(new Set(input.studentIds));

    const students = await db.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, classId: true },
    });

    const missing = ids.length - students.length;
    const skippedUnassigned = students.filter(
      (student) => student.classId === null
    ).length;
    const already = students.filter(
      (student) => student.classId === target.id
    ).length;

    // Faqat BOSHQA sinfdagilar. `classId` null bo'lmagani tekshirilgani
    // uchun `from` qiymati har doim mavjud.
    const movable = students.filter(
      (student) => student.classId !== null && student.classId !== target.id
    );

    let moved = 0;
    if (movable.length > 0) {
      const result = await db.student.updateMany({
        // Shartda ham himoya: o'qishdan keyin o'quvchi sinfsiz qolgan yoki
        // allaqachon shu sinfga o'tgan bo'lsa, qator tegilmaydi.
        where: {
          id: { in: movable.map((student) => student.id) },
          classId: { not: null },
          NOT: { classId: target.id },
        },
        data: { classId: target.id },
      });
      moved = result.count;
    }

    revalidateClasses(target.id);
    return {
      moved,
      skippedUnassigned,
      missing,
      already,
      raced: movable.length - moved,
      moves: movable.slice(0, AUDIT_ID_LIMIT).map((student) => ({
        studentId: student.id,
        from: student.classId as string,
      })),
    };
  },
  audit: {
    action: "UPDATE",
    entity: "Class",
    entityId: (input) => input.classId,
    meta: (input, result) => ({
      operation: "moveStudents",
      requested: input.studentIds.length,
      moved: result.moved,
      skippedUnassigned: result.skippedUnassigned,
      missing: result.missing,
      alreadyInClass: result.already,
      raced: result.raced,
      // Eng muhim qism: kim qaysi sinfdan olindi.
      moves: result.moves,
    }),
  },
});

const removeStudentAction = createAction({
  roles: ["ADMIN"],
  schema: classStudentSchema,
  handler: async (input): Promise<{ removed: boolean }> => {
    // Bu yerda doira allaqachon to'g'ri: `classId` shartda turgani uchun
    // boshqa sinfning o'quvchisini chiqarib yuborish mumkin emas.
    const result = await db.student.updateMany({
      where: { id: input.studentId, classId: input.classId },
      data: { classId: null },
    });
    revalidateClasses(input.classId);
    return { removed: result.count > 0 };
  },
  audit: {
    action: "UPDATE",
    entity: "Class",
    entityId: (input) => input.classId,
    meta: (input, result) => ({
      removedStudent: input.studentId,
      removed: result.removed,
    }),
  },
});

export async function createClass(
  _prev: ClassFormState,
  formData: FormData
): Promise<ClassFormState> {
  const result = await createClassAction(formDataToObject(formData));
  if (!result.ok) return { error: result.error };
  if (!result.data.ok) return { error: result.data.message };
  redirectNever(`/classes/${result.data.id}`);
}

export async function updateClass(
  _prev: ClassFormState,
  formData: FormData
): Promise<ClassFormState> {
  const result = await updateClassAction(formDataToObject(formData));
  if (!result.ok) return { error: result.error };
  if (!result.data.ok) return { error: result.data.message };
  redirectNever(`/classes/${result.data.id}`);
}

export async function deleteClass(formData: FormData): Promise<void> {
  const raw = formDataToObject(formData);
  const result = await deleteClassAction(raw);
  if (!result.ok || !result.data.deleted) {
    const id = typeof raw.id === "string" ? raw.id : "";
    redirectNever(`/classes/${id}?error=inUse`);
  }
  redirectNever("/classes");
}

export async function assignStudents(formData: FormData): Promise<void> {
  const raw = formDataToObject(formData);
  const classId = typeof raw.classId === "string" ? raw.classId : "";
  const result = await assignStudentsAction(raw);
  if (!result.ok) {
    redirectNever(`/classes/${classId}?error=assign`);
  }
  // Bir nechta o'quvchi rad etilgan bo'lsa, jimgina "bajarildi" deb
  // qaytmaymiz — foydalanuvchi nima bo'lganini bilishi kerak.
  const { blocked, missing, raced } = result.data;
  if (blocked > 0 || missing > 0 || raced > 0) {
    redirectNever(`/classes/${classId}?error=assignBlocked`);
  }
  redirectNever(`/classes/${classId}`);
}

export async function moveStudents(formData: FormData): Promise<void> {
  const raw = formDataToObject(formData);
  const classId = typeof raw.classId === "string" ? raw.classId : "";
  const result = await moveStudentsAction(raw);
  if (!result.ok) {
    redirectNever(`/classes/${classId}?error=move`);
  }
  // Hech kim ko'chirilmagan bo'lsa ham xabar beramiz: aks holda admin
  // "ko'chirdim" deb o'ylab qolardi.
  if (result.data.moved === 0) {
    redirectNever(`/classes/${classId}?error=moveBlocked`);
  }
  redirectNever(`/classes/${classId}`);
}

export async function removeStudent(formData: FormData): Promise<void> {
  const raw = formDataToObject(formData);
  const classId = typeof raw.classId === "string" ? raw.classId : "";
  const result = await removeStudentAction(raw);
  if (!result.ok) {
    redirectNever(`/classes/${classId}?error=assign`);
  }
  redirectNever(`/classes/${classId}`);
}
