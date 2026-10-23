import { describe, expect, it } from "vitest";
import { creditTermsSnapshotError, resolveCreditTerms } from "../src/lib/credit-terms";
import type { CreditTerms } from "../src/lib/api";

const completeTerms: CreditTerms = {
  amount: 100_000,
  rate: 12,
  termMonths: 12,
  monthlyPayment: 8_884.88,
  overpayment: 6_618.56,
  totalPayment: 106_618.56,
  paymentType: "ANNUITY",
  validUntil: "2026-10-29T10:30:00.000Z",
  feesIncluded: false,
};

describe("client credit terms snapshot", () => {
  it("uses all stored server values without recalculating them", () => {
    expect(resolveCreditTerms(completeTerms)).toEqual({
      amount: 100_000,
      rate: 12,
      termMonths: 12,
      monthlyPayment: 8_884.88,
      overpayment: 6_618.56,
      totalPayment: 106_618.56,
    });
    expect(creditTermsSnapshotError(completeTerms)).toBeNull();
  });

  it("keeps missing economics empty instead of applying a browser fallback", () => {
    const incomplete = { ...completeTerms, monthlyPayment: undefined, totalPayment: undefined };

    expect(resolveCreditTerms(incomplete)).toMatchObject({
      monthlyPayment: null,
      totalPayment: null,
    });
    expect(creditTermsSnapshotError(incomplete)).toBe("Не указан корректный ежемесячный платёж.");
  });

  it("detects an inconsistent total payment", () => {
    expect(creditTermsSnapshotError({ ...completeTerms, totalPayment: 100_001 }))
      .toBe("Общая выплата не соответствует сумме долга и переплате.");
  });
});
