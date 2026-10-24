import { scoreApplication, type ScoringInput, type ScoreFactor } from "./scoring";
import {
  ProductEligibilityError,
  evaluateProductEligibility,
  formatEligibilityError,
  type EligibleProduct,
} from "./product-eligibility";

export const CALCULATOR_METHODOLOGY = "rule_based" as const;
export const CALCULATOR_DISCLAIMER =
  "Расчёт является предварительной индикативной оценкой по правилам, а не решением банка или офертой. Индекс соответствия отражает прохождение правил текущей балльной карты и не является вероятностью одобрения. Итоговые условия определяются после проверки данных и кредитного анализа. Комиссии, страхование, штрафы и иные платежи в демонстрационной модели не рассчитываются и не включены; общая выплата не является ПСК или юридической офертой.";

export interface CalculatorProduct {
  maxAmount: number;
  rateFrom: number;
}

export interface CalculatorScenario {
  bkiScore?: number;
  pdn?: number;
  marginPercent?: number;
}

export interface CalculatorInput {
  amount: number;
  termMonths: number;
  product: CalculatorProduct;
  scoringInput: ScoringInput;
  previousRevenue: number | null;
  refinancing: {
    activeCredits: number;
    totalDebt: number;
    monthlyCreditPayment: number;
  } | null;
}

export interface RateAdjustment {
  key: "bki" | "overdue" | "pdn" | "revenue_trend";
  label: string;
  adjustment: number;
  explanation: string;
}

export interface PublicFactor {
  key: string;
  label: string;
  value: string;
  impact: "positive" | "neutral" | "negative";
  explanation: string;
}

export interface CalculatorRecommendation {
  kind: "bki" | "overdue" | "pdn" | "refinancing" | "revenue" | "margin" | "amount" | "maintain";
  title: string;
  description: string;
  suggestedAmount?: number;
  mode?: "ADVISORY_ONLY";
  comparison?: { status: "NOT_CALCULATED" };
  requiredData?: string[];
}

export type CompatibilityLevel = "HIGH" | "MEDIUM" | "MANUAL_REVIEW";

export interface CalculatorVariantResult {
  score: number;
  internalGrade: "A" | "B" | "C" | "D";
  compatibilityIndex: number;
  compatibilityLevel: CompatibilityLevel;
  rate: number;
  monthlyPayment: number;
  overpayment: number;
  totalPayment: number;
  creditPotential: number;
  revenueGrowth: number | null;
  margin: number | null;
  publicFactors: PublicFactor[];
  recommendations: CalculatorRecommendation[];
}

export interface CalculatorEvaluation {
  current: CalculatorVariantResult;
  scenario: CalculatorVariantResult | null;
  disclaimer: string;
  methodology: typeof CALCULATOR_METHODOLOGY;
}

export type PublicCalculatorVariantResult = Omit<CalculatorVariantResult, "score" | "internalGrade">;

export interface PublicCalculatorEvaluation {
  current: PublicCalculatorVariantResult;
  scenario: PublicCalculatorVariantResult | null;
  disclaimer: string;
  methodology: typeof CALCULATOR_METHODOLOGY;
}

export interface NeedProduct extends EligibleProduct {
  tagline: string;
}

export interface ProductOptionEconomics {
  compatibilityIndex: number;
  compatibilityLevel: CompatibilityLevel;
  rate: number;
  monthlyPayment: number;
  overpayment: number;
  totalPayment: number;
}

export interface ProductSelectionOption {
  product: NeedProduct;
  amount: number;
  termMonths: number;
  exactMatch: boolean;
  reasons: string[];
  economics?: ProductOptionEconomics;
}

export interface ProductSelection {
  requested: { amount: number; termMonths: number; purposeCategory: string };
  recommended: ProductSelectionOption;
  alternatives: ProductSelectionOption[];
}

