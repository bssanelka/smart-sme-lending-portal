// Прозрачная балльная скоринговая карта (rule-based scorecard).
// Каждый фактор имеет вес и человекочитаемое объяснение — решение можно проверить и объяснить клиенту.

export interface ScoreFactor {
  key: string;
  label: string;
  value: string;
  points: number;
  explanation: string;
}

export const SCORECARD_VERSION = "rule-based-v1" as const;
export const SCORECARD_MAX_SCORE = 105;
export const SCORECARD_FACTOR_COUNT = 7;

export interface ScoreResult {
  scorecardVersion: typeof SCORECARD_VERSION;
  score: number;
  grade: "A" | "B" | "C" | "D";
  factors: ScoreFactor[];
  summary: string;
}

export interface ScoringInput {
  companyAgeYears: number;
  revenueAnnual: number;      // руб., последний год
  profitAnnual: number;       // руб.
  bkiScore: number;           // 300..900
  overdueCount: number;
  worstDelayDays: number;
  pdn: number;                // долговая нагрузка, % (обязательства/доход)
  amountToRevenueRatio: number; // запрошенная сумма / годовая выручка
  hasFinancials: boolean;     // полнота данных
}

export function gradeOf(score: number): "A" | "B" | "C" | "D" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
}

export function scoreApplication(input: ScoringInput): ScoreResult {
  const factors: ScoreFactor[] = [];

  // 1. Возраст компании (макс 15)
  let agePts: number, ageLabel: string;
  if (input.companyAgeYears >= 5) { agePts = 15; ageLabel = "5 лет и более"; }
  else if (input.companyAgeYears >= 3) { agePts = 10; ageLabel = "3–5 лет"; }
  else if (input.companyAgeYears >= 1) { agePts = 5; ageLabel = "1–3 года"; }
  else { agePts = 0; ageLabel = "менее года"; }
  factors.push({ key: "company_age", label: "Возраст компании", value: ageLabel, points: agePts, explanation: agePts >= 10 ? "Длительная история ведения бизнеса снижает риск" : "Небольшой срок ведения бизнеса повышает неопределённость" });

  // 2. Масштаб выручки (макс 20)
  let revPts: number, revLabel: string;
  if (input.revenueAnnual >= 50_000_000) { revPts = 20; revLabel = "50 млн ₽ и более"; }
  else if (input.revenueAnnual >= 10_000_000) { revPts = 15; revLabel = "10–50 млн ₽"; }
  else if (input.revenueAnnual >= 3_000_000) { revPts = 10; revLabel = "3–10 млн ₽"; }
  else if (input.revenueAnnual >= 1_000_000) { revPts = 5; revLabel = "1–3 млн ₽"; }
  else { revPts = 0; revLabel = "до 1 млн ₽"; }
  factors.push({ key: "revenue", label: "Годовая выручка", value: revLabel, points: revPts, explanation: revPts >= 15 ? "Устойчивый масштаб операционной деятельности" : "Небольшой масштаб выручки ограничивает запас прочности" });

  // 3. Прибыльность (макс 10)
  let profPts: number, profLabel: string;
  if (input.profitAnnual > 0) { profPts = 10; profLabel = "прибыль " + fmt(input.profitAnnual) + " ₽"; }
  else if (input.profitAnnual > -1_000_000) { profPts = 0; profLabel = "незначительный убыток"; }
  else { profPts = -10; profLabel = "убыток " + fmt(-input.profitAnnual) + " ₽"; }
  factors.push({ key: "profit", label: "Финансовый результат", value: profLabel, points: profPts, explanation: profPts > 0 ? "Компания прибыльна" : "Отрицательный финансовый результат повышает риск" });

  // 4. Кредитная история / БКИ (макс 25)
  let bkiPts: number, bkiLabel: string;
  if (input.bkiScore >= 750) { bkiPts = 25; bkiLabel = input.bkiScore + " (отличная)"; }
  else if (input.bkiScore >= 650) { bkiPts = 15; bkiLabel = input.bkiScore + " (хорошая)"; }
  else if (input.bkiScore >= 550) { bkiPts = 5; bkiLabel = input.bkiScore + " (удовл.)"; }
  else { bkiPts = -10; bkiLabel = input.bkiScore + " (низкая)"; }
  factors.push({ key: "bki", label: "Кредитная история (БКИ)", value: bkiLabel, points: bkiPts, explanation: bkiPts >= 15 ? "Подтверждённая платёжная дисциплина" : "Слабая кредитная история ограничивает доверие" });

  // 5. Просрочки (макс 15 / минус)
  let ovdPts: number, ovdLabel: string;
  if (input.overdueCount === 0) { ovdPts = 15; ovdLabel = "нет просрочек"; }
  else if (input.worstDelayDays <= 30) { ovdPts = 0; ovdLabel = `${input.overdueCount} просрочка до 30 дней`; }
  else { ovdPts = -25; ovdLabel = `просрочка ${input.worstDelayDays} дней`; }
  factors.push({ key: "overdue", label: "Платёжная дисциплина", value: ovdLabel, points: ovdPts, explanation: ovdPts > 0 ? "Просроченной задолженности нет" : "Имелись просрочки по обязательствам" });

  // 6. Долговая нагрузка ПДН (макс 10 / минус)
  let pdnPts: number, pdnLabel: string;
  if (input.pdn <= 30) { pdnPts = 10; pdnLabel = input.pdn.toFixed(0) + "% (умеренная)"; }
  else if (input.pdn <= 50) { pdnPts = 0; pdnLabel = input.pdn.toFixed(0) + "% (средняя)"; }
  else { pdnPts = -15; pdnLabel = input.pdn.toFixed(0) + "% (высокая)"; }
  factors.push({ key: "pdn", label: "Долговая нагрузка (ПДН)", value: pdnLabel, points: pdnPts, explanation: pdnPts > 0 ? "Долговая нагрузка в безопасной зоне" : "Высокая долговая нагрузка ограничивает способность обслуживать новый кредит" });

  // 7. Запрошенная сумма относительно выручки (макс 10 / минус)
  let ratioPts: number, ratioLabel: string;
  if (input.amountToRevenueRatio <= 0.5) { ratioPts = 10; ratioLabel = "до 50% выручки"; }
  else if (input.amountToRevenueRatio <= 1) { ratioPts = 5; ratioLabel = "50–100% выручки"; }
  else { ratioPts = -10; ratioLabel = "свыше 100% выручки"; }
  factors.push({ key: "amount_ratio", label: "Сумма к выручке", value: ratioLabel, points: ratioPts, explanation: ratioPts > 0 ? "Сумма запроса соразмерна масштабу бизнеса" : "Запрошенная сумма существенно превышает масштаб бизнеса" });

  const score = factors.reduce((s, f) => s + f.points, 0);
  const grade = gradeOf(score);
  const summary =
    grade === "A" ? "Низкий уровень риска. Заёмщик надёжен по всем ключевым факторам." :
    grade === "B" ? "Умеренно-низкий риск. Небольшие ограничения по отдельным факторам." :
    grade === "C" ? "Средний риск. Требуется корректировка условий или дополнительная информация." :
    "Высокий риск. Обязательства заёмщика с высокой вероятностью не будут исполнены.";
  return { scorecardVersion: SCORECARD_VERSION, score, grade, factors, summary };
}

