import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  Landmark,
  Lightbulb,
  Loader2,
  RefreshCcw,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TermHint, { type TermKey } from "@/components/TermHint";
import {
  api,
  ApiRequestError,
  fmtMoney,
  type CalculatorMetrics,
  type CalculatorProductOption,
  type CalculatorPublicFactor,
  type CalculatorRequest,
  type CalculatorResponse,
  type CalculatorScenario,
  type Product,
} from "@/lib/api";

const PURPOSE_CATEGORIES = [
  { value: "оборотные средства", label: "Оборотные средства" },
  { value: "оборудование", label: "Оборудование" },
  { value: "расширение", label: "Расширение бизнеса" },
  { value: "резерв", label: "Финансовый резерв" },
] as const;
const OTHER_PURPOSE = "__other__";
const DEFAULT_SCENARIO: CalculatorScenario = { bki_score: 650, pdn: 35, margin_percent: 15 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function numberFromFactor(factors: CalculatorPublicFactor[], key: string, fallback: number) {
  const factor = factors.find((item) => item.key === key);
  const parsed = Number.parseFloat(factor?.value.replace(",", ".").replace(/[^\d.-]/g, "") ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compatibilityLabel(level: CalculatorMetrics["compatibilityLevel"]) {
  if (level === "HIGH") return "Высокое соответствие";
  if (level === "MEDIUM") return "Среднее соответствие";
  return "Требуется ручная проверка";
}

function percent(value: number) {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function impactLabel(impact: CalculatorPublicFactor["impact"]) {
  if (typeof impact === "number") return impact > 0 ? "Положительно" : impact < 0 ? "Требует внимания" : "Нейтрально";
  const normalized = impact.toLowerCase();
  if (["positive", "high", "good", "+"].includes(normalized)) return "Положительно";
  if (["negative", "low", "bad", "-"].includes(normalized)) return "Требует внимания";
  if (["neutral", "medium"].includes(normalized)) return "Нейтрально";
  return impact;
}

function impactClass(impact: CalculatorPublicFactor["impact"]) {
  const label = impactLabel(impact);
  if (label === "Положительно") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (label === "Требует внимания") return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-neutral-100 text-neutral-700 border-neutral-200";
}

function Metrics({ metrics, forecast = false }: { metrics: CalculatorMetrics; forecast?: boolean }) {
  const metricClass = forecast ? "border-blue-200 bg-white" : "border-amber-200 bg-white";
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div className={`min-w-0 rounded-xl border p-4 sm:col-span-2 lg:col-span-2 ${metricClass}`}>
        <p className="text-xs text-muted-foreground">Индекс соответствия<TermHint term="compatibility" /></p>
        <p className="mt-2 text-3xl font-black leading-tight numeric-tabular [overflow-wrap:anywhere] sm:text-4xl">{metrics.compatibilityIndex} <span className="text-base font-semibold">из 100</span></p>
        <p className="mt-1 text-xs text-muted-foreground">{compatibilityLabel(metrics.compatibilityLevel)}</p>
      </div>
      <div className={`min-w-0 rounded-xl border p-4 lg:col-span-2 ${metricClass}`}>
        <p className="text-xs text-muted-foreground">Ориентир ставки</p>
        <p className="mt-2 text-2xl font-black leading-tight numeric-tabular [overflow-wrap:anywhere] sm:text-3xl">{percent(metrics.rate)}</p>
      </div>
      <div className={`min-w-0 rounded-xl border p-4 lg:col-span-2 ${metricClass}`}>
        <p className="text-xs text-muted-foreground">Платёж в месяц</p>
        <p className="mt-2 text-xl font-black leading-tight numeric-tabular [overflow-wrap:anywhere] sm:text-3xl">{fmtMoney(metrics.monthlyPayment)}</p>
      </div>
      <div className={`min-w-0 rounded-xl border p-4 lg:col-span-2 ${metricClass}`}>
        <p className="text-xs text-muted-foreground">Переплата<TermHint term="overpayment" /></p>
        <p className="mt-1 text-lg font-bold leading-tight numeric-tabular [overflow-wrap:anywhere] sm:text-xl">{fmtMoney(metrics.overpayment)}</p>
      </div>
      <div className={`min-w-0 rounded-xl border p-4 lg:col-span-2 ${metricClass}`}>
        <p className="text-xs text-muted-foreground">Общая выплата</p>
        <p className="mt-1 text-lg font-bold leading-tight numeric-tabular [overflow-wrap:anywhere] sm:text-xl">{fmtMoney(metrics.totalPayment)}</p>
      </div>
      <div className={`min-w-0 rounded-xl border p-4 lg:col-span-2 ${metricClass}`}>
        <p className="text-xs text-muted-foreground">Кредитный потенциал<TermHint term="creditPotential" /></p>
        <p className="mt-1 text-lg font-bold leading-tight numeric-tabular [overflow-wrap:anywhere] sm:text-xl">{fmtMoney(metrics.creditPotential)}</p>
      </div>
    </div>
  );
}

function ScenarioComparison({ current, forecast }: { current: CalculatorMetrics; forecast: CalculatorMetrics }) {
  const values = [
    { label: "Индекс соответствия", current: `${current.compatibilityIndex} из 100`, forecast: `${forecast.compatibilityIndex} из 100` },
    { label: "Ориентир ставки", current: percent(current.rate), forecast: percent(forecast.rate) },
    { label: "Платёж в месяц", current: fmtMoney(current.monthlyPayment), forecast: fmtMoney(forecast.monthlyPayment) },
    { label: "Кредитный потенциал", current: fmtMoney(current.creditPotential), forecast: fmtMoney(forecast.creditPotential) },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-blue-300 bg-white">
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-950">
        <span>Показатель</span><span>Исходный расчёт</span><span>Сценарий</span>
      </div>
      {values.map((value) => (
        <div key={value.label} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-t px-3 py-3 text-xs sm:text-sm">
          <span className="min-w-0 break-words text-muted-foreground">{value.label}</span>
          <strong className="min-w-0 numeric-tabular [overflow-wrap:anywhere]">{value.current}</strong>
          <strong className="min-w-0 text-blue-900 numeric-tabular [overflow-wrap:anywhere]">{value.forecast}</strong>
        </div>
      ))}
    </div>
  );
}

interface ScenarioControlProps {
  id: string;
  label: string;
  hint?: TermKey;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}

function ScenarioControl({ id, label, hint, value, min, max, step = 1, suffix = "", onChange }: ScenarioControlProps) {
  const update = (raw: string) => {
    const next = Number(raw);
    if (Number.isFinite(next)) onChange(clamp(next, min, max));
  };

  return (
    <div className="space-y-2 rounded-xl border border-blue-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}{hint && <TermHint term={hint} />}</Label>
        <div className="flex items-center gap-1">
          <Input id={`${id}-number`} type="number" min={min} max={max} step={step} value={value}
            onChange={(event) => update(event.target.value)} aria-label={`${label}, точное значение`} className="h-10 w-24 px-3 text-right" />
          {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
        </div>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={(event) => update(event.target.value)} className="h-2 w-full cursor-pointer accent-[#EF3124]" aria-valuetext={`${value}${suffix}`} />
      <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden="true"><span>{min}{suffix}</span><span>{max}{suffix}</span></div>
    </div>
  );
}

interface ProductOptionProps {
  option: CalculatorProductOption;
  primary?: boolean;
  selectedByClient?: boolean;
  onApply?: () => void;
  applyBusy?: boolean;
}

function ProductOption({ option, primary = false, selectedByClient = false, onApply, applyBusy = false }: ProductOptionProps) {

  return (
    <div className={`flex h-full min-w-0 flex-col rounded-xl border p-4 ${primary ? "border-emerald-300 bg-emerald-50/60" : "bg-white"}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 break-words font-semibold">
            {primary ? <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-700" /> : <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />}
            {option.product.name}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.product.tagline}</p>
        </div>
        <div className="flex max-w-full flex-wrap justify-end gap-1.5">
          {selectedByClient && <Badge variant="outline" className="whitespace-normal border-blue-300 bg-blue-50 px-3 py-1 text-sm leading-5 text-blue-900">Выбран вами</Badge>}
          <Badge variant="outline" className={`whitespace-normal px-3 py-1 text-sm leading-5 ${option.exactMatch ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
            {option.exactMatch ? "Сумма и срок подходят" : "Сумма или срок скорректированы"}
          </Badge>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-xl bg-white p-3">
          <p className="text-xs text-muted-foreground">Сумма предложения</p>
          <p className="mt-1 text-2xl font-black leading-tight numeric-tabular [overflow-wrap:anywhere] sm:text-3xl">{fmtMoney(option.amount)}</p>
        </div>
        <div className="min-w-0 rounded-xl bg-white p-3">
          <p className="text-xs text-muted-foreground">Срок</p>
          <p className="mt-1 text-2xl font-black leading-tight numeric-tabular [overflow-wrap:anywhere] sm:text-3xl">{option.termMonths} <span className="text-base font-semibold">мес.</span></p>
        </div>
      </div>
      {!primary && (
        <div className="mt-3 space-y-2 rounded-xl bg-neutral-50 p-3">
          <dl className="grid grid-cols-1 gap-x-3 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Ориентировочная ставка</dt><dd className="font-semibold numeric-tabular">{option.economics.rate.toLocaleString("ru-RU")}%</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Платёж в месяц</dt><dd className="font-semibold numeric-tabular [overflow-wrap:anywhere]">{fmtMoney(option.economics.monthlyPayment)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Переплата</dt><dd className="font-semibold numeric-tabular [overflow-wrap:anywhere]">{fmtMoney(option.economics.overpayment)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Общая выплата</dt><dd className="font-semibold numeric-tabular [overflow-wrap:anywhere]">{fmtMoney(option.economics.totalPayment)}</dd></div>
            <div className="min-w-0 sm:col-span-2"><dt className="text-xs text-muted-foreground">Индекс соответствия</dt><dd className="break-words font-semibold numeric-tabular">{option.economics.compatibilityIndex} из 100 · {compatibilityLabel(option.economics.compatibilityLevel)}</dd></div>
          </dl>
          <p className="text-[11px] leading-4 text-muted-foreground">Предварительный расчёт, а не решение или оферта банка.</p>
        </div>
      )}
      <ul className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
        {option.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
      </ul>
      {onApply && (
        <div className="mt-auto pt-4">
          <Button type="button" variant="outline" className="w-full" onClick={onApply} disabled={applyBusy}>
            {applyBusy ? <Loader2 className="animate-spin" /> : <ArrowRight />} Выбрать и перейти к заявке
          </Button>
        </div>
      )}
    </div>
  );
}

export default function CreditCalculator({ selectedProduct }: { selectedProduct?: Product }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryCategory = searchParams.get("category");
  const knownQueryCategory = PURPOSE_CATEGORIES.some((item) => item.value === queryCategory);
  const queryProductId = Number(searchParams.get("product_id"));
  const selectedProductId = Number.isInteger(queryProductId) && queryProductId > 0 ? queryProductId : null;
  const [amount, setAmount] = useState(searchParams.get("amount") ?? "1500000");
  const [term, setTerm] = useState(searchParams.get("term") ?? "12");
  const [category, setCategory] = useState(queryCategory && knownQueryCategory ? queryCategory : queryCategory ? OTHER_PURPOSE : PURPOSE_CATEGORIES[0].value);
  const [customPurpose, setCustomPurpose] = useState(queryCategory && !knownQueryCategory ? queryCategory : "");
  const [result, setResult] = useState<CalculatorResponse | null>(null);
  const [calculatedRequest, setCalculatedRequest] = useState<CalculatorRequest | null>(null);
  const [scenario, setScenario] = useState<CalculatorScenario>(DEFAULT_SCENARIO);
  const [baseScenario, setBaseScenario] = useState<CalculatorScenario>(DEFAULT_SCENARIO);
  const [busy, setBusy] = useState(false);
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [choosingProductId, setChoosingProductId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [eligibilityConflict, setEligibilityConflict] = useState(false);

  const resetResult = () => {
    setResult(null);
    setCalculatedRequest(null);
    setError("");
    setEligibilityConflict(false);
  };

  const clearSelectedProduct = () => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("product_id");
    setSearchParams(nextSearchParams, { replace: true });
    resetResult();
  };

  const requestBody = (): CalculatorRequest => ({
    amount: Number(amount),
    term_months: Number(term),
    purpose_category: category === OTHER_PURPOSE ? customPurpose.trim() : category,
    ...(selectedProductId ? { product_id: selectedProductId } : {}),
  });

  const calculate = async (event: React.FormEvent) => {
    event.preventDefault();
    const request = requestBody();
    setBusy(true);
    setError("");
    setEligibilityConflict(false);
    try {
      const response = await api.evaluateCalculator(request);
      const initialScenario = {
        bki_score: clamp(Math.round(numberFromFactor(response.current.publicFactors, "bki", DEFAULT_SCENARIO.bki_score)), 300, 900),
        pdn: clamp(Math.round(numberFromFactor(response.current.publicFactors, "pdn", DEFAULT_SCENARIO.pdn)), 0, 100),
        margin_percent: clamp(Math.round(response.current.margin ?? DEFAULT_SCENARIO.margin_percent), -20, 100),
      };
      setResult(response);
      setCalculatedRequest(request);
      setScenario(initialScenario);
      setBaseScenario(initialScenario);
    } catch (caught) {
      setError((caught as Error).message);
      setEligibilityConflict(caught instanceof ApiRequestError && caught.status === 409);
    } finally {
      setBusy(false);
    }
  };

  const calculateScenario = async () => {
    if (!calculatedRequest) return;
    setScenarioBusy(true);
    setError("");
    try {
      setResult(await api.evaluateCalculator({ ...calculatedRequest, scenario }));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setScenarioBusy(false);
    }
  };

  const resetScenario = () => {
    setScenario(baseScenario);
    setResult((current) => current ? { ...current, scenario: null } : current);
    setError("");
  };

  const chooseAlternative = async (option: CalculatorProductOption) => {
    if (!calculatedRequest) return;
    setChoosingProductId(option.product.id);
    setError("");
    try {
      const selectedCalculation = await api.evaluateCalculator({ ...calculatedRequest, product_id: option.product.id });
      navigate(`/apply/${option.product.id}?calculation_id=${selectedCalculation.calculation_id}`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setChoosingProductId(null);
    }
  };

  const applyUrl = result
    ? `/apply/${result.selection.recommended.product.id}?calculation_id=${result.calculation_id}`
    : "";
  const manualReviewRequired = error.startsWith("Нужна ручная проверка:");
  const selectedProductName = selectedProduct?.name ?? (selectedProductId ? `Продукт №${selectedProductId}` : "");
  const selectedProductUnavailable = Boolean(selectedProductId && eligibilityConflict && !manualReviewRequired);
  const scenarioChanged = scenario.bki_score !== baseScenario.bki_score
    || scenario.pdn !== baseScenario.pdn
    || scenario.margin_percent !== baseScenario.margin_percent
    || Boolean(result?.scenario);

  return (
    <div className="space-y-5">
      <Card className="border-[#EF3124]/20">
        <CardHeader>
          <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-[#EF3124]" /><CardTitle className="text-xl">Определите потребность в финансировании</CardTitle></div>
          <CardDescription>Укажите задачу, точную сумму и срок. Можно доверить подбор системе или проверить продукт, выбранный в каталоге.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={calculate} className="space-y-4">
            <div className="grid items-start gap-4 md:grid-cols-3">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="calculator-category">Для чего нужны деньги</Label>
                <Select value={category} onValueChange={(value) => { setCategory(value); resetResult(); }}>
                  <SelectTrigger id="calculator-category" className="w-full min-w-0 text-left" aria-label="Цель финансирования"><SelectValue className="min-w-0 flex-1 text-left" /></SelectTrigger>
                  <SelectContent position="popper" align="start" sideOffset={4} className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)]">
                    {PURPOSE_CATEGORIES.map((item) => <SelectItem className="min-h-11 whitespace-normal py-2.5 text-base leading-5" key={item.value} value={item.value}>{item.label}</SelectItem>)}
                    <SelectItem className="min-h-11 whitespace-normal py-2.5 text-base leading-5" value={OTHER_PURPOSE}>Другое</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Выберите ближайшую задачу бизнеса</p>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="calculator-amount">Точная сумма, ₽</Label>
                <Input id="calculator-amount" type="number" min="100000" max="150000000" step="1000" value={amount}
                  onChange={(event) => { setAmount(event.target.value); resetResult(); }} required />
                <p className="text-xs text-muted-foreground">От 100 тыс. до 150 млн ₽</p>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="calculator-term">Желаемый срок, месяцев</Label>
                <Input id="calculator-term" type="number" min="3" max="84" value={term}
                  onChange={(event) => { setTerm(event.target.value); resetResult(); }} required />
                <p className="text-xs text-muted-foreground">От 3 месяцев до 7 лет</p>
              </div>
            </div>
            {category === OTHER_PURPOSE && (
              <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <Label htmlFor="calculator-custom-purpose">Опишите цель своими словами</Label>
                <Input id="calculator-custom-purpose" value={customPurpose} minLength={2} maxLength={160}
                  onChange={(event) => { setCustomPurpose(event.target.value); resetResult(); }} placeholder="Например, ремонт нового помещения" required />
                <p className="text-xs leading-5 text-amber-950">Цель будет передана в расчёт без подмены. Если она не совпадёт с назначениями продуктов, калькулятор сообщит, что автоматический подбор невозможен. Ничего не будет отправлено в банк — для ручного подбора потребуется отдельное обращение к сотруднику.</p>
              </div>
            )}
            {selectedProductId && (
              <div className="flex flex-col justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 sm:flex-row sm:items-center">
                <div><p className="font-semibold">Выбран продукт: {selectedProductName}</p><p className="mt-1 text-xs">Передадим выбранный продукт в расчёт. Сервер заново проверит цель, выручку, сумму и срок; недоступный продукт не будет выбран.</p></div>
                <Button type="button" variant="outline" size="sm" className="shrink-0 bg-white" onClick={clearSelectedProduct}>Снять выбор</Button>
              </div>
            )}
            {error && (manualReviewRequired
              ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status"><p className="font-semibold">Нужна ручная проверка</p><p className="mt-1">{error.replace(/^Нужна ручная проверка:\s*/, "")}</p><p className="mt-2 text-xs">Система не будет называть неподходящий продукт рекомендованным. Ничего не отправлено в банк: измените параметры или отдельно обратитесь к сотруднику за ручным подбором.</p></div>
              : selectedProductUnavailable
                ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950" role="alert"><p className="font-semibold">{selectedProductName} сейчас недоступен</p><p className="mt-1">{error}</p><p className="mt-2 text-xs">Снимите выбор и повторите расчёт — сервер покажет только альтернативы, прошедшие проверку доступности.</p><Button type="button" variant="outline" size="sm" className="mt-3 border-red-200 bg-white" onClick={clearSelectedProduct}>Подобрать альтернативы</Button></div>
                : <p className="text-sm text-red-600" role="alert">{error}</p>)}
            <div className="flex flex-col items-start gap-2">
              <Button type="submit" className="h-auto min-w-0 w-full whitespace-normal py-3 text-center leading-5 sm:w-auto" disabled={busy} aria-busy={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {selectedProductId ? "Проверить продукт и рассчитать" : "Подобрать продукт и рассчитать"}
              </Button>
              {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite"><Loader2 className="h-4 w-4 animate-spin" /> Подбираем предложения и рассчитываем условия…</p>}
            </div>
          </form>
        </CardContent>
      </Card>

      {result && calculatedRequest && (
        <div className="space-y-5" aria-live="polite">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2"><BadgeCheck className="h-5 w-5 text-emerald-700" /><CardTitle>{selectedProductId ? "Выбранный продукт прошёл серверную проверку" : "Система подобрала подходящий продукт"}</CardTitle></div>
              <CardDescription>{selectedProductId ? "Продукт доступен по цели, выручке, сумме и сроку. Ниже показаны причины выбора и доступные альтернативы." : "Выбор сделан по сумме, сроку, цели и данным выручки компании."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ProductOption option={result.selection.recommended} primary selectedByClient={Boolean(selectedProductId)} />
              {result.selection.alternatives.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">Показать альтернативные варианты ({result.selection.alternatives.length})</summary>
                  <p className="mt-2 text-xs text-muted-foreground">Все варианты прошли проверку по цели, выручке, сумме и сроку. Вы можете выбрать подходящий и сразу перейти к заявке.</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {result.selection.alternatives.map((option) => (
                      <ProductOption
                        key={option.product.id}
                        option={option}
                        onApply={() => void chooseAlternative(option)}
                        applyBusy={choosingProductId === option.product.id}
                      />
                    ))}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>

          <Card className="border-2 border-dashed border-amber-300 bg-amber-50/40">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-xl">Ориентировочные условия</CardTitle>
                <Badge className="w-fit max-w-full whitespace-normal border-amber-300 bg-amber-100 px-3 py-1 text-sm leading-5 text-amber-950"><CircleAlert className="mr-1 h-4 w-4" /> Только предварительный расчёт</Badge>
              </div>
              <CardDescription>Это автоматическая оценка до заявки. Сотрудник банка ещё не принимал решение.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Metrics metrics={result.current} />

              {result.current.publicFactors.length > 0 && (
                <section aria-labelledby="calculator-factors-title">
                  <h3 id="calculator-factors-title" className="mb-2 font-semibold">Ключевые факторы</h3>
                  <div className="divide-y rounded-xl border bg-white px-4">
                    {result.current.publicFactors.map((factor) => (
                      <div key={factor.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-medium">{factor.label}{factor.key === "bki" && <TermHint term="bki" />}{factor.key === "pdn" && <TermHint term="pdn" />}: <span className="font-normal text-muted-foreground">{factor.value}</span></p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{factor.explanation}</p>
                        </div>
                        <Badge variant="outline" className={`w-fit shrink-0 px-3 py-1 text-sm leading-5 ${impactClass(factor.impact)}`}>{impactLabel(factor.impact)}</Badge>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {result.current.recommendations.length > 0 && (
                <section aria-labelledby="calculator-recommendations-title">
                  <h3 id="calculator-recommendations-title" className="mb-2 font-semibold">Как улучшить условия</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {result.current.recommendations.map((recommendation, index) => (
                      <div key={`${recommendation.kind}-${index}`} className={`rounded-xl p-4 ${recommendation.kind === "refinancing" ? "border border-blue-200 bg-blue-50" : "bg-white border"}`}>
                        <div className="flex gap-3">
                          {recommendation.kind === "refinancing" ? <RefreshCcw className="mt-0.5 size-4 shrink-0 text-blue-700" /> : <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                          <div>
                            <p className="text-sm font-semibold">{recommendation.title}{recommendation.kind === "refinancing" && <TermHint term="refinancing" />}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{recommendation.description}</p>
                            {recommendation.kind === "refinancing" && (
                              <div className="mt-3 space-y-2">
                                <Badge variant="outline" className="border-blue-300 bg-white px-3 py-1 text-sm leading-5 text-blue-800">Идея, не расчёт</Badge>
                                <p className="text-xs text-blue-950">Для сравнения нужны: {recommendation.requiredData?.join(", ")}. Новый платёж, экономия и общая стоимость не рассчитаны.</p>
                              </div>
                            )}
                            {recommendation.suggestedAmount != null && <p className="mt-2 text-sm font-medium">Рекомендуемая сумма: {fmtMoney(recommendation.suggestedAmount)}</p>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className="rounded-xl bg-white p-4 text-xs text-muted-foreground">
                <p>{result.disclaimer}</p>
                <details className="mt-2"><summary className="cursor-pointer font-medium text-foreground">Как выполнен расчёт</summary><p className="mt-2">Применены детерминированные правила и балльная карта на синтетических данных; это не калиброванная ML-модель.</p></details>
              </div>

              <div className="border-t border-amber-200 pt-5">
                <Button asChild className="h-auto min-w-0 w-full whitespace-normal py-3 text-center leading-5 sm:w-auto">
                  <Link to={applyUrl}>Перейти к заявке после ознакомления с расчётом <ArrowRight className="shrink-0" /></Link>
                </Button>
              </div>
            </CardContent>
          </Card>


          <Card className="border-blue-200 bg-blue-50/50">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-6 [&::-webkit-details-marker]:hidden">
                <div>
                  <div className="flex items-center gap-2"><SlidersHorizontal className="size-5 text-blue-700" /><CardTitle>Что если изменить показатели?</CardTitle></div>
                  <CardDescription className="mt-2">Необязательный инструмент: смоделируйте условия и сравните их с исходным расчётом. Данные компании не изменятся.</CardDescription>
                </div>
                <span className="shrink-0 text-sm font-semibold text-blue-800"><span className="group-open:hidden">Открыть</span><span className="hidden group-open:inline">Свернуть</span></span>
              </summary>
              <CardContent className="mt-5 space-y-5">
                <div className="rounded-xl border border-blue-200 bg-white p-4 text-sm text-blue-950">
                  <p className="font-semibold">Исходные значения текущего расчёта</p>
                  <p className="mt-1 text-xs leading-5 text-blue-900">БКИ — {baseScenario.bki_score}, долговая нагрузка — {baseScenario.pdn}%, маржа — {baseScenario.margin_percent}%. Меняйте только те значения, которые хотите проверить.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <ScenarioControl id="scenario-bki" label="Показатель БКИ" hint="bki" value={scenario.bki_score} min={300} max={900} onChange={(bki_score) => setScenario((current) => ({ ...current, bki_score }))} />
                  <ScenarioControl id="scenario-pdn" label="Долговая нагрузка" hint="pdn" value={scenario.pdn} min={0} max={100} suffix="%" onChange={(pdn) => setScenario((current) => ({ ...current, pdn }))} />
                  <ScenarioControl id="scenario-margin" label="Маржа бизнеса" value={scenario.margin_percent} min={-20} max={100} suffix="%" onChange={(margin_percent) => setScenario((current) => ({ ...current, margin_percent }))} />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" variant="secondary" onClick={calculateScenario} disabled={scenarioBusy} className="w-full sm:w-auto">
                    {scenarioBusy ? <Loader2 className="animate-spin" /> : <TrendingUp />} Рассчитать сценарий
                  </Button>
                  <Button type="button" variant="outline" onClick={resetScenario} disabled={!scenarioChanged || scenarioBusy} className="w-full bg-white sm:w-auto">
                    <RefreshCcw /> Сбросить к исходным
                  </Button>
                </div>
                {scenarioBusy && <p className="text-sm text-blue-900" role="status" aria-live="polite">Сравниваем сценарий с исходным расчётом…</p>}
                {result.scenario && (
                  <section className="space-y-3 rounded-2xl border border-blue-300 bg-blue-100/70 p-4 sm:p-5" aria-labelledby="forecast-title">
                    <div><h3 id="forecast-title" className="font-semibold text-blue-950">Сравнение с исходным расчётом</h3><p className="text-xs text-blue-800">Это прогноз, а не новые данные компании и не решение банка.</p></div>
                    <ScenarioComparison current={result.current} forecast={result.scenario} />
                  </section>
                )}
              </CardContent>
            </details>
          </Card>

        </div>
      )}
    </div>
  );
}
