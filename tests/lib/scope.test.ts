import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import type { SessionUser } from "@/lib/auth-guard";

/**
 * MA'LUMOT DARAJASIDAGI DOIRA TESTLARI — IDOR himoyasi
 * ===================================================
 *
 * `scope.ts` — "kim qaysi QATORLARNI ko'radi" savoliga javob beradi.
 * `rbac.ts` esa "kim qaysi SAHIFAGA kiradi" — u alohida test faylida.
 *
 * NIMA UCHUN MOCK KERAK
 * ---------------------
 * `scope.ts` modul darajasida `./db` ni import qiladi, `db.ts` esa
 * `PrismaClient` yaratadi va `DATABASE_URL` talab qiladi. Bu testlarda
 * faqat SOF doira funksiyalari tekshiriladi (`studentScope`, `classScope`
 * va boshqalar) — ular bazaga murojaat qilmaydi, faqat Prisma `where`
 * obyektini QURADI va qaytaradi.
 *
 * Shuning uchun `db` bo'sh obyekt bilan almashtirildi: bazaga ulanish yo'q,
 * testlar tez va muhitdan mustaqil ishlaydi.
 *
 * `assertCanAccess*` funksiyalari bu yerda test qilinmaydi — ular haqiqiy
 * bazaga so'rov yuboradi. Ular integratsiya testlari bilan qamraladi
 * (migratsiyalar yo'lga qo'yilib, toza test bazasi paydo bo'lgandan keyin).
 */

vi.mock("@/lib/db", () => ({
  db: {},
}));

