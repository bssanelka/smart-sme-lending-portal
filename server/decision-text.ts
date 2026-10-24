export type FinalDecisionType = "APPROVE" | "CONDITIONS" | "REJECT";

export function defaultClientDecisionComment(type: FinalDecisionType): string {
  if (type === "APPROVE") {
    return "Банк одобрил заявку на предложенных условиях после проверки предоставленных данных.";
  }
  if (type === "CONDITIONS") {
    return "Банк предлагает скорректированные условия после проверки предоставленных данных.";
  }
  return "Банк не может одобрить заявку по результатам проверки предоставленных данных.";
}
