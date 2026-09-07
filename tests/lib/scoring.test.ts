import { describe, expect, it } from "vitest";
import {
  MAX_TOP_N,
  averageOf,
  clampScore,
  denseRank,
  parseTopN,
} from "../../src/lib/scoring";

describe("averageOf", () => {
  it("bo'sh ro'yxatda null qaytaradi (0 emas)", () => {
    expect(averageOf([])).toBeNull();
  });

  it("bitta qiymatni o'zini qaytaradi", () => {
    expect(averageOf([90])).toBe(90);
  });

  it("bir kasrgacha yumaloqlaydi", () => {
    expect(averageOf([90, 95])).toBe(92.5);
    expect(averageOf([86, 87, 88])).toBe(87);
  });

  it("uzun kasrni kesadi", () => {
    // (90 + 91 + 93) / 3 = 91.333...
    expect(averageOf([90, 91, 93])).toBe(91.3);
  });

  it("0 ballarni hisobga oladi (null bilan aralashtirmaydi)", () => {
    expect(averageOf([0, 0])).toBe(0);
  });
});

describe("clampScore", () => {
  it("manfiy ballni 0 ga ko'taradi", () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(-0.1)).toBe(0);
  });

  it("100 dan oshgan ballni 100 da to'xtatadi", () => {
    expect(clampScore(105)).toBe(100);
  });

  it("oraliqdagi ballni bir kasrga yumaloqlaydi", () => {
    expect(clampScore(92.55)).toBe(92.6);
    expect(clampScore(50)).toBe(50);
  });

  it("chegaralarning o'zini o'zgartirmaydi", () => {
    expect(clampScore(0)).toBe(0);
    expect(clampScore(100)).toBe(100);
  });
});

describe("parseTopN", () => {
  it("bo'sh va yo'q qiymatda null", () => {
    expect(parseTopN(undefined)).toBeNull();
    expect(parseTopN(null)).toBeNull();
    expect(parseTopN("")).toBeNull();
    expect(parseTopN("   ")).toBeNull();
  });

  it("matn-axlatda null", () => {
    expect(parseTopN("abc")).toBeNull();
    expect(parseTopN("7abc")).toBeNull();
    expect(parseTopN({})).toBeNull();
    expect(parseTopN(true)).toBeNull();
  });

  it("musbat bo'lmagan sonda null", () => {
    expect(parseTopN("0")).toBeNull();
    expect(parseTopN("-3")).toBeNull();
    expect(parseTopN("0.5")).toBeNull();
  });

  it("oddiy musbat butun sonni o'qiydi", () => {
    expect(parseTopN("7")).toBe(7);
    expect(parseTopN(7)).toBe(7);
    expect(parseTopN(" 12 ")).toBe(12);
  });

  it("KASR SONNI KESADI — ilgari journal.ts uni rad etardi", () => {
    // Bu qator aynan tuzatilgan nomuvofiqlikni qulflaydi:
    // eski journal.parseTopN("7.9") -> null -> butun ro'yxat ochilardi.
    expect(parseTopN("7.9")).toBe(7);
    expect(parseTopN(1.99)).toBe(1);
  });

  it("yuqori chegarada to'xtaydi", () => {
    expect(parseTopN("9999")).toBe(MAX_TOP_N);
    expect(parseTopN(String(MAX_TOP_N + 1))).toBe(MAX_TOP_N);
    expect(parseTopN(String(MAX_TOP_N))).toBe(MAX_TOP_N);
  });

  it("cheksizlikni rad etadi", () => {
    expect(parseTopN("Infinity")).toBeNull();
    expect(parseTopN(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseTopN(Number.NaN)).toBeNull();
  });

  it("massivning birinchi elementini oladi (FormData)", () => {
    expect(parseTopN(["5", "9"])).toBe(5);
    expect(parseTopN([])).toBeNull();
  });
});

describe("denseRank", () => {
  it("teng ball teng o'rin, keyingisi UZILMAYDI", () => {
    const ranked = denseRank([
      { id: "a", value: 95 },
      { id: "b", value: 95 },
      { id: "c", value: 90 },
      { id: "d", value: 85 },
    ]);

    expect(ranked.get("a")).toBe(1);
    expect(ranked.get("b")).toBe(1);
    expect(ranked.get("c")).toBe(2);
    expect(ranked.get("d")).toBe(3);
  });

  it("null balli qator natijaga tushmaydi", () => {
    const ranked = denseRank([
      { id: "a", value: 90 },
      { id: "b", value: null },
    ]);

    expect(ranked.get("a")).toBe(1);
    expect(ranked.has("b")).toBe(false);
    expect(ranked.size).toBe(1);
  });

  it("kirish tartibi ball kamayishi bo'yicha", () => {
    const ranked = denseRank([
      { id: "past", value: 60 },
      { id: "yuqori", value: 99 },
      { id: "orta", value: 80 },
    ]);

    expect(Array.from(ranked.keys())).toEqual(["yuqori", "orta", "past"]);
  });

  it("tartibsiz kelgan ro'yxatni o'zi tartiblaydi", () => {
    const ranked = denseRank([
      { id: "c", value: 70 },
      { id: "a", value: 100 },
      { id: "b", value: 70 },
    ]);

    expect(ranked.get("a")).toBe(1);
    expect(ranked.get("b")).toBe(2);
    expect(ranked.get("c")).toBe(2);
  });

  it("limit dastlabki N DARAJANI qoldiradi", () => {
    const ranked = denseRank(
      [
        { id: "a", value: 95 },
        { id: "b", value: 95 },
        { id: "c", value: 90 },
        { id: "d", value: 85 },
      ],
      2
    );

    // 1-daraja (ikki bola) va 2-daraja qoladi, 3-daraja tushib qoladi.
    expect(ranked.size).toBe(3);
    expect(ranked.get("a")).toBe(1);
    expect(ranked.get("b")).toBe(1);
    expect(ranked.get("c")).toBe(2);
    expect(ranked.has("d")).toBe(false);
  });

  it("limit bir darajadagi bolalar sonini kesmaydi", () => {
    const ranked = denseRank(
      [
        { id: "a", value: 95 },
        { id: "b", value: 95 },
        { id: "c", value: 95 },
      ],
      1
    );

    // Chegara 1 bo'lsa ham uch bola ham 1-darajada qoladi.
    expect(ranked.size).toBe(3);
  });

  it("null va undefined limit chegara qo'ymaydi", () => {
    const rows = [
      { id: "a", value: 95 },
      { id: "b", value: 90 },
    ];

    expect(denseRank(rows, null).size).toBe(2);
    expect(denseRank(rows, undefined).size).toBe(2);
    expect(denseRank(rows, 0).size).toBe(2);
  });

  it("bo'sh ro'yxatda bo'sh natija", () => {
    expect(denseRank([]).size).toBe(0);
    expect(denseRank([{ id: "a", value: null }]).size).toBe(0);
  });

  it("0 ball ham o'rin oladi (null dan farqli)", () => {
    const ranked = denseRank([
      { id: "a", value: 10 },
      { id: "b", value: 0 },
    ]);

    expect(ranked.get("b")).toBe(2);
  });
});
