-- PR G4a: so'rov cheklovi hisoblagichi uchun doimiy jadval.
--
-- Ilgari hisob server xotirasida turardi: qayta ishga tushirish uni nolga
-- qaytarardi va bir nechta instansiyada umumiy bo'lmasdi. Endi hisob
-- bazada — hamma jarayon uchun bitta.
--
-- Mavjud jadvallarga TEGILMAYDI, faqat yangi jadval qo'shiladi.

-- CreateTable
CREATE TABLE "RateHit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateHit_pkey" PRIMARY KEY ("key","windowStart")
);

-- Eskirgan katakchalarni tozalash so'rovi shu indeksdan foydalanadi.
-- CreateIndex
CREATE INDEX "RateHit_windowStart_idx" ON "RateHit"("windowStart");

-- Hisob manfiy bo'lishi mumkin emas. Jadvalga faqat kod yozadi, lekin
-- chegara bazada ham qulflanadi (loyihadagi qolgan CHECK'lar bilan bir xil
-- yondashuv): manfiy hisob cheklovni butunlay o'chirib qo'yish yo'li
-- bo'lardi.
ALTER TABLE "RateHit"
  ADD CONSTRAINT "RateHit_count_check" CHECK ("count" >= 0);