const UI_ALTERNATIVE_LIMIT = 2;
const rankedOptionsBySelection = new WeakMap<ProductSelection, ProductSelectionOption[]>();
const eligibilityConflictsBySelection = new WeakMap<ProductSelection, Map<number, string>>();

function rememberSelectionContext(
  selection: ProductSelection,
  rankedOptions: ProductSelectionOption[],
  eligibilityConflicts: Map<number, string>,
): ProductSelection {
  rankedOptionsBySelection.set(selection, rankedOptions);
  eligibilityConflictsBySelection.set(selection, eligibilityConflicts);
  return selection;
}

export type CalculationSelectionSource = "SYSTEM_RECOMMENDED" | "CLIENT_SELECTED" | "CLIENT_ALTERNATIVE";

export function chooseProductForCalculation(selection: ProductSelection, productId?: number): {
  selected: ProductSelectionOption;
  selection: ProductSelection;
  source: CalculationSelectionSource;
  systemRecommendedProductId: number;
} {
  const systemRecommendedProductId = selection.recommended.product.id;
  if (productId === undefined) {
    return { selected: selection.recommended, selection, source: "SYSTEM_RECOMMENDED", systemRecommendedProductId };
  }
  if (productId === systemRecommendedProductId) {
    return { selected: selection.recommended, selection, source: "CLIENT_SELECTED", systemRecommendedProductId };
  }

  const options = rankedOptionsBySelection.get(selection) ?? [selection.recommended, ...selection.alternatives];
  const selected = options.find((option) => option.product.id === productId);
  if (!selected) {
    const conflict = eligibilityConflictsBySelection.get(selection)?.get(productId);
    throw new ProductEligibilityError(conflict
      ?? `Продукт №${productId} отсутствует в текущем каталоге или недоступен для расчёта`);
  }

  const eligibilityConflicts = eligibilityConflictsBySelection.get(selection) ?? new Map<number, string>();
  const selectedSelection = rememberSelectionContext({
    requested: selection.requested,
    recommended: selected,
    alternatives: options
      .filter((option) => option.product.id !== productId)
      .slice(0, UI_ALTERNATIVE_LIMIT),
  }, options, eligibilityConflicts);

  return {
    selected,
    selection: selectedSelection,
    source: "CLIENT_ALTERNATIVE",
    systemRecommendedProductId,
  };
}

export interface CanonicalCalculationInput {
  productId: number;
  amount: number;
  termMonths: number;
  purposeCategory: string;
}

export interface PreliminaryTerms {
  productName: string;
  amount: number;
  termMonths: number;
  rate: number;
  monthlyPayment: number;
  overpayment: number;
  totalPayment: number;
}

