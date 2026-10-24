import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const touchOpenState = useRef(false);
  const lastPointerType = useRef("");
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    const tooltip = tooltipRef.current;
    if (!button || !tooltip) return;

    const viewportPadding = 12;
    const gap = 8;
    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.min(
      window.innerWidth - tooltipRect.width - viewportPadding,
      Math.max(viewportPadding, buttonRect.left + buttonRect.width / 2 - tooltipRect.width / 2),
    );
    const below = buttonRect.bottom + gap;
    const top = below + tooltipRect.height <= window.innerHeight - viewportPadding
      ? below
      : Math.max(viewportPadding, buttonRect.top - tooltipRect.height - gap);

    setPosition({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const tooltip = open ? createPortal(
    <span
      ref={tooltipRef}
      id={id}
      role="tooltip"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}
      className="pointer-events-none fixed z-[100] w-72 max-w-[calc(100vw-1.5rem)] rounded-lg bg-neutral-950 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white shadow-xl"
    >
      {definition}
    </span>,
    document.body,
  ) : null;

  return (
    <span className="inline-flex whitespace-nowrap align-middle">
      {"\u00A0"}
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Показать пояснение: ${definition}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EF3124]"
        onPointerEnter={(event) => { if (event.pointerType === "mouse") setOpen(true); }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse" && document.activeElement !== buttonRef.current) setOpen(false);
        }}
        onPointerDown={(event) => {
          lastPointerType.current = event.pointerType;
          if (event.pointerType !== "mouse") touchOpenState.current = open;
        }}
        onClick={() => {
          if (lastPointerType.current && lastPointerType.current !== "mouse") setOpen(!touchOpenState.current);
          lastPointerType.current = "";
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          lastPointerType.current = "";
          if (event.key === "Escape") {
            setOpen(false);
            event.currentTarget.blur();
          }
        }}
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {tooltip}
    </span>
  );
}
