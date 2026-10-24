import { describe, expect, it } from "vitest";
import { previewBenefits, selectBenefits, type BenefitContext } from "../server/benefits";

const restaurant: BenefitContext = {
  company: {
    form: "ИП",
    segment: "micro",
    okvedCode: "56.10",
    ageYears: 8,
  },
  financials: {
    revenue: 42_000_000,
    profit: 5_100_000,
    ownCapital: 12_000_000,
  },
  creditHistory: {
    overdueCount: 0,
    worstDelayDays: 0,
  },
};

function expectCompleteDemoDirection(item: ReturnType<typeof selectBenefits>[number]) {
  expect(item.status).toBe("POSSIBLE_DIRECTION");
  expect(item.verificationStatus).toBe("REQUIRES_CHECK");
  expect(item.demo).toBe(true);
  expect(item.program).toBeNull();
  expect(item.applicability.region.length).toBeGreaterThan(0);
  expect(item.applicability.scope.length).toBeGreaterThan(0);
  expect(item.source).toEqual(expect.objectContaining({
    catalog: "Внутренний демонстрационный каталог alfa",
    version: "benefits-demo-v1",
    updatedAt: "2026-10-23",
  }));
  expect(item.source.entry.length).toBeGreaterThan(0);
  expect(item.observedCriteria.length).toBeGreaterThan(0);
  expect(item.unknownCriteria.length).toBeGreaterThan(0);
  expect(item.requiredEvidence.length).toBeGreaterThan(0);
  expect(item.nextStep.length).toBeGreaterThan(0);
  expect(item.whyMatches).toEqual(item.observedCriteria);
  expect(item.requirements).toEqual([...item.unknownCriteria, ...item.requiredEvidence]);
}

describe("benefit preview", () => {
  it("filters and orders selected directions by structured purpose rules", () => {
    const selected = selectBenefits(restaurant);
    const result = previewBenefits(selected, {
      region: "Москва",
      sme_status: "micro",
      purpose: "investment",
      amount: 3_000_000,
      term_months: 24,
      industry: "56.10 · Деятельность ресторанов и услуги по доставке продуктов питания",
    }, {
      okvedCode: "56.10",
      okvedName: "Деятельность ресторанов и услуги по доставке продуктов питания",
    });

    expect(result.items.map(({ item }) => item.id)).toEqual([
      "food-service-modernization",
      "sme-preferential-financing",
    ]);
    expect(result.metadata).toEqual({
      eligibilityChecked: false,
      externalDataUsed: false,
      answersPersisted: false,
    });
    expect(result.items[0]).not.toHaveProperty("score");
    expect(result.items[0]?.reasons.join(" ")).toContain("каноническим ОКВЭД 56.10");
    expect(result.items[0]?.unknowns.join(" ")).toContain("нет подтверждённых региональных ограничений");
    expect(result.items[0]?.unknowns.join(" ")).toContain("нет структурированных лимитов суммы");
    expect(result.items[0]?.unknowns.join(" ")).toContain("нет структурированных ограничений срока");
    expect(result.items[1]?.unknowns.join(" ")).toContain("нет структурированных отраслевых ограничений");
  });

  it("excludes explicit SME-only directions for a non-SME answer", () => {
    const result = previewBenefits(selectBenefits(restaurant), {
      region: "Москва",
      sme_status: "not_sme",
      purpose: "investment",
      industry: "Другая отрасль",
    }, {
      okvedCode: "56.10",
      okvedName: "Деятельность ресторанов и услуги по доставке продуктов питания",
    });

    expect(result.items.map(({ item }) => item.id)).toEqual(["food-service-modernization"]);
    expect(result.items[0]?.unknowns.join(" ")).toContain("а не свободный текст ответа");
  });

  it("keeps deterministic catalog order for an unsupported custom purpose", () => {
    const selected = selectBenefits(restaurant);
    const result = previewBenefits(selected, {
      region: "Москва",
      sme_status: "unknown",
      purpose: "other",
    }, {
      okvedCode: "56.10",
      okvedName: "Деятельность ресторанов и услуги по доставке продуктов питания",
    });

    expect(result.items.map(({ item }) => item.id)).toEqual(selected.map(({ id }) => id));
    expect(result.items.every(({ unknowns }) => unknowns.some((unknown) => unknown.includes("нет структурированного правила совместимости")))).toBe(true);
  });
});

describe("benefit matching", () => {
  it("matches general SME and industry ideas for a restaurant", () => {
    const benefits = selectBenefits(restaurant);

    expect(benefits.map((item) => item.id)).toEqual([
      "sme-preferential-financing",
      "regional-guarantee",
      "food-service-modernization",
    ]);
    benefits.forEach(expectCompleteDemoDirection);

    const foodService = benefits.find((item) => item.id === "food-service-modernization");
    expect(foodService?.source.entry).toBe("Модернизация общественного питания");
    expect(foodService?.observedCriteria.join(" ")).toContain("56.10");
    expect(foodService?.applicability.region).toContain("требуется уточнить");
  });

  it("keeps overdue cases as unverified directions with explicit checks", () => {
    const benefits = selectBenefits({
      company: {
        form: "ООО",
        segment: "micro",
        okvedCode: "46.69",
        ageYears: 1.5,
      },
      financials: {
        revenue: 6_500_000,
        profit: -800_000,
        ownCapital: 400_000,
      },
      creditHistory: {
        overdueCount: 3,
        worstDelayDays: 74,
      },
    });

    expect(benefits.map((item) => item.id)).toEqual(expect.arrayContaining([
      "sme-preferential-financing",
      "regional-guarantee",
      "trade-digitalization-support",
      "young-business-support",
    ]));
    benefits.forEach(expectCompleteDemoDirection);
    expect(benefits[0]?.unknownCriteria.join(" ")).toContain("просроч");
    expect(benefits[0]?.requirements.join(" ")).toContain("просроч");
    expect(benefits.find((item) => item.id === "regional-guarantee")?.unknownCriteria.join(" ")).toContain("просроч");
  });

  it("keeps missing financial and regional evidence in the unknown checklist", () => {
    const benefits = selectBenefits({
      company: {
        form: "ООО",
        segment: "small",
        okvedCode: "41.20",
        ageYears: 5,
      },
      financials: null,
      creditHistory: null,
    });

    expect(benefits.map((item) => item.id)).toEqual([
      "sme-preferential-financing",
      "regional-guarantee",
      "construction-contract-support",
    ]);
    benefits.forEach(expectCompleteDemoDirection);

    const financing = benefits[0];
    expect(financing?.observedCriteria.join(" ")).not.toContain("выручка");
    expect(financing?.unknownCriteria.join(" ")).toContain("отчётность в профиле отсутствует");
    expect(benefits[1]?.applicability.region).toContain("не передан");
    expect(benefits[2]?.unknownCriteria.join(" ")).toContain("контракт");
  });
});