export interface DecisionEconomics {
  monthlyPayment: number;
  overpayment: number;
  totalPayment: number;
  paymentType: "ANNUITY";
  feesIncluded: false;
  validUntil: string;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;
const roundPercent = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function selectProductForNeed(
  products: NeedProduct[],
  need: { amount: number; termMonths: number; purposeCategory: string; annualRevenue: number },
): ProductSelection {
  if (products.length === 0) throw new Error("Кредитные продукты не настроены");

  const candidates = products.map((product) => {
    const amount = clamp(need.amount, product.minAmount, product.maxAmount);
    const termMonths = clamp(need.termMonths, product.termMin, product.termMax);
    const eligibility = evaluateProductEligibility(product, { ...need, amount, termMonths });
    const exactMatch = eligibility.eligible && amount === need.amount && termMonths === need.termMonths;
    const amountChange = Math.abs(amount - need.amount) / Math.max(need.amount, 1);
    const termChange = Math.abs(termMonths - need.termMonths) / Math.max(need.termMonths, 1);
    const changeScore = amountChange + termChange;
    const fitScore = product.maxAmount / Math.max(need.amount, 1) + (product.termMax - product.termMin) / 100;
    const reasons = exactMatch
      ? [`Сумма ${Math.round(need.amount).toLocaleString("ru-RU")} ₽ и срок ${need.termMonths} мес. входят в условия продукта.`]
      : [
          amount !== need.amount
            ? `Ближайшая доступная сумма — ${Math.round(amount).toLocaleString("ru-RU")} ₽.`
            : `Сумма ${Math.round(amount).toLocaleString("ru-RU")} ₽ доступна по продукту.`,
          termMonths !== need.termMonths
            ? `Ближайший доступный срок — ${termMonths} мес.`
            : `Срок ${termMonths} мес. доступен по продукту.`,
        ];
    reasons.push(`Продукт соответствует цели «${need.purposeCategory}».`);
    reasons.push(`Выручка соответствует минимуму продукта ${product.minRevenue.toLocaleString("ru-RU")} ₽.`);
    reasons.push(`Базовая ставка продукта — от ${product.rateFrom}%.`);
    return { product, amount, termMonths, exactMatch, purposeMatches: eligibility.purposeMatches, changeScore, fitScore, reasons, eligibility };
  });
  const ranked = candidates.filter((item) => item.eligibility.eligible).sort((left, right) => {
    if (left.exactMatch !== right.exactMatch) return left.exactMatch ? -1 : 1;
    if (left.exactMatch && right.exactMatch) {
      if (left.purposeMatches !== right.purposeMatches) return left.purposeMatches ? -1 : 1;
      if (left.fitScore !== right.fitScore) return left.fitScore - right.fitScore;
    } else {
      if (left.changeScore !== right.changeScore) return left.changeScore - right.changeScore;
      if (left.purposeMatches !== right.purposeMatches) return left.purposeMatches ? -1 : 1;
    }
    if (left.product.rateFrom !== right.product.rateFrom) return left.product.rateFrom - right.product.rateFrom;
    return left.product.id - right.product.id;
  });

  if (ranked.length === 0) {
    throw new ProductEligibilityError(`Нужна ручная проверка: для цели «${need.purposeCategory}» и годовой выручки ${need.annualRevenue.toLocaleString("ru-RU")} ₽ нет продукта, одновременно соответствующего формализованным ограничениям.`);
  }

  const toOption = (item: typeof ranked[number]): ProductSelectionOption => ({
    product: item.product,
    amount: item.amount,
    termMonths: item.termMonths,
    exactMatch: item.exactMatch,
    reasons: item.reasons,
  });

  const rankedOptions = ranked.map(toOption);
  const eligibilityConflicts = new Map(candidates
    .filter((item) => !item.eligibility.eligible)
    .map((item) => [item.product.id, formatEligibilityError(item.product, item.eligibility)]));

  return rememberSelectionContext({
    requested: { amount: need.amount, termMonths: need.termMonths, purposeCategory: need.purposeCategory },
    recommended: rankedOptions[0],
    alternatives: rankedOptions.slice(1, UI_ALTERNATIVE_LIMIT + 1),
  }, rankedOptions, eligibilityConflicts);
}

export function annuityPayment(principal: number, annualRate: number, termMonths: number): number {
  if (!Number.isFinite(principal) || principal < 0) throw new Error("Сумма кредита должна быть неотрицательной");
  if (!Number.isFinite(annualRate) || annualRate < 0) throw new Error("Ставка должна быть неотрицательной");
  if (!Number.isInteger(termMonths) || termMonths <= 0) throw new Error("Срок должен быть положительным целым числом месяцев");
  if (principal === 0) return 0;

  const monthlyRate = annualRate / 1200;
  if (monthlyRate === 0) return roundMoney(principal / termMonths);
  const growth = (1 + monthlyRate) ** termMonths;
  return roundMoney(principal * monthlyRate * growth / (growth - 1));
}

export function annuityOverpayment(principal: number, annualRate: number, termMonths: number): number {
  return roundMoney(Math.max(0, annuityPayment(principal, annualRate, termMonths) * termMonths - principal));
}

function parseJsonObject(json: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`${label} содержит некорректный JSON`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} должен быть объектом`);
  }
  return value as Record<string, unknown>;
}

function objectField(record: Record<string, unknown>, key: string, label: string): Record<string, unknown> {
  const value = record[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} отсутствует в snapshot`);
  }
  return value as Record<string, unknown>;
}

