import { describe, expect, it } from "vitest";
import { selectBenefits, type BenefitContext } from "../server/benefits";

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
