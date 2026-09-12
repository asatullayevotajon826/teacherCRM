import { db } from "./db";
import { logError } from "./logger";

/**
 * SABABSIZ KELMAGAN O'QUVCHI — OTA-ONAGA XABAR NAVBATI
 * ===================================================
 *
 * Hozircha faqat `Message` jadvaliga QUEUED holatida yoziladi — haqiqiy
 * yuborish (Eskiz.uz / Play Mobile) 10-bosqichda ulanadi. Shu tufayli davomat
 * bugun ishlaydi, SMS moduli tayyor bo'lganda navbatdagi xabarlar o'z-o'zidan
 * jo'natiladi.
 *
 * NIMA UCHUN ALOHIDA FAYL: bu mantiq ikki joydan chaqiriladi — davomat
 * sahifasi va kunlik jurnal. Uni `"use server"` faylidan `export` qilish
 * XAVFSIZ EMAS: `"use server"` faylidagi har bir eksport ochiq HTTP
 * endpoint'ga aylanadi, ya'ni tashqaridan chaqirib istalgan o'quvchi nomiga
 * xabar navbatga qo'yish mumkin bo'lardi. Shuning uchun umumiy mantiq oddiy
 * kutubxona fayliga chiqarildi — u faqat server kodidan import qilinadi.
 *
 * Takroriy xabar yuborilmasligi uchun bir xil matnli yozuv borligi
 * tekshiriladi — forma qayta saqlansa, ota-ona ikkinchi SMS olmaydi.
 *
 * O'TKAZIB YUBORISHLAR QAYD ETILADI (PR G3c): ilgari bu funksiya xabar
 * navbatga qo'yilmagan holatlarda JIMGINA `continue` qilardi. Natijada
 * "menga xabar kelmadi" degan shikoyatni tekshirishning yo'li yo'q edi —
 * sabab (telefon kiritilmagan / kunlik chegara / takror) hech qayerda
 * qolmasdi. Endi har bir chaqiruv oxirida faqat SONLAR qayd etiladi:
 * o'quvchi ismi, id'si va telefon raqami log'ga TUSHMAYDI.
 */

/**
 * BITTA O'QUVCHI UCHUN BIR KUNDA NAVBATGA QO'YILADIGAN XABAR CHEGARASI.
 *
 * Nima uchun kerak (kelajakdagi teshikni oldindan yopamiz):
 * matn ichida SANA bor, shuning uchun "bir xil matn" tekshiruvi faqat
 * AYNI SHU sanadagi takrorni to'xtatadi. Sana esa formadan keladi.
 * Ya'ni hisobi o'g'irlangan (yoki niyati buzuq) o'qituvchi turli sanalarni
 * yuborib, bitta ota-onaning telefoniga cheksiz SMS yog'dirishi mumkin edi:
 *   - ota-onani bezovta qilish (harassment)
 *   - maktabning SMS balansini yoqib yuborish (pul yo'qotish)
 *   - operator tomonidan raqamning bloklanishi
 *
 * SMS hali ulanmagan, lekin navbat allaqachon to'ldiriladi — modul
 * ulangan kuni navbatdagi hammasi birdan jo'nab ketardi. Shuning uchun
 * chegara HOZIR qo'yiladi.
 *
 * 5 ta — haqiqiy hayot uchun yetarli zaxira: bir o'quvchiga bir kunda
 * ko'pi bilan bitta "kelmadi" xabari boradi.
 */
const MAX_NOTICES_PER_STUDENT_PER_DAY = 5;

/** Bir chaqiruvda navbatga qo'shiladigan xabarlarning umumiy chegarasi. */
const MAX_NOTICES_PER_CALL = 200;

/** Bugungi kunning boshlanishi (server vaqti bo'yicha). */
function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export async function queueAbsenceNotices(
  absentStudentIds: string[],
  dateText: string
): Promise<void> {
  if (absentStudentIds.length === 0) return;

  // Chaqiruv darajasidagi chegara: qo'lda yasalgan ulkan so'rov butun
  // maktabni navbatga tiqib qo'ymasligi kerak.
  const ids = absentStudentIds.slice(0, MAX_NOTICES_PER_CALL);
  const truncated = absentStudentIds.length - ids.length;

  const students = await db.student.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      guardian: { select: { phone: true } },
    },
  });

  const since = startOfToday();

  /**
   * Sonlar — chaqiruv oxirida bittalik qayd uchun.
   * Har bir o'tkazib yuborishga alohida log yozilmaydi: to'la sinf
   * davomatida bu 30 ta bir xil satr degani bo'lardi.
   */
  let queued = 0;
  let skippedNoPhone = 0;
  let skippedDuplicate = 0;
  let skippedDailyCap = 0;

  for (const student of students) {
    const phone = student.guardian?.phone?.trim();
    if (!phone) {
      // Ota-ona telefoni kiritilmagan — xabar jo'natilmaydi. Bu
      // ma'lumot to'liqligi muammosi, admin buni bilishi kerak.
      skippedNoPhone += 1;
      continue;
    }

    const body = `Hurmatli ota-ona! Farzandingiz ${student.lastName} ${student.firstName} ${dateText} kuni darsda qatnashmadi.`;

    const existing = await db.message.findFirst({
      where: { studentId: student.id, body },
      select: { id: true },
    });
    if (existing) {
      // Normal holat: forma qayta saqlangan. Faqat sanaladi.
      skippedDuplicate += 1;
      continue;
    }

    // Kunlik chegara: matn har xil bo'lsa ham (boshqa sana yuborilgan
    // bo'lsa ham) bir o'quvchi nomidan bir kunda ko'p xabar chiqmaydi.
    const todayCount = await db.message.count({
      where: { studentId: student.id, createdAt: { gte: since } },
    });
    if (todayCount >= MAX_NOTICES_PER_STUDENT_PER_DAY) {
      // BU XAVFSIZLIK SIGNALI: kunlik chegaraga urilish odatda
      // sanalarni almashtirib SMS yog'dirish urinishi demakdir.
      skippedDailyCap += 1;
      continue;
    }

    await db.message.create({
      data: { studentId: student.id, toPhone: phone, body, status: "QUEUED" },
    });
    queued += 1;
  }

  // Topilmagan id'lar (o'chirilgan yoki begona o'quvchi) ham sanaladi.
  const notFound = ids.length - students.length;

  /**
   * Faqat DIQQATGA LOYIQ holatlar qayd etiladi — normal ishlash (hammasi
   * navbatga tushdi yoki takror) log'ni to'ldirmasligi kerak.
   *
   * MAXFIYLIK: bu yerga o'quvchi id'si, ismi va telefon raqami
   * ATAYLAB yozilmaydi — faqat sonlar. Aks holda server log'i
   * ota-onalarning telefon ro'yxatiga aylanardi.
   */
  if (skippedNoPhone > 0 || skippedDailyCap > 0 || notFound > 0 || truncated > 0) {
    logError(
      "absence-notice",
      new Error("ba'zi xabarlar navbatga qo'shilmadi"),
      {
        requested: absentStudentIds.length,
        queued,
        skippedNoPhone,
        skippedDuplicate,
        skippedDailyCap,
        notFound,
        truncated,
      }
    );
  }
}
