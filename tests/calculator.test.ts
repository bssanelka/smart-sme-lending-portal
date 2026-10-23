import { describe, expect, it } from "vitest";
import {
  CALCULATOR_DISCLAIMER,
  annuityOverpayment,
  annuityPayment,
  buildDecisionEconomics,
  compatibilityIndexFromScore,
  compatibilityLevelFromIndex,
  calculateCreditPotential,
  chooseProductForCalculation,
  evaluateCalculator,
  parseCanonicalCalculationInput,
  preliminaryTermsFromSnapshot,
  selectProductForNeed,
  toPublicCalculatorEvaluation,
  type CalculatorInput,
} from "../server/calculator";
import { evaluateProductEligibility } from "../server/product-eligibility";

const input: CalculatorInput = {
  amount: 5_000_000,
  termMonths: 24,
  product: { maxAmount: 30_000_000, rateFrom: 15 },
  previousRevenue: 50_000_000,
  refinancing: { activeCredits: 2, totalDebt: 4_000_000, monthlyCreditPayment: 180_000 },
  scoringInput: {
    companyAgeYears: 8,
    revenueAnnual: 60_000_000,
    profitAnnual: 9_000_000,
    bkiScore: 800,
    overdueCount: 0,
    worstDelayDays: 0,
    pdn: 20,
    amountToRevenueRatio: 5_000_000 / 60_000_000,
    hasFinancials: true,
  },
};

describe("automatic product selection", () => {
  const products = [
    { id: 1, code: "express", name: "Экспресс", tagline: "", minAmount: 100_000, maxAmount: 3_000_000, rateFrom: 19.9, termMin: 3, termMax: 12, purposeTags: ["оборотные средства"], minRevenue: 0 },
    { id: 2, code: "working", name: "Оборотный", tagline: "", minAmount: 500_000, maxAmount: 30_000_000, rateFrom: 16.5, termMin: 6, termMax: 36, purposeTags: ["оборотные средства"], minRevenue: 3_000_000 },
    { id: 3, code: "investment", name: "Инвестиционный", tagline: "", minAmount: 1_000_000, maxAmount: 150_000_000, rateFrom: 14.9, termMin: 12, termMax: 84, purposeTags: ["оборудование"], minRevenue: 10_000_000 },
    { id: 4, code: "overdraft", name: "Овердрафт", tagline: "", minAmount: 100_000, maxAmount: 5_000_000, rateFrom: 21, termMin: 3, termMax: 24, purposeTags: ["резерв"], minRevenue: 0 },
  ];

  it("selects the closest exact product without asking the client for a product", () => {
    const selection = selectProductForNeed(products, {
      amount: 1_500_000,
      termMonths: 12,
      purposeCategory: "оборотные средства",
      annualRevenue: 42_000_000,
    });

    expect(selection.recommended.product.code).toBe("express");
    expect(selection.recommended.exactMatch).toBe(true);
    expect(selection.alternatives.length).toBeGreaterThan(0);
  });

  it("creates a canonical selection when the client chooses an eligible alternative", () => {
    const selection = selectProductForNeed(products, {
      amount: 1_500_000,
      termMonths: 12,
      purposeCategory: "оборотные средства",
      annualRevenue: 42_000_000,
    });
    const alternative = selection.alternatives[0];

    const chosen = chooseProductForCalculation(selection, alternative.product.id);

    expect(chosen.source).toBe("CLIENT_ALTERNATIVE");
    expect(chosen.systemRecommendedProductId).toBe(selection.recommended.product.id);
    expect(chosen.selected.product.id).toBe(alternative.product.id);
    expect(chosen.selection.recommended.product.id).toBe(alternative.product.id);
    expect(chosen.selection.alternatives.map((option) => option.product.id)).toContain(selection.recommended.product.id);
  });

  it("rejects a product that was not offered among eligible alternatives", () => {
    const selection = selectProductForNeed(products, {
      amount: 1_500_000,
      termMonths: 12,
      purposeCategory: "оборотные средства",
      annualRevenue: 42_000_000,
    });

    expect(() => chooseProductForCalculation(selection, 999)).toThrow("недоступен среди подходящих вариантов");
  });

  it("adjusts terms only inside an otherwise eligible product", () => {
    const selection = selectProductForNeed(products, {
      amount: 25_000_000,
      termMonths: 60,
      purposeCategory: "оборотные средства",
      annualRevenue: 6_500_000,
    });

    expect(selection.recommended.product.code).toBe("working");
    expect(selection.recommended.exactMatch).toBe(false);
    expect(selection.recommended.amount).toBe(25_000_000);
    expect(selection.recommended.termMonths).toBe(36);
    expect(selection.alternatives.every((option) => option.product.purposeTags.includes("оборотные средства"))).toBe(true);
  });

  it("requires manual review instead of recommending an ineligible catalog product", () => {
    expect(() => selectProductForNeed(products, {
      amount: 25_000_000,
      termMonths: 60,
      purposeCategory: "оборудование",
      annualRevenue: 6_500_000,
    })).toThrow("Нужна ручная проверка");
  });

  it.each(products)("enforces all formalized boundaries for $code", (product) => {
    const purposeCategory = product.purposeTags[0];
    const base = {
      amount: product.minAmount,
      termMonths: product.termMin,
      purposeCategory,
      annualRevenue: product.minRevenue,
    };

    expect(evaluateProductEligibility(product, base).eligible).toBe(true);
    expect(evaluateProductEligibility(product, { ...base, amount: product.maxAmount, termMonths: product.termMax }).eligible).toBe(true);
    expect(evaluateProductEligibility(product, { ...base, amount: product.minAmount - 1 }).violations.map((item) => item.code)).toContain("AMOUNT_MIN");
    expect(evaluateProductEligibility(product, { ...base, amount: product.maxAmount + 1 }).violations.map((item) => item.code)).toContain("AMOUNT_MAX");
    expect(evaluateProductEligibility(product, { ...base, termMonths: product.termMin - 1 }).violations.map((item) => item.code)).toContain("TERM_MIN");
    expect(evaluateProductEligibility(product, { ...base, termMonths: product.termMax + 1 }).violations.map((item) => item.code)).toContain("TERM_MAX");
    expect(evaluateProductEligibility(product, { ...base, annualRevenue: product.minRevenue - 1 }).violations.map((item) => item.code)).toContain("MIN_REVENUE");
    expect(evaluateProductEligibility(product, { ...base, purposeCategory: "несвязанная цель" }).violations.map((item) => item.code)).toContain("PURPOSE");
  });
});

