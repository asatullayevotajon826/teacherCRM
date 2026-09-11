-- PR F2 — MA'LUMOT YAXLITLIGI (schema darajasidagi teshiklarni yopish)
-- =====================================================================
--
-- Bu migratsiya PostgreSQL da BITTA TRANZAKSIYA ichida bajariladi:
-- biror qadam xato bersa, hammasi ortga qaytadi va baza tegilmagan holida
-- qoladi. Ma'lumot O'CHIRILMAYDI — faqat cheklov qo'shiladi.
--
-- Tekshirilmagan eski ma'lumot migratsiyani yiqitmasligi uchun ba'zi
-- CHECK lar `NOT VALID` bilan qo'shiladi: ular YANGI va O'ZGARTIRILGAN
-- qatorlarga darhol ishlaydi, eski qatorlar esa keyin qo'lda tekshiriladi
-- (PR tavsifidagi VALIDATE buyruqlari).

-- ---------------------------------------------------------------
-- 1) Student.userId — o'quvchini o'z hisobiga bog'lash
-- ---------------------------------------------------------------
ALTER TABLE "Student" ADD COLUMN "userId" TEXT;

CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------
-- 2) Class.academicYearId — MAJBURIY
-- ---------------------------------------------------------------
-- Avval bo'sh qolganlarini joriy o'quv yiliga biriktiramiz.
UPDATE "Class"
   SET "academicYearId" = (
         SELECT "id" FROM "AcademicYear"
          WHERE "isCurrent" = true
          ORDER BY "createdAt" ASC
          LIMIT 1
       )
 WHERE "academicYearId" IS NULL;

-- Agar joriy yil belgilanmagan bo'lsa, tushunarli xato bilan to'xtaymiz.
DO $$
DECLARE qoldi integer;
BEGIN
  SELECT count(*) INTO qoldi FROM "Class" WHERE "academicYearId" IS NULL;
  IF qoldi > 0 THEN
    RAISE EXCEPTION
      'F2 to''xtatildi: % ta sinfda o''quv yili yo''q va "joriy o''quv yili" belgilanmagan. Avval /academic-years sahifasida joriy yilni belgilang (yoki sinflarga yil biriktiring), keyin migratsiyani qayta ishga tushiring.',
      qoldi;
  END IF;
END $$;

ALTER TABLE "Class" ALTER COLUMN "academicYearId" SET NOT NULL;

-- Eski FK (SetNull) o'rniga Restrict. Cheklov nomini bazadan topamiz —
-- nom har xil bo'lib qolgan bo'lsa ham migratsiya ishlaydi.
DO $$
DECLARE nom text;
BEGIN
  SELECT conname INTO nom
    FROM pg_constraint
   WHERE conrelid = '"Class"'::regclass
     AND contype = 'f'
     AND conkey = ARRAY[(
           SELECT attnum FROM pg_attribute
            WHERE attrelid = '"Class"'::regclass
              AND attname = 'academicYearId'
         )];
  IF nom IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "Class" DROP CONSTRAINT %I', nom);
  END IF;
END $$;

ALTER TABLE "Class"
  ADD CONSTRAINT "Class_academicYearId_fkey"
  FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------