export function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + " млн";
  if (Math.abs(n) >= 1_000) return Math.round(n / 1_000) + " тыс.";
  return String(Math.round(n));
}

// Маппинг скоринга в кредитное решение (небинарное)
export interface DecisionProposal {
  type: "APPROVE" | "CONDITIONS" | "MORE_INFO" | "REJECT";
  rate: number | null;
  amount: number | null;
  termMonths: number | null;
  reason: string;
  productId?: number;
  productName?: string;
}

export function validateDecisionRate(rate: number, productRateFrom: number): string | null {
  if (!Number.isFinite(rate) || !Number.isFinite(productRateFrom) || productRateFrom < 0) {
    return "Ставка должна быть конечным числом";
  }
  if (rate < productRateFrom) return `Ставка не может быть ниже базовой ставки продукта ${productRateFrom}%`;
  if (rate > 100) return "Ставка не может превышать 100% годовых";
  return null;
}

export interface ProductDecisionLimits {
  minAmount: number;
  maxAmount: number;
  termMin: number;
  termMax: number;
}

export function proposeDecisionFromGrade(
  grade: ScoreResult["grade"],
  input: ScoringInput,
  productRateFrom: number,
  requestedAmount: number,
  requestedTerm: number,
  limits?: ProductDecisionLimits,
): DecisionProposal {
  if (grade === "A") {
    return { type: "APPROVE", rate: productRateFrom, amount: requestedAmount, termMonths: requestedTerm, reason: "Низкий риск: система рекомендует предварительно одобрить запрошенные условия. Финальное решение принимает сотрудник банка." };
  }
  if (grade === "B") {
    return { type: "APPROVE", rate: productRateFrom + 1.5, amount: requestedAmount, termMonths: requestedTerm, reason: "Умеренный риск: система рекомендует предварительное одобрение с корректировкой ставки (+1,5 п.п.). Финальное решение принимает сотрудник банка." };
  }
  if (grade === "C") {
    const riskAdjustedAmount = Math.min(requestedAmount, Math.round(input.revenueAnnual * 0.5));
    const riskAdjustedTerm = Math.min(requestedTerm, 24);
    const reducedAmount = limits
      ? Math.min(limits.maxAmount, Math.max(limits.minAmount, riskAdjustedAmount))
      : riskAdjustedAmount;
    const reducedTerm = limits
      ? Math.min(limits.termMax, Math.max(limits.termMin, riskAdjustedTerm))
      : riskAdjustedTerm;
    return {
      type: "CONDITIONS",
      rate: productRateFrom + 3,
      amount: reducedAmount,
      termMonths: reducedTerm,
      reason: `Средний риск: система рекомендует рассмотреть ${fmt(reducedAmount)} ₽ на ${reducedTerm} мес. под ${(productRateFrom + 3).toFixed(1)}%. Сумма и срок скорректированы; финальное решение принимает сотрудник банка.`,
    };
  }
  return { type: "REJECT", rate: null, amount: null, termMonths: null, reason: "Высокий уровень риска по совокупности факторов. Система рекомендует сотруднику банка рассмотреть отказ или альтернативные условия." };
}

export function proposeDecision(input: ScoringInput, productRateFrom: number, requestedAmount: number, requestedTerm: number): DecisionProposal {
  if (!input.hasFinancials) {
    return { type: "MORE_INFO", rate: null, amount: null, termMonths: null, reason: "Для принятия решения необходима финансовая отчётность за последний год." };
  }
  const result = scoreApplication(input);
  return proposeDecisionFromGrade(result.grade, input, productRateFrom, requestedAmount, requestedTerm);
}