describe("annuity calculations", () => {
  it("calculates monthly payment and overpayment", () => {
    expect(annuityPayment(100_000, 12, 12)).toBeCloseTo(8_884.88, 2);
    expect(annuityOverpayment(100_000, 12, 12)).toBeCloseTo(6_618.56, 2);
  });

  it("supports a zero rate", () => {
    expect(annuityPayment(120_000, 0, 12)).toBe(10_000);
    expect(annuityOverpayment(120_000, 0, 12)).toBe(0);
  });
});

describe("canonical calculator snapshots", () => {
  const inputJson = JSON.stringify({
    product_id: 7,
    amount: 1_500_000,
    term_months: 18,
    purpose_category: "оборудование",
  });

  it("parses only canonical application fields and verifies the product", () => {
    expect(parseCanonicalCalculationInput(inputJson, 7)).toEqual({
      productId: 7,
      amount: 1_500_000,
      termMonths: 18,
      purposeCategory: "оборудование",
    });
    expect(() => parseCanonicalCalculationInput(inputJson, 8)).toThrow("не соответствует");
  });

  it("returns whitelisted preliminary terms without internal score or grade", () => {
    const terms = preliminaryTermsFromSnapshot({
      inputJson,
      resultJson: JSON.stringify({
        result: {
          current: {
            rate: 17.5,
            monthlyPayment: 95_000,
            overpayment: 210_000,
            totalPayment: 1_710_000,
            score: 105,
            internalGrade: "A",
          },
        },
        selection: {
          recommended: { product: { id: 7, name: "Инвестиционный кредит" } },
        },
      }),
      productId: 7,
    });

    expect(terms).toEqual({
      productName: "Инвестиционный кредит",
      amount: 1_500_000,
      termMonths: 18,
      rate: 17.5,
      monthlyPayment: 95_000,
      overpayment: 210_000,
      totalPayment: 1_710_000,
    });
    expect(terms).not.toHaveProperty("score");
    expect(terms).not.toHaveProperty("internalGrade");
  });

  it("requires total payment in the saved preliminary snapshot", () => {
    expect(() => preliminaryTermsFromSnapshot({
      inputJson,
      resultJson: JSON.stringify({
        result: { current: { rate: 17.5, monthlyPayment: 95_000, overpayment: 210_000 } },
        selection: { recommended: { product: { id: 7, name: "Инвестиционный кредит" } } },
      }),
      productId: 7,
    })).toThrow("Общая выплата расчёта");
  });
});

describe("decision economics", () => {
  it("creates a seven-day annuity snapshot from the final terms", () => {
    const economics = buildDecisionEconomics(100_000, 12, 12, "2026-10-22T10:30:00.000Z");

    expect(economics).toEqual({
      monthlyPayment: 8_884.88,
      overpayment: 6_618.56,
      totalPayment: 106_618.56,
      paymentType: "ANNUITY",
      feesIncluded: false,
      validUntil: "2026-10-29T10:30:00.000Z",
    });
  });
});

