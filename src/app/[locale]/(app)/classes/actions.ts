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

const assignStudentsAction = createAction({
  roles: ["ADMIN"],
  schema: classStudentsSchema,
  handler: async (input): Promise<{ moved: number }> => {
    const target = await db.class.findUnique({
      where: { id: input.classId },
      select: { id: true },
    });
    if (!target) return { moved: 0 };

    const result = await db.student.updateMany({
      where: { id: { in: input.studentIds } },
      data: { classId: input.classId },
    });
    revalidateClasses(input.classId);
    return { moved: result.count };
  },
  audit: {
    action: "UPDATE",
    entity: "Class",
    entityId: (input) => input.classId,
    meta: (input, result) => ({
      assignedStudents: input.studentIds.length,
      moved: result.moved,
    }),
  },
});

const removeStudentAction = createAction({
  roles: ["ADMIN"],
  schema: classStudentSchema,
  handler: async (input): Promise<{ removed: boolean }> => {
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
    meta: (input) => ({ removedStudent: input.studentId }),
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