-- 3) Lesson.periodId — MAJBURIY
-- ---------------------------------------------------------------
-- Uyasiz darsni "taxmin qilib" to'ldirib bo'lmaydi (qaysi soat ekani
-- noma'lum), shuning uchun bunday qator bo'lsa ataylab to'xtaymiz.
DO $$
DECLARE qoldi integer;
BEGIN
  SELECT count(*) INTO qoldi FROM "Lesson" WHERE "periodId" IS NULL;
  IF qoldi > 0 THEN
    RAISE EXCEPTION
      'F2 to''xtatildi: % ta darsda qo''ng''iroq uyasi (periodId) yo''q. Dars jadvali sahifasida ularga uya tanlang yoki o''chiring, keyin qayta urinib ko''ring.',
      qoldi;
  END IF;
END $$;

ALTER TABLE "Lesson" ALTER COLUMN "periodId" SET NOT NULL;

DO $$
DECLARE nom text;
BEGIN
  SELECT conname INTO nom
    FROM pg_constraint
   WHERE conrelid = '"Lesson"'::regclass
     AND contype = 'f'
     AND conkey = ARRAY[(
           SELECT attnum FROM pg_attribute
            WHERE attrelid = '"Lesson"'::regclass
              AND attname = 'periodId'
         )];
  IF nom IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "Lesson" DROP CONSTRAINT %I', nom);
  END IF;
END $$;

ALTER TABLE "Lesson"
  ADD CONSTRAINT "Lesson_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "LessonPeriod"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------
-- 4) AcademicYear.isCurrent — bittadan ortiq "joriy yil" bo'lmasin
-- ---------------------------------------------------------------
-- Qisman unique indeks Prisma sxemasida ifodalanmaydi (har `migrate dev`
-- da o'chirilishga urinilardi), shuning uchun qoida ilova qatlamida
-- tranzaksiya bilan saqlanadi. Bu yerda faqat mavjud holatni tozalaymiz:
-- eng oxirgi yaratilgan yil joriy bo'lib qoladi.
UPDATE "AcademicYear"
   SET "isCurrent" = false
 WHERE "isCurrent" = true
   AND "id" <> (
         SELECT "id" FROM "AcademicYear"
          WHERE "isCurrent" = true
          ORDER BY "createdAt" DESC
          LIMIT 1
       );

-- ---------------------------------------------------------------
-- 5) RankingSetting — faqat bitta qator (singleton)
-- ---------------------------------------------------------------
-- Begona id bilan yozilgan qator bo'lsa, migratsiya yiqilmasligi uchun
-- avval tekshiramiz.
DO $$
DECLARE begona integer;
BEGIN
  SELECT count(*) INTO begona FROM "RankingSetting" WHERE "id" <> 'global';
  IF begona > 0 THEN
    RAISE EXCEPTION
      'F2 to''xtatildi: "RankingSetting" jadvalida id <> ''global'' bo''lgan % ta qator bor. Reyting koeffitsienti noaniq — ortiqcha qatorlarni o''chiring.',
      begona;
  END IF;
END $$;

ALTER TABLE "RankingSetting"
  ADD CONSTRAINT "RankingSetting_singleton_check" CHECK ("id" = 'global');

ALTER TABLE "RankingSetting"
  ADD CONSTRAINT "RankingSetting_weights_check" CHECK (
    "gradeWeight" >= 0 AND "gradeWeight" <= 100
    AND "testWeight" >= 0 AND "testWeight" <= 100
    AND ("gradeWeight" + "testWeight") > 0
    AND "penaltyFactor" >= 0
  ) NOT VALID;

-- ---------------------------------------------------------------
-- 6) User — email va phone ikkalasi ham bo'sh bo'lmasin
-- ---------------------------------------------------------------
-- Aks holda hisob yaratiladi, lekin unga HECH QACHON kirib bo'lmaydi
-- (login email yoki telefon orqali ishlaydi).
ALTER TABLE "User"
  ADD CONSTRAINT "User_login_mavjud_check" CHECK (
    "email" IS NOT NULL OR "phone" IS NOT NULL
  );

-- ---------------------------------------------------------------
-- 7) Son chegaralari — CHECK cheklovlari
-- ---------------------------------------------------------------
-- Quyidagilar lokal bazada 0 ta buzilish bergani tekshirilgan:
ALTER TABLE "Quarter"
  ADD CONSTRAINT "Quarter_name_check" CHECK ("name" BETWEEN 1 AND 4);

ALTER TABLE "Grade"
  ADD CONSTRAINT "Grade_value_check" CHECK ("value" BETWEEN 0 AND 100);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_check" CHECK ("amount" > 0);

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_discount_check" CHECK (
    "discountValue" >= 0
    AND ("discountType" <> 'PERCENT'::"DiscountType" OR "discountValue" <= 100)
  );

-- Quyidagilar tekshirilmagan — eski ma'lumot migratsiyani yiqitmasligi
-- uchun NOT VALID. Yangi yozuvlarga darhol ta'sir qiladi.
ALTER TABLE "Class"
  ADD CONSTRAINT "Class_grade_check" CHECK ("grade" BETWEEN 1 AND 11) NOT VALID;

ALTER TABLE "Lesson"
  ADD CONSTRAINT "Lesson_dayOfWeek_check" CHECK ("dayOfWeek" BETWEEN 1 AND 6) NOT VALID;

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_monthlyAmount_check" CHECK ("monthlyAmount" >= 0) NOT VALID;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_amount_check" CHECK ("amount" >= 0) NOT VALID;

ALTER TABLE "PenaltyCriterion"
  ADD CONSTRAINT "PenaltyCriterion_points_check" CHECK ("points" >= 0) NOT VALID;

ALTER TABLE "Penalty"
  ADD CONSTRAINT "Penalty_points_check" CHECK ("points" >= 0) NOT VALID;

ALTER TABLE "TestResult"
  ADD CONSTRAINT "TestResult_score_check" CHECK ("score" >= 0) NOT VALID;

ALTER TABLE "TestResult"
  ADD CONSTRAINT "TestResult_percent_check" CHECK (
    "percent" >= 0 AND "percent" <= 100
  ) NOT VALID;