vi.mock("@/lib/auth-guard", () => ({
  redirectNever: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

/**
 * UCHINCHI MOCK — NEGA KERAK (H4d).
 *
 * H4c dan keyin `scope.ts` `audit-denied.ts` ni ham import qiladi (rad
 * etishni `AuditLog` ga yozish uchun). U esa o'z navbatida `audit.ts` va
 * `rate-limit-db.ts` ni, ular orqali `logger.ts` ni, logger esa `env.ts`
 * ni tortadi. `env.ts` modul yuklanayotgan paytning O'ZIDA `DATABASE_URL`
 * va `AUTH_SECRET` ni talab qiladi va ular bo'lmasa xato tashlaydi.
 *
 * Natijada bu fayl bitta ham testni ishga tushira olmasdan yiqilardi
 * ("Failed Suite", 0 ta test) — ya'ni IDOR doiralarining butun tekshiruvi
 * jimgina yo'qolgan edi. Eng xavflisi shuki, qolgan 140 ta test o'tayotgani
 * uchun bu nosozlik "hammasi joyida" degan taassurot berardi.
 *
 * Yechim mock: bu testlar rad etish YOZUVINI emas, doira FILTRLARINI
 * tekshiradi. `logPermissionDenied` ning haqiqiy xatti-harakati bu yerga
 * aloqador emas, shuning uchun uni bo'sh funksiya bilan almashtiramiz —
 * `db` va `auth-guard` uchun qilinganidek. Ishlab chiqarish kodi
 * o'zgartirilmaydi: haqiqiy serverda `env` har doim mavjud.
 */
vi.mock("@/lib/audit-denied", () => ({
  logPermissionDenied: async () => {},
}));

import {
  attendanceScope,
  classScope,
  contractScope,
  gradeScope,
  gradingLessonScope,
  invoiceScope,
  lessonScope,
  paymentScope,
  penaltyScope,
  studentScope,
  testResultScope,
} from "@/lib/scope";

/** Test uchun sessiya foydalanuvchisi (ID bor). */
function userOf(role: string | undefined, id: string = "user-1") {
  return { id, role } as unknown as SessionUser;
}

/**
 * ID SIZ foydalanuvchi — `requireUserId` ni tekshirish uchun.
 *
 * DIQQAT — TUZOQ: `userOf("TEACHER", undefined)` YOZIB BO'LMAYDI.
 * JavaScript'da `undefined` argument STANDART QIYMATNI ishga tushiradi,
 * ya'ni id aslida "user-1" bo'lib qoladi va `requireUserId` xato
 * tashlamaydi. Testning o'zi yolg'on "o'tdi" holatiga tushib qolardi.
 *
 * Shu sababli ID siz holat ALOHIDA yordamchi bilan quriladi — bu yerda
 * `id` kaliti obyektda umuman yo'q.
 */
function userWithoutId(role: string | undefined) {
  return { role } as unknown as SessionUser;
}

/** Hech bir qatorga mos kelmaydigan filtr (fail-closed natijasi). */
const MATCH_NOTHING = { id: { in: [] as string[] } };

/** Filtr ichida berilgan so'z uchraydimi (chuqurligiga qaramay). */
function filterContains(filter: unknown, needle: string): boolean {
  return JSON.stringify(filter).toLowerCase().includes(needle.toLowerCase());
}

describe("studentScope", () => {
  it("ADMIN uchun bo'sh filtr — hamma o'quvchi", () => {
    expect(studentScope(userOf("ADMIN"))).toEqual({});
  });

  it("ACCOUNTANT uchun bo'sh filtr — hammasini KO'RADI", () => {
    // TZ 2.1 da buxgalter uchun "ko'zdan kechirish" belgisi bor.
    // Yozish huquqi bu yerda emas — u action'larda `requireRole` bilan
    // cheklanadi (ACCOUNTANT ro'yxatga kiritilmaydi).
    expect(studentScope(userOf("ACCOUNTANT"))).toEqual({});
  });

  it("TEACHER — sinf rahbari YOKI dars beruvchi bo'lgan sinflar", () => {
    const filter = studentScope(userOf("TEACHER", "t-1"));

    expect(filter).toEqual({
      class: {
        OR: [
          { homeroomTeacher: { userId: "t-1" } },
          { lessons: { some: { teacher: { userId: "t-1" } } } },
        ],
      },
    });
  });

  it("PARENT — faqat o'z farzandlari (Guardian orqali)", () => {
    const filter = studentScope(userOf("PARENT", "p-1"));

    expect(filter).toEqual({ guardian: { userId: "p-1" } });
  });

  /**
   * ENG XAVFLI XATO TURI.
   *
   * Prisma uchun bo'sh filtr `{}` — "HAMMA QATOR" degani. Agar noma'lum
   * rol holatida `{}` qaytsa, sessiya buzilganda yoki yangi rol
   * qo'shilganda butun baza ochilib qolardi — va bu JIMGINA sodir bo'ladi,
   * hech qanday xato xabari chiqmaydi.
   *
   * Shuning uchun `default` sharti MATCH_NOTHING qaytarishi SHART.
   */
  it("noma'lum rol — MATCH_NOTHING (fail-closed, bo'sh filtr EMAS)", () => {
    const filter = studentScope(userOf("SUPERUSER"));

    expect(filter).toEqual(MATCH_NOTHING);
    expect(filter).not.toEqual({});
  });

  it("rol undefined — MATCH_NOTHING", () => {
    expect(studentScope(userOf(undefined))).toEqual(MATCH_NOTHING);
  });

  /**
   * `requireUserId` ataylab xato tashlaydi.
   *
   * Agar u jimgina `undefined` qaytarsa, filtr
   * `{ guardian: { userId: undefined } }` bo'lardi — Prisma bunday shartni
   * e'tiborsiz qoldirishi mumkin, natijada ota-ona BARCHA o'quvchini
   * ko'rib qolardi.
   *
   * Diqqat: `userWithoutId` ishlatiladi, `userOf(..., undefined)` EMAS —
   * sabab yordamchining izohida yozilgan.
   */
  it("TEACHER da ID bo'lmasa xato tashlanadi", () => {
    expect(() => studentScope(userWithoutId("TEACHER"))).toThrow(
      /foydalanuvchi ID/i
    );
  });

  it("PARENT da ID bo'lmasa xato tashlanadi", () => {
    expect(() => studentScope(userWithoutId("PARENT"))).toThrow(
      /foydalanuvchi ID/i
    );
  });

  it("ADMIN da ID bo'lmasa ham xato tashlanmaydi", () => {
    // ADMIN shoxida `requireUserId` chaqirilmaydi — filtr bo'sh.
    expect(() => studentScope(userWithoutId("ADMIN"))).not.toThrow();
  });
});

describe("classScope", () => {
  it("ADMIN va ACCOUNTANT — hamma sinf", () => {
    expect(classScope(userOf("ADMIN"))).toEqual({});
    expect(classScope(userOf("ACCOUNTANT"))).toEqual({});
  });

  it("TEACHER — rahbarlik qiladigan yoki dars beradigan sinflar", () => {
    expect(classScope(userOf("TEACHER", "t-1"))).toEqual({
      OR: [
        { homeroomTeacher: { userId: "t-1" } },
        { lessons: { some: { teacher: { userId: "t-1" } } } },
      ],
    });
  });

  it("PARENT — faqat farzandi o'qiydigan sinf", () => {
    expect(classScope(userOf("PARENT", "p-1"))).toEqual({
      students: { some: { guardian: { userId: "p-1" } } },
    });
  });

  it("noma'lum rol — MATCH_NOTHING", () => {
    expect(classScope(userOf("SUPERUSER"))).toEqual(MATCH_NOTHING);
  });
});

describe("lessonScope — KO'RISH va DAVOMAT uchun", () => {
  it("ADMIN — hamma dars", () => {
    expect(lessonScope(userOf("ADMIN"))).toEqual({});
  });

  /**
   * 5-bosqich tuzatishi: sinf rahbari o'z sinfining BARCHA darslariga
   * yetishi kerak, chunki amalda davomatni ko'pincha sinf rahbari yuritadi,
   * lekin u har bir fanni o'zi o'qitmaydi.
   */
  it("TEACHER — o'z darslari VA sinf rahbarligidagi sinf darslari", () => {
    expect(lessonScope(userOf("TEACHER", "t-1"))).toEqual({
      OR: [
        { teacher: { userId: "t-1" } },
        { class: { homeroomTeacher: { userId: "t-1" } } },
      ],
    });
  });

  it("TEACHER doirasida homeroom shoxi BOR", () => {
    expect(filterContains(lessonScope(userOf("TEACHER", "t-1")), "homeroom")).toBe(
      true
    );
  });

  it("PARENT — farzandi sinfining darslari", () => {
    expect(lessonScope(userOf("PARENT", "p-1"))).toEqual({
      class: { students: { some: { guardian: { userId: "p-1" } } } },
    });
  });

  it("ACCOUNTANT — MATCH_NOTHING (darslarga aloqasi yo'q)", () => {
    // Diqqat: bu yerda ACCOUNTANT `{}` OLMAYDI — `studentScope` dan farqli.
    // Buxgalter o'quvchi ro'yxatini ko'radi, lekin dars jadvaliga aloqasi yo'q.
    expect(lessonScope(userOf("ACCOUNTANT"))).toEqual(MATCH_NOTHING);
  });
});

describe("gradingLessonScope — BAHO QO'YISH uchun", () => {
  it("ADMIN — hamma dars", () => {
    expect(gradingLessonScope(userOf("ADMIN"))).toEqual({});
  });

  it("TEACHER — FAQAT o'zi o'qitadigan darslar", () => {
    expect(gradingLessonScope(userOf("TEACHER", "t-1"))).toEqual({
      teacher: { userId: "t-1" },
    });
  });

  /**
   * BU FAYLDAGI ENG MUHIM TEST.
   *
   * Eganing qat'iy talabi: bahoni FAQAT FAN O'QITUVCHISI qo'yadi. Sinf
   * rahbari o'z sinfining boshqa fanidan baho qo'ya OLMAYDI — davomatdan
   * farqli qoida.
   *
   * Shuning uchun bu doirada `homeroomTeacher` shoxi ATAYLAB yo'q.
   *
   * Xavf: kelajakda kimdir `lessonScope` va `gradingLessonScope` ni
   * "takrorlanmasin" deb birlashtirishi mumkin — bu tabiiy ko'rinadigan
   * refaktoring. Natijada matematika o'qituvchisi o'z sinfining ADABIYOT
   * bahosini o'zgartira oladigan bo'lardi. Shu test o'sha o'zgarishni
   * darhol to'xtatadi.
   */
  it("TEACHER doirasida homeroom shoxi YO'Q (xavfsizlik qoidasi)", () => {
    const filter = gradingLessonScope(userOf("TEACHER", "t-1"));

    expect(filterContains(filter, "homeroom")).toBe(false);
  });

  it("lessonScope va gradingLessonScope ATAYLAB farq qiladi", () => {
    const teacher = userOf("TEACHER", "t-1");

    // Bu assimetriya xato emas: davomat kengroq, baho torroq.
    expect(gradingLessonScope(teacher)).not.toEqual(lessonScope(teacher));
  });

  it("PARENT baho qo'ya olmaydi — MATCH_NOTHING", () => {
    expect(gradingLessonScope(userOf("PARENT", "p-1"))).toEqual(MATCH_NOTHING);
  });

  it("ACCOUNTANT baho qo'ya olmaydi — MATCH_NOTHING", () => {
    expect(gradingLessonScope(userOf("ACCOUNTANT"))).toEqual(MATCH_NOTHING);
  });

  it("noma'lum rol — MATCH_NOTHING", () => {
    expect(gradingLessonScope(userOf("SUPERUSER"))).toEqual(MATCH_NOTHING);
  });
});

describe("o'quvchi doirasidan kelib chiqadigan doiralar", () => {
  /**
   * Bu doiralar `studentScope` ustiga qurilgan — mantiq bitta joyda turadi.
   * Testlar shu bog'liqlikni tasdiqlaydi: `studentScope` o'zgarsa,
   * hammasi avtomatik moslashadi.
   */
  const parent = userOf("PARENT", "p-1");
  const childFilter = { guardian: { userId: "p-1" } };

  it("attendanceScope — student orqali", () => {
    expect(attendanceScope(parent)).toEqual({ student: childFilter });
  });

  it("gradeScope — student orqali (KO'RISH keng)", () => {
    // Ko'rish doirasi keng: ota-ona va sinf rahbari bahoni ko'radi.
    // Yozish esa `gradingLessonScope` bilan cheklanadi. Ikkisi bir xil emas.
    expect(gradeScope(parent)).toEqual({ student: childFilter });
  });

  it("penaltyScope — student orqali", () => {
    expect(penaltyScope(parent)).toEqual({ student: childFilter });
  });

  it("testResultScope — student orqali", () => {
    expect(testResultScope(parent)).toEqual({ student: childFilter });
  });

  it("contractScope — student orqali", () => {
    expect(contractScope(parent)).toEqual({ student: childFilter });
  });

  it("invoiceScope — contract → student", () => {
    expect(invoiceScope(parent)).toEqual({
      contract: { student: childFilter },
    });
  });

  it("paymentScope — invoice → contract → student", () => {
    expect(paymentScope(parent)).toEqual({
      invoice: { contract: { student: childFilter } },
    });
  });

  /**
   * Fail-closed holat kelib chiqadigan doiralarga ham TARQALISHI kerak.
   * Agar noma'lum rol uchun `studentScope` MATCH_NOTHING qaytarsa,
   * `gradeScope` ham avtomatik yopiq bo'ladi.
   */
  it("noma'lum rol uchun barcha kelib chiqadigan doiralar yopiq", () => {
    const unknown = userOf("SUPERUSER");

    expect(gradeScope(unknown)).toEqual({ student: MATCH_NOTHING });
    expect(attendanceScope(unknown)).toEqual({ student: MATCH_NOTHING });
    expect(penaltyScope(unknown)).toEqual({ student: MATCH_NOTHING });
    expect(paymentScope(unknown)).toEqual({
      invoice: { contract: { student: MATCH_NOTHING } },
    });
  });

  it("ADMIN uchun barcha kelib chiqadigan doiralar ochiq", () => {
    const admin = userOf("ADMIN");

    expect(gradeScope(admin)).toEqual({ student: {} });
    expect(invoiceScope(admin)).toEqual({ contract: { student: {} } });
  });
});

describe("rollar bo'yicha umumiy invariantlar", () => {
  const roles: Role[] = ["ADMIN", "TEACHER", "ACCOUNTANT", "PARENT"];

  it("hech bir rol uchun doira undefined qaytarmaydi", () => {
    // `undefined` Prisma'ga berilsa shart butunlay e'tiborsiz qoladi —
    // ya'ni filtr yo'qoladi va hamma qator ochiladi.
    for (const role of roles) {
      const user = userOf(role, "u-1");

      expect(studentScope(user)).toBeDefined();
      expect(classScope(user)).toBeDefined();
      expect(lessonScope(user)).toBeDefined();
      expect(gradingLessonScope(user)).toBeDefined();
    }
  });

  it("faqat ADMIN barcha to'rt doirada cheklovsiz", () => {
    const admin = userOf("ADMIN");

    expect(studentScope(admin)).toEqual({});
    expect(classScope(admin)).toEqual({});
    expect(lessonScope(admin)).toEqual({});
    expect(gradingLessonScope(admin)).toEqual({});

    // Boshqa hech bir rol to'rttasida ham bo'sh filtr olmaydi.
    for (const role of ["TEACHER", "ACCOUNTANT", "PARENT"] as Role[]) {
      const user = userOf(role, "u-1");
      const allOpen =
        JSON.stringify(studentScope(user)) === "{}" &&
        JSON.stringify(classScope(user)) === "{}" &&
        JSON.stringify(lessonScope(user)) === "{}" &&
        JSON.stringify(gradingLessonScope(user)) === "{}";

      expect(allOpen).toBe(false);
    }
  });
});
