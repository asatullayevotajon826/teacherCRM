-- F3 — BAHO DARSGA MAJBURIY BOG'LANADI
-- =====================================
--
-- MUAMMO: `Grade.lessonId` NULL bo'lishi mumkin edi, ustida esa
-- `@@unique([studentId, lessonId, date, type])` turadi. PostgreSQL da unique
-- cheklovida NULL o'zi bilan TENG EMAS, shuning uchun `lessonId` bo'sh
-- qatorlar cheklovga UMUMAN TUSHMASDI: bitta o'quvchiga, bitta kunda, bitta
-- tur bo'yicha cheksiz baho yozish mumkin edi. O'rtacha ball va reyting shu
-- qatorlar ustida hisoblanadi — ya'ni takroriy yozuv natijani buzadi.
--
-- YECHIM: bo'sh qiymatlarni to'ldirish (backfill) va ustunni NOT NULL qilish.
--
-- Migratsiya BITTA TRANZAKSIYADA ishlaydi: biror qadam xato bersa hammasi
-- ortga qaytadi, ma'lumot o'zgarmaydi.

-- ------------------------------------------------------------------
-- 1-QADAM: BACKFILL
--
-- Bo'sh `lessonId` faqat SHUBHASIZ holatda to'ldiriladi: o'quvchining
-- sinfida, o'sha fandan, o'sha hafta kunida YAGONA dars bo'lsa. Ikki dars
-- bo'lsa (masalan "Matematika" va "Matematika 2") qaysi biriga tegishli
-- ekani noma'lum — taxmin qilinmaydi, qator qoldiriladi va 2-qadam
-- migratsiyani to'xtatadi.
--
-- `NOT EXISTS` sharti: to'ldirish natijasida mavjud unique cheklov buzilib
-- ketmasligi kerak (o'sha o'quvchi, dars, sana, tur bo'yicha baho allaqachon
-- bo'lsa — bu takroriy yozuv, uni qo'lda hal qilish kerak).
-- ------------------------------------------------------------------

UPDATE "Grade" g
SET "lessonId" = l."id"
FROM "Student" s, "Lesson" l
WHERE g."lessonId" IS NULL
  AND s."id" = g."studentId"
  AND s."classId" IS NOT NULL
  AND l."classId" = s."classId"
  AND l."subjectId" = g."subjectId"
  AND l."dayOfWeek" = EXTRACT(ISODOW FROM g."date")::int
  AND (
    SELECT count(*)
    FROM "Lesson" l2
    WHERE l2."classId" = s."classId"
      AND l2."subjectId" = g."subjectId"
      AND l2."dayOfWeek" = EXTRACT(ISODOW FROM g."date")::int
  ) = 1
  AND NOT EXISTS (
    SELECT 1
    FROM "Grade" g2
    WHERE g2."studentId" = g."studentId"
      AND g2."lessonId" = l."id"
      AND g2."date" = g."date"
      AND g2."type" = g."type"
  );

-- ------------------------------------------------------------------
-- 2-QADAM: QOLGANI BORMI?
--
-- Qolgan bo'sh qatorlarni JIMGINA o'chirib yuborish MUMKIN EMAS — bu
-- o'quvchining haqiqiy bahosini yo'qotish degani. Shuning uchun migratsiya
-- tushunarli xabar bilan to'xtaydi va qaror egasiga qoladi.
-- ------------------------------------------------------------------

DO $$
DECLARE
  qoldi bigint;
BEGIN
  SELECT count(*) INTO qoldi FROM "Grade" WHERE "lessonId" IS NULL;

  IF qoldi > 0 THEN
    RAISE EXCEPTION
      'F3 to''xtatildi: % ta bahoning darsi aniqlanmadi. Ular avtomatik bog''lanmadi, chunki o''quvchining sinfida o''sha fandan o''sha kuni dars topilmadi yoki bir nechta dars bor. Ro''yxatni ko''rish: SELECT g."id", g."studentId", g."subjectId", g."date", g."type", g."value" FROM "Grade" g WHERE g."lessonId" IS NULL ORDER BY g."date"; Har birini jurnal orqali qayta kiriting yoki qo''lda to''g''ri "lessonId" ni yozing, so''ng migratsiyani qayta ishga tushiring. Hech qanday ma''lumot o''zgartirilmadi.',
      qoldi;
  END IF;
END $$;

-- ------------------------------------------------------------------
-- 3-QADAM: USTUN MAJBURIY BO'LADI
-- ------------------------------------------------------------------

ALTER TABLE "Grade" ALTER COLUMN "lessonId" SET NOT NULL;

-- ------------------------------------------------------------------
-- 4-QADAM: TASHQI KALIT SetNull -> Restrict
--
-- Eski qoida: dars o'chirilsa baholarning `lessonId` si NULL ga tushardi —
-- ya'ni yuqoridagi teshik jadval tahriri orqali QAYTA OCHILARDI (va endi
-- NOT NULL bilan umuman ishlamaydi).
--
-- Yangi qoida: bahosi bor darsni o'chirib bo'lmaydi. Foydalanuvchi bunday
-- xatoni ko'rmaydi — `schedule/actions.ts` o'chirishdan oldin tekshiradi va
-- tushunarli xabar chiqaradi. Bu cheklov oxirgi qalqon.
--
-- Kalit nomi Prisma yaratganidan farq qilishi mumkin, shuning uchun nom
-- qattiq yozilmay, katalogdan topiladi.
-- ------------------------------------------------------------------

DO $$
DECLARE
  kalit text;
BEGIN
  SELECT con.conname INTO kalit
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE con.contype = 'f'
    AND rel.relname = 'Grade'
    AND nsp.nspname = current_schema()
    AND con.conkey = ARRAY[
      (SELECT att.attnum FROM pg_attribute att
        WHERE att.attrelid = rel.oid AND att.attname = 'lessonId')
    ]::smallint[]
  LIMIT 1;

  IF kalit IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "Grade" DROP CONSTRAINT %I', kalit);
  END IF;
END $$;

ALTER TABLE "Grade"
  ADD CONSTRAINT "Grade_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
