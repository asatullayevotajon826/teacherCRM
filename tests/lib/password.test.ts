import { describe, expect, it } from "vitest";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordError,
  passwordRuleText,
  passwordSchema,
} from "@/lib/password";

/**
 * PAROL SIYOSATI TESTLARI
 * =======================
 *
 * Maqsad: siyosat kelajakda TASODIFAN o'zgarmasin. Chegara (8) tizim
 * egasining ataylab qabul qilgan qarori — shuning uchun u aniq raqam bilan
 * qulflangan. Agar kimdir uni jimgina o'zgartirsa yoki zaif parol / naqsh
 * tekshiruvini olib tashlasa, shu testlar darhol qizil bo'ladi.
 *
 * H4e: chegara 12 dan 8 ga tushirildi. Uzunlikka bog'liq testlar
 * yangilandi, QOLGAN tekshiruvlar (harf+raqam, lug'at, naqsh) o'z kuchida.
 *
 * Testlarda ishlatilgan parollar — shartli namunalar, hech qanday haqiqiy
 * hisobga tegishli emas.
 */

describe("parol siyosati chegaralari", () => {
  it("minimal uzunlik 8 (jimgina o'zgartirilmasin)", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it("maksimal uzunlik 128 (bcrypt jim qirqib tashlamasin)", () => {
    expect(MAX_PASSWORD_LENGTH).toBe(128);
  });
});

describe("to'g'ri parollar qabul qilinadi", () => {
  const yaxshi = [
    "Bahor7uz",
    "Toshkent7Bahor",
    "Xavfsiz-Kalit-2026",
    "gulnoza7navoiy9kitob",
    "7Yanvar-Quyosh-Tong",
  ];

  for (const value of yaxshi) {
    it(`qabul qiladi: ${value}`, () => {
      expect(passwordError(value)).toBeNull();
      expect(passwordSchema.safeParse(value).success).toBe(true);
    });
  }
});

describe("chegara aynan 8 da turadi", () => {
  it("8 belgi QABUL qilinadi (yangi chegara)", () => {
    const value = "Abkr7mzq"; // 8 belgi
    expect(value).toHaveLength(8);
    expect(passwordError(value)).toBeNull();
  });

  it("7 belgi yetmaydi", () => {
    const value = "Abkr7mz"; // 7 belgi
    expect(value).toHaveLength(7);
    expect(passwordError(value)).toContain("8");
  });

  it("bo'sh qiymat rad etiladi", () => {
    expect(passwordError("")).not.toBeNull();
  });

  it("128 dan uzun parol rad etiladi", () => {
    const value = `A7${"xkqmzr".repeat(30)}`;
    expect(value.length).toBeGreaterThan(MAX_PASSWORD_LENGTH);
    expect(passwordError(value)).not.toBeNull();
  });
});

describe("harf va raqam talabi", () => {
  it("faqat harflardan iborat parol rad etiladi", () => {
    expect(passwordError("Toshkentbahorkuz")).not.toBeNull();
  });

  it("faqat raqamlardan iborat parol rad etiladi", () => {
    expect(passwordError("839204751628")).not.toBeNull();
  });

  /**
   * Chegara tushgani uchun eng ehtimolli yangi xato — 8 belgili, lekin
   * faqat harfdan iborat parol ("Toshkent"). Tekshirilib turadi.
   */
  it("8 belgi yetadi, lekin raqamsiz bo'lsa ham rad etiladi", () => {
    expect(passwordError("Toshkent")).not.toBeNull();
  });
});

describe("lug'at hujumiga qarshi", () => {
  const zaif = [
    "Parol123",
    "password2026x",
    "Qwerty12",
    "admin123Maktab",
    "Iloveyou2026!",
    "welcome2026abc",
  ];

  for (const value of zaif) {
    it(`rad etadi: ${value}`, () => {
      expect(passwordError(value)).not.toBeNull();
    });
  }

  it("katta-kichik harf bilan yashirishga urinish ham to'xtatiladi", () => {
    expect(passwordError("PaSsWoRd2026x")).not.toBeNull();
  });

  /**
   * MUHIM: chegara 8 ga tushgani uchun aynan bu qatlam eng ko'p ishlaydi.
   * Qisqa va mashhur parollar ("abc12345") endi uzunlik bo'yicha o'tadi,
   * lekin lug'at bo'yicha to'xtatiladi.
   */
  it("qisqa va mashhur parol uzunlikdan o'tsa ham to'xtatiladi", () => {
    expect(passwordError("abc12345")).not.toBeNull();
    expect(passwordError("Parol123")).not.toBeNull();
  });
});

describe("naqsh (pattern) tekshiruvi", () => {
  it("bir xil belgi 4 marta takrorlanmaydi", () => {
    expect(passwordError("Toshkentaaaa7")).not.toBeNull();
  });

  it("8 belgili parolda ham takror to'xtatiladi", () => {
    expect(passwordError("Tosh7aaaa")).not.toBeNull();
  });

  it("3 marta takror ruxsat etiladi", () => {
    expect(passwordError("Toshkentaaa7b")).toBeNull();
  });

  it("ketma-ket oshib boruvchi qator rad etiladi", () => {
    expect(passwordError("Toshkentefghij")).not.toBeNull();
  });

  it("ketma-ket kamayib boruvchi qator rad etiladi", () => {
    expect(passwordError("Toshkent98765x")).not.toBeNull();
  });
});

describe("qoida matni", () => {
  it("uch tilda ham chegara raqamini ko'rsatadi", () => {
    for (const locale of ["uz", "ru", "en"]) {
      expect(passwordRuleText(locale)).toContain(String(MIN_PASSWORD_LENGTH));
    }
  });

  it("noma'lum til uchun o'zbekcha matn qaytaradi", () => {
    expect(passwordRuleText("tr")).toBe(passwordRuleText("uz"));
  });
});
