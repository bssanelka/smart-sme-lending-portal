import { useId } from "react";
import { CircleHelp } from "lucide-react";

export const TERM_DEFINITIONS = {
  bki: "БКИ — бюро кредитных историй. Оно хранит сведения о кредитах, платежах и просрочках компании или предпринимателя.",
  pdn: "ПДН — показатель долговой нагрузки: какая доля среднемесячного дохода уже уходит на обслуживание обязательств.",
  creditPotential: "Кредитный потенциал — ориентировочная сумма, которую текущий финансовый профиль способен обслуживать. Это не утверждённый лимит.",
  overpayment: "Переплата — ориентировочная сумма процентов сверх основного долга за весь срок при указанной ставке.",
  compatibility: "Индекс соответствия показывает, насколько профиль проходит детерминированные правила текущей балльной карты. Это не процент и не вероятность одобрения.",
  preapproval: "Предварительная автоматическая проверка означает, что правила не выявили критических ограничений. Это не одобрение, не финальное решение и не оферта банка.",
  refinancing: "Рефинансирование — замена одного или нескольких действующих кредитов новым. Оно может снизить платёж, но требует сравнения ставки, срока, комиссий и полной стоимости.",
  scoring: "Скоринг — автоматизированная оценка кредитного риска по данным бизнеса. Финальное решение в этом прототипе подтверждает сотрудник банка.",
} as const;

export type TermKey = keyof typeof TERM_DEFINITIONS;

export default function TermHint({ term }: { term: TermKey }) {
  const id = useId();
  const definition = TERM_DEFINITIONS[term];

  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`Пояснение: ${definition}`}
        aria-describedby={id}
        title={definition}
        className="ml-1 inline-flex rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EF3124]"
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-30 mt-2 w-64 rounded-lg bg-neutral-950 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white opacity-0 shadow-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {definition}
      </span>
    </span>
  );
}
