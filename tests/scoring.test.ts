import { describe, expect, it } from "vitest";
import {
  SCORECARD_FACTOR_COUNT,
  SCORECARD_MAX_SCORE,
  SCORECARD_VERSION,
  gradeOf,
  proposeDecision,
  proposeDecisionFromGrade,
  scoreApplication,
  validateDecisionRate,
  type ScoringInput,
} from "../server/scoring";

const healthyInput: ScoringInput = {
  companyAgeYears: 8,
  revenueAnnual: 60_000_000,
  profitAnnual: 8_000_000,
  bkiScore: 800,
  overdueCount: 0,
  worstDelayDays: 0,
  pdn: 20,
  amountToRevenueRatio: 0.2,
  hasFinancials: true,
};

describe("gradeOf", () => {
  it.each([
    [49, "D"],
    [50, "C"],
    [69, "C"],
    [70, "B"],
    [84, "B"],
    [85, "A"],
  ] as const)("maps score %s to grade %s", (score, grade) => {
    expect(gradeOf(score)).toBe(grade);
  });
});

describe("scoreApplication", () => {
  it("returns an explainable A score for a low-risk borrower", () => {
    const result = scoreApplication(healthyInput);

    expect(result.scorecardVersion).toBe(SCORECARD_VERSION);
    expect(result.grade).toBe("A");
    expect(result.score).toBe(SCORECARD_MAX_SCORE);
    expect(result.factors).toHaveLength(SCORECARD_FACTOR_COUNT);
    expect(result.factors.every((factor) => factor.explanation.length > 0)).toBe(true);
  });

  it("returns the documented minimum when all seven risk factors are adverse", () => {
    const result = scoreApplication({
      ...healthyInput,
      companyAgeYears: 0.5,
      revenueAnnual: 900_000,
      profitAnnual: -2_000_000,
      bkiScore: 450,
      overdueCount: 3,
      worstDelayDays: 90,
      pdn: 80,
      amountToRevenueRatio: 2,
    });

    expect(result.grade).toBe("D");
    expect(result.score).toBe(-70);
    expect(result.factors).toHaveLength(SCORECARD_FACTOR_COUNT);
  });

  it("keeps data completeness outside the seven-factor scorecard", () => {
    const result = scoreApplication({ ...healthyInput, hasFinancials: false });

    expect(result.score).toBe(SCORECARD_MAX_SCORE);
    expect(result.factors).toHaveLength(SCORECARD_FACTOR_COUNT);
    expect(result.factors.some((factor) => factor.key === "completeness")).toBe(false);
    expect(proposeDecision({ ...healthyInput, hasFinancials: false }, 18, 2_000_000, 12).type).toBe("MORE_INFO");
  });
});

describe("validateDecisionRate", () => {
  it("accepts the product floor and realistic rates", () => {
    expect(validateDecisionRate(14.9, 14.9)).toBeNull();
    expect(validateDecisionRate(27.5, 14.9)).toBeNull();
  });

  it("rejects rates below the selected product floor and above 100%", () => {
    expect(validateDecisionRate(14.89, 14.9)).toContain("ниже базовой ставки");
    expect(validateDecisionRate(100.01, 14.9)).toContain("100%");
  });
});

describe("proposeDecision", () => {
  it("proposes changed conditions rather than an automatic rejection for grade C", () => {
    const input: ScoringInput = {
      companyAgeYears: 2,
      revenueAnnual: 5_000_000,
      profitAnnual: 500_000,
      bkiScore: 650,
      overdueCount: 1,
      worstDelayDays: 10,
      pdn: 40,
      amountToRevenueRatio: 0.4,
      hasFinancials: true,
    };

    expect(scoreApplication(input).grade).toBe("C");
    expect(proposeDecision(input, 18, 2_000_000, 36)).toMatchObject({
      type: "CONDITIONS",
      rate: 21,
      amount: 2_000_000,
      termMonths: 24,
    });
  });

  it("keeps a grade C recommendation inside product amount and term limits", () => {
    expect(proposeDecisionFromGrade("C", { ...healthyInput, revenueAnnual: 100_000 }, 20, 50_000, 2, {
      minAmount: 100_000,
      maxAmount: 3_000_000,
      termMin: 3,
      termMax: 12,
    })).toMatchObject({
      type: "CONDITIONS",
      amount: 100_000,
      termMonths: 3,
    });
  });

  it("proposes rejection for grade D", () => {
    const input: ScoringInput = {
      ...healthyInput,
      companyAgeYears: 0.5,
      revenueAnnual: 900_000,
      profitAnnual: -2_000_000,
      bkiScore: 450,
      overdueCount: 3,
      worstDelayDays: 90,
      pdn: 80,
      amountToRevenueRatio: 2,
    };

    expect(proposeDecision(input, 20, 1_000_000, 12)).toMatchObject({
      type: "REJECT",
      rate: null,
      amount: null,
      termMonths: null,
    });
  });
});