function finiteNumberField(record: Record<string, unknown>, key: string, label: string, minimum = 0): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} содержит некорректное значение`);
  }
  return value;
}

export function parseCanonicalCalculationInput(inputJson: string, expectedProductId: number): CanonicalCalculationInput {
  const input = parseJsonObject(inputJson, "Параметры расчёта");
  const productId = finiteNumberField(input, "product_id", "Продукт расчёта", 1);
  const amount = finiteNumberField(input, "amount", "Сумма расчёта", Number.MIN_VALUE);
  const termMonths = finiteNumberField(input, "term_months", "Срок расчёта", 1);
  const purposeCategory = input.purpose_category;

  if (!Number.isInteger(productId) || productId !== expectedProductId) {
    throw new Error("Продукт расчёта не соответствует сохранённому snapshot");
  }
  if (!Number.isInteger(termMonths)) throw new Error("Срок расчёта должен быть целым числом месяцев");
  if (typeof purposeCategory !== "string" || purposeCategory.trim().length === 0) {
    throw new Error("Категория цели отсутствует в snapshot");
  }

  return { productId, amount, termMonths, purposeCategory: purposeCategory.trim() };
}

export function preliminaryTermsFromSnapshot(input: {
  inputJson: string;
  resultJson: string;
  productId: number;
}): PreliminaryTerms {
  const canonical = parseCanonicalCalculationInput(input.inputJson, input.productId);
  const snapshot = parseJsonObject(input.resultJson, "Результат расчёта");
  const evaluation = objectField(snapshot, "result", "Результат оценки");
  const current = objectField(evaluation, "current", "Текущий вариант оценки");
  const selection = objectField(snapshot, "selection", "Выбор продукта");
  const recommended = objectField(selection, "recommended", "Рекомендованный вариант");
  const product = objectField(recommended, "product", "Продукт расчёта");
  const snapshotProductId = finiteNumberField(product, "id", "Идентификатор продукта", 1);
  const productName = product.name;
  const rate = finiteNumberField(current, "rate", "Ставка расчёта");
  const monthlyPayment = finiteNumberField(current, "monthlyPayment", "Ежемесячный платёж расчёта");
  const overpayment = finiteNumberField(current, "overpayment", "Переплата расчёта");
  const totalPayment = finiteNumberField(current, "totalPayment", "Общая выплата расчёта");

  if (!Number.isInteger(snapshotProductId) || snapshotProductId !== canonical.productId) {
    throw new Error("Продукт результата не соответствует параметрам расчёта");
  }
  if (typeof productName !== "string" || productName.trim().length === 0) {
    throw new Error("Название продукта отсутствует в snapshot");
  }

  return {
    productName: productName.trim(),
    amount: canonical.amount,
    termMonths: canonical.termMonths,
    rate,
    monthlyPayment,
    overpayment,
    totalPayment,
  };
}

export function buildDecisionEconomics(
  amount: number,
  annualRate: number,
  termMonths: number,
  decidedAt = new Date().toISOString(),
): DecisionEconomics {
  const validUntil = new Date(decidedAt);
  if (!Number.isFinite(validUntil.getTime())) throw new Error("Дата решения некорректна");
  validUntil.setUTCDate(validUntil.getUTCDate() + 7);

  const monthlyPayment = annuityPayment(amount, annualRate, termMonths);
  const overpayment = annuityOverpayment(amount, annualRate, termMonths);
  return {
    monthlyPayment,
    overpayment,
    totalPayment: roundMoney(amount + overpayment),
    paymentType: "ANNUITY",
    feesIncluded: false,
    validUntil: validUntil.toISOString(),
  };
}

export interface CompleteOfferEconomics extends DecisionEconomics {
  amount: number;
  rate: number;
  termMonths: number;
}

export function decisionEconomicsSnapshotError(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "Финансовый snapshot предложения отсутствует";
  }
  const snapshot = value as Record<string, unknown>;
  const amount = snapshot.amount;
  const rate = snapshot.rate;
  const termMonths = snapshot.termMonths;
  const monthlyPayment = snapshot.monthlyPayment;
  const overpayment = snapshot.overpayment;
  const totalPayment = snapshot.totalPayment;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return "Не указана корректная сумма основного долга";
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) return "Не указана корректная годовая ставка";
  if (typeof termMonths !== "number" || !Number.isInteger(termMonths) || termMonths <= 0) return "Не указан корректный срок кредита";
  if (typeof monthlyPayment !== "number" || !Number.isFinite(monthlyPayment) || monthlyPayment < 0) return "Не указан корректный ежемесячный платёж";
  if (typeof overpayment !== "number" || !Number.isFinite(overpayment) || overpayment < 0) return "Не указана корректная переплата";
  if (typeof totalPayment !== "number" || !Number.isFinite(totalPayment) || totalPayment < amount) return "Не указана корректная общая выплата";
  if (snapshot.paymentType !== "ANNUITY") return "Не указан поддерживаемый тип платежа";
  if (snapshot.feesIncluded !== false) return "Не зафиксировано отсутствие комиссий в расчёте";
  if (typeof snapshot.validUntil !== "string" || !Number.isFinite(Date.parse(snapshot.validUntil))) return "Не указан корректный срок действия предложения";
  if (roundMoney(amount + overpayment) !== roundMoney(totalPayment)) return "Общая выплата не соответствует сумме долга и переплате";
  return null;
}

export function requireDecisionEconomicsSnapshot(value: unknown): CompleteOfferEconomics {
  const error = decisionEconomicsSnapshotError(value);
  if (error) throw new Error(error);
  return value as CompleteOfferEconomics;
}

export function compatibilityIndexFromScore(score: number): number {
  if (!Number.isFinite(score)) throw new Error("Скоринговый балл должен быть конечным числом");
  return Math.round(clamp(score, 0, 105) / 105 * 100);
}

export function compatibilityLevelFromIndex(index: number): CompatibilityLevel {
  if (!Number.isFinite(index)) throw new Error("Индекс соответствия должен быть конечным числом");
  if (index >= 80) return "HIGH";
  if (index >= 50) return "MEDIUM";
  return "MANUAL_REVIEW";
}

export function revenueGrowth(currentRevenue: number, previousRevenue: number | null): number | null {
  if (previousRevenue === null || previousRevenue <= 0) return null;
  return roundPercent((currentRevenue - previousRevenue) / previousRevenue * 100);
}

function principalForPayment(monthlyPayment: number, annualRate: number, termMonths: number): number {
  if (monthlyPayment <= 0) return 0;
  const paymentForOneRuble = annuityPayment(1_000_000, annualRate, termMonths) / 1_000_000;
  return paymentForOneRuble > 0 ? monthlyPayment / paymentForOneRuble : 0;
}

export function calculateCreditPotential(input: {
  productMax: number;
  annualRevenue: number;
  grade: "A" | "B" | "C" | "D";
  pdn: number;
  annualRate: number;
  termMonths: number;
}) {
  const riskShares = { A: 0.35, B: 0.25, C: 0.15, D: 0.05 } as const;
  const riskShare = riskShares[input.grade];
  const revenueLimit = Math.max(0, input.annualRevenue * riskShare);
  const targetPdn = 50;
  const availablePdnShare = Math.max(0, targetPdn - input.pdn) / 100;
  const affordableMonthlyPayment = Math.max(0, input.annualRevenue / 12 * availablePdnShare);
  const paymentCapacityLimit = principalForPayment(affordableMonthlyPayment, input.annualRate, input.termMonths);
  const finalLimit = Math.max(0, Math.min(input.productMax, revenueLimit, paymentCapacityLimit));

  return {
    productMax: roundMoney(input.productMax),
    revenueLimit: roundMoney(revenueLimit),
    riskShare,
    paymentCapacityLimit: roundMoney(paymentCapacityLimit),
    targetPdn,
    finalLimit: roundMoney(finalLimit),
  };
}

export function calculatePreliminaryRate(input: {
  baseRate: number;
  bkiScore: number;
  overdueCount: number;
  worstDelayDays: number;
  pdn: number;
  revenueGrowth: number | null;
}) {
  const adjustments: RateAdjustment[] = [];

  const bkiAdjustment = input.bkiScore >= 750 ? 0 : input.bkiScore >= 650 ? 1 : input.bkiScore >= 550 ? 2.5 : 5;
  adjustments.push({
    key: "bki",
    label: "Кредитная история",
    adjustment: bkiAdjustment,
    explanation: `БКИ ${input.bkiScore}: ${bkiAdjustment === 0 ? "без надбавки" : `надбавка +${bkiAdjustment} п.п.`}`,
  });

  const overdueAdjustment = input.overdueCount === 0 ? 0 : input.worstDelayDays <= 30 ? 1.5 : 4;
  adjustments.push({
    key: "overdue",
    label: "Просрочки",
    adjustment: overdueAdjustment,
    explanation: input.overdueCount === 0
      ? "Просрочек нет — без надбавки"
      : `${input.overdueCount} просрочк(и), максимум ${input.worstDelayDays} дн.: надбавка +${overdueAdjustment} п.п.`,
  });

  const pdnAdjustment = input.pdn <= 30 ? 0 : input.pdn <= 50 ? 1.5 : 4;
  adjustments.push({
    key: "pdn",
    label: "Долговая нагрузка",
    adjustment: pdnAdjustment,
    explanation: `ПДН ${roundPercent(input.pdn)}%: ${pdnAdjustment === 0 ? "без надбавки" : `надбавка +${pdnAdjustment} п.п.`}`,
  });

  const trendAdjustment = input.revenueGrowth === null ? 0.5
    : input.revenueGrowth >= 10 ? -0.5
    : input.revenueGrowth >= 0 ? 0
    : input.revenueGrowth > -15 ? 1.5
    : 3;
  adjustments.push({
    key: "revenue_trend",
    label: "Динамика выручки",
    adjustment: trendAdjustment,
    explanation: input.revenueGrowth === null
      ? "Недостаточно истории: надбавка +0.5 п.п."
      : `Изменение выручки ${input.revenueGrowth}%: ${trendAdjustment < 0 ? `скидка ${trendAdjustment} п.п.` : trendAdjustment === 0 ? "без корректировки" : `надбавка +${trendAdjustment} п.п.`}`,
  });

  const totalAdjustment = roundPercent(adjustments.reduce((sum, item) => sum + item.adjustment, 0));
  return {
    baseRate: roundPercent(input.baseRate),
    adjustments,
    totalAdjustment,
    finalRate: roundPercent(Math.max(input.baseRate, input.baseRate + totalAdjustment)),
  };
}

function recommendationsFor(
  scoringInput: ScoringInput,
  growth: number | null,
  margin: number | null,
  requestedAmount: number,
  potential: number,
  refinancing: CalculatorInput["refinancing"],
): CalculatorRecommendation[] {
  const recommendations: CalculatorRecommendation[] = [];
  if (scoringInput.bkiScore < 650) recommendations.push({ kind: "bki", title: "Проверьте кредитную историю", description: "Стабильная платёжная дисциплина и актуальные данные БКИ могут улучшить предварительную оценку." });
  if (scoringInput.overdueCount > 0) recommendations.push({ kind: "overdue", title: "Урегулируйте просрочки", description: "Погашение просроченной задолженности уменьшит риск, но не гарантирует одобрение." });
  if (scoringInput.pdn > 50) recommendations.push({ kind: "pdn", title: "Снизьте долговую нагрузку", description: "Сокращение текущих ежемесячных обязательств может улучшить предварительные условия." });
  else if (scoringInput.pdn > 30) recommendations.push({ kind: "pdn", title: "Проверьте нагрузку", description: "Снижение действующих платежей может улучшить предварительные условия." });
  if (scoringInput.pdn > 30
    && scoringInput.revenueAnnual > 0
    && refinancing
    && refinancing.activeCredits > 0
    && refinancing.totalDebt > 0
    && refinancing.monthlyCreditPayment > 0) recommendations.push({
    kind: "refinancing",
    title: "Рассмотрите возможность рефинансирования",
    description: "Это идея для отдельного сравнения, а не расчёт выгоды. Новый платёж, экономия и новая общая стоимость не рассчитаны: результат зависит от остатков долга, ставок, оставшихся сроков, комиссий и новых условий.",
    mode: "ADVISORY_ONLY",
    comparison: { status: "NOT_CALCULATED" },
    requiredData: ["Остатки долга", "Текущие ставки", "Оставшиеся сроки", "Комиссии", "Новые условия"],
  });
  if (growth !== null && growth < 0) recommendations.push({ kind: "revenue", title: "Поясните снижение выручки", description: "Подготовьте причины изменения выручки и план восстановления бизнеса." });
  if (margin !== null && margin <= 0) recommendations.push({ kind: "margin", title: "Покажите путь к прибыльности", description: "Добавьте актуальную отчётность и меры по восстановлению финансового результата." });
  if (requestedAmount > potential) recommendations.push({ kind: "amount", title: "Уменьшите сумму запроса", description: "Сумма в пределах рассчитанного потенциала выглядит реалистичнее для текущего профиля.", suggestedAmount: Math.round(potential) });
  if (recommendations.length === 0) recommendations.push({ kind: "maintain", title: "Сохраняйте текущий профиль", description: "Поддерживайте платёжную дисциплину и актуальность финансовой отчётности." });
  return recommendations;
}

const PUBLIC_FACTOR_KEYS = new Set(["bki", "overdue", "pdn", "amount_ratio"]);

function publicScoringFactors(factors: ScoreFactor[], growth: number | null, rateAdjustments: RateAdjustment[]): PublicFactor[] {
  const rateByKey = new Map(rateAdjustments.map((item) => [item.key, item]));
  const visible = factors.filter((factor) => PUBLIC_FACTOR_KEYS.has(factor.key)).map((factor): PublicFactor => {
    const rate = rateByKey.get(factor.key as RateAdjustment["key"]);
    const impact = factor.key === "bki"
      ? factor.points >= 15 ? "positive" : factor.points >= 5 ? "neutral" : "negative"
      : factor.points > 0 ? "positive" : factor.points === 0 ? "neutral" : "negative";
    return {
      key: factor.key,
      label: factor.label,
      value: factor.value,
      impact,
      explanation: rate ? `${factor.explanation}. ${rate.explanation}` : factor.explanation,
    };
  });
  const trendRate = rateByKey.get("revenue_trend");
  visible.push({
    key: "revenue_trend",
    label: "Динамика выручки",
    value: growth === null ? "недостаточно истории" : `${growth > 0 ? "+" : ""}${growth}% за год`,
    impact: growth === null ? "neutral" : growth >= 0 ? "positive" : growth > -15 ? "neutral" : "negative",
    explanation: trendRate?.explanation ?? "Динамика выручки учитывается в предварительной оценке условий.",
  });
  return visible;
}

function evaluateVariant(input: CalculatorInput, scenario?: CalculatorScenario): CalculatorVariantResult {
  const currentMargin = input.scoringInput.revenueAnnual > 0
    ? input.scoringInput.profitAnnual / input.scoringInput.revenueAnnual * 100
    : null;
  const margin = scenario?.marginPercent ?? currentMargin;
  const scoringInput: ScoringInput = {
    ...input.scoringInput,
    bkiScore: scenario?.bkiScore ?? input.scoringInput.bkiScore,
    pdn: scenario?.pdn ?? input.scoringInput.pdn,
    profitAnnual: scenario?.marginPercent !== undefined
      ? input.scoringInput.revenueAnnual * scenario.marginPercent / 100
      : input.scoringInput.profitAnnual,
  };
  const score = scoreApplication(scoringInput);
  const growth = revenueGrowth(scoringInput.revenueAnnual, input.previousRevenue);
  const rateBreakdown = calculatePreliminaryRate({
    baseRate: input.product.rateFrom,
    bkiScore: scoringInput.bkiScore,
    overdueCount: scoringInput.overdueCount,
    worstDelayDays: scoringInput.worstDelayDays,
    pdn: scoringInput.pdn,
    revenueGrowth: growth,
  });
  const potentialBreakdown = calculateCreditPotential({
    productMax: input.product.maxAmount,
    annualRevenue: scoringInput.revenueAnnual,
    grade: score.grade,
    pdn: scoringInput.pdn,
    annualRate: rateBreakdown.finalRate,
    termMonths: input.termMonths,
  });
  const monthlyPayment = annuityPayment(input.amount, rateBreakdown.finalRate, input.termMonths);
  const overpayment = roundMoney(Math.max(0, monthlyPayment * input.termMonths - input.amount));

  const compatibilityIndex = compatibilityIndexFromScore(score.score);
  return {
    score: score.score,
    internalGrade: score.grade,
    compatibilityIndex,
    compatibilityLevel: compatibilityLevelFromIndex(compatibilityIndex),
    rate: rateBreakdown.finalRate,
    monthlyPayment,
    overpayment,
    totalPayment: roundMoney(input.amount + overpayment),
    creditPotential: potentialBreakdown.finalLimit,
    revenueGrowth: growth,
    margin: margin === null ? null : roundPercent(margin),
    publicFactors: publicScoringFactors(score.factors, growth, rateBreakdown.adjustments),
    recommendations: recommendationsFor(scoringInput, growth, margin, input.amount, potentialBreakdown.finalLimit, input.refinancing),
  };
}

export function evaluateCalculator(input: CalculatorInput, scenario?: CalculatorScenario): CalculatorEvaluation {
  return {
    current: evaluateVariant(input),
    scenario: scenario ? evaluateVariant(input, scenario) : null,
    disclaimer: CALCULATOR_DISCLAIMER,
    methodology: CALCULATOR_METHODOLOGY,
  };
}

export function productOptionEconomics(result: CalculatorVariantResult): ProductOptionEconomics {
  return {
    compatibilityIndex: result.compatibilityIndex,
    compatibilityLevel: result.compatibilityLevel,
    rate: result.rate,
    monthlyPayment: result.monthlyPayment,
    overpayment: result.overpayment,
    totalPayment: result.totalPayment,
  };
}

function publicVariant(result: CalculatorVariantResult): PublicCalculatorVariantResult {
  return {
    compatibilityIndex: result.compatibilityIndex,
    compatibilityLevel: result.compatibilityLevel,
    rate: result.rate,
    monthlyPayment: result.monthlyPayment,
    overpayment: result.overpayment,
    totalPayment: result.totalPayment,
    creditPotential: result.creditPotential,
    revenueGrowth: result.revenueGrowth,
    margin: result.margin,
    publicFactors: result.publicFactors,
    recommendations: result.recommendations,
  };
}

export function toPublicCalculatorEvaluation(result: CalculatorEvaluation): PublicCalculatorEvaluation {
  return {
    current: publicVariant(result.current),
    scenario: result.scenario ? publicVariant(result.scenario) : null,
    disclaimer: result.disclaimer,
    methodology: result.methodology,
  };
}