describe("rule-based calculator", () => {
  it("maps the score to a bounded compatibility index, not a probability", () => {
    expect(compatibilityIndexFromScore(-100)).toBe(0);
    expect(compatibilityIndexFromScore(52.5)).toBe(50);
    expect(compatibilityIndexFromScore(105)).toBe(100);
    expect(compatibilityIndexFromScore(1_000)).toBe(100);
    expect(compatibilityLevelFromIndex(90)).toBe("HIGH");
    expect(compatibilityLevelFromIndex(60)).toBe("MEDIUM");
    expect(compatibilityLevelFromIndex(20)).toBe("MANUAL_REVIEW");
  });

  it("limits credit potential by product, grade share, and payment capacity", () => {
    expect(calculateCreditPotential({
      productMax: 100_000_000,
      annualRevenue: 20_000_000,
      grade: "B",
      pdn: 20,
      annualRate: 20,
      termMonths: 24,
    })).toMatchObject({
      riskShare: 0.25,
      revenueLimit: 5_000_000,
      finalLimit: 5_000_000,
    });

    expect(calculateCreditPotential({
      productMax: 100_000_000,
      annualRevenue: 20_000_000,
      grade: "B",
      pdn: 60,
      annualRate: 20,
      termMonths: 24,
    }).finalLimit).toBe(0);
  });

  it("returns current and hypothetical scenario without mutating facts", () => {
    const originalScoringInput = { ...input.scoringInput };
    const result = evaluateCalculator(input, { bkiScore: 450, pdn: 80, marginPercent: -10 });

    expect(result.methodology).toBe("rule_based");
    expect(result.disclaimer).toBe(CALCULATOR_DISCLAIMER);
    expect(result.disclaimer).toContain("не решением банка");
    expect(result.disclaimer).toContain("не является вероятностью одобрения");
    expect(result.current.internalGrade).toBe("A");
    expect(result.current.rate).toBeGreaterThanOrEqual(input.product.rateFrom);
    expect(result.current.margin).toBe(15);
    expect(result.current.revenueGrowth).toBe(20);
    expect(result.current.totalPayment).toBe(result.current.monthlyPayment * input.termMonths);
    expect(result.scenario).toMatchObject({
      internalGrade: "D",
      margin: -10,
      creditPotential: 0,
    });
    expect(result.scenario!.compatibilityIndex).toBeGreaterThanOrEqual(0);
    expect(result.scenario!.compatibilityIndex).toBeLessThanOrEqual(100);
    expect(result.scenario!.compatibilityLevel).toBe("MANUAL_REVIEW");
    expect(result.current.publicFactors.map((factor) => factor.key))
      .toEqual(["bki", "overdue", "pdn", "amount_ratio", "revenue_trend"]);
    expect(result.current.recommendations[0]).toMatchObject({ kind: "maintain" });
    expect(input.scoringInput).toEqual(originalScoringInput);
  });

  it("returns null scenario when overrides are absent", () => {
    expect(evaluateCalculator(input).scenario).toBeNull();
  });

  it("shows refinancing as an optional improvement for elevated debt load", () => {
    const result = evaluateCalculator({
      ...input,
      scoringInput: { ...input.scoringInput, pdn: 40 },
    });
    expect(result.current.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "refinancing",
        title: "Рассмотрите возможность рефинансирования",
        mode: "ADVISORY_ONLY",
        comparison: { status: "NOT_CALCULATED" },
      }),
    ]));
    const refinancing = result.current.recommendations.find((item) => item.kind === "refinancing");
    expect(refinancing?.description).toContain("не расчёт выгоды");
    expect(refinancing?.requiredData).toEqual(["Остатки долга", "Текущие ставки", "Оставшиеся сроки", "Комиссии", "Новые условия"]);
  });

  it("does not suggest refinancing without a verifiable current debt context", () => {
    const result = evaluateCalculator({
      ...input,
      refinancing: { activeCredits: 0, totalDebt: 0, monthlyCreditPayment: 0 },
      scoringInput: { ...input.scoringInput, pdn: 40 },
    });
    expect(result.current.recommendations.some((item) => item.kind === "refinancing")).toBe(false);
  });

  it("does not expose internal score or grade in the client response", () => {
    const result = toPublicCalculatorEvaluation(evaluateCalculator(input));
    expect(result.current.totalPayment).toBeGreaterThan(input.amount);
    expect(result.current).not.toHaveProperty("score");
    expect(result.current).not.toHaveProperty("internalGrade");
  });
});
