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
  fmtMoney,
  type CalculatorMetrics,
  type CalculatorProductOption,
  type CalculatorPublicFactor,
  type CalculatorRequest,
  type CalculatorResponse,
  type CalculatorScenario,
} from "@/lib/api";

const PURPOSE_CATEGORIES = ["оборотные средства", "оборудование", "расширение", "резерв"];
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
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      <div className={`col-span-2 rounded-xl border p-4 lg:col-span-1 ${forecast ? "border-blue-200 bg-white" : "border-amber-200 bg-white"}`}>
        <p className="text-xs text-muted-foreground">Индекс соответствия <TermHint term="compatibility" /></p>
        <p className="mt-1 text-3xl font-black numeric-tabular">{metrics.compatibilityIndex} <span className="text-base font-semibold">из 100</span></p>
        <p className="mt-1 text-[11px] text-muted-foreground">{compatibilityLabel(metrics.compatibilityLevel)}</p>
      </div>
      <div className={`rounded-xl border p-4 ${forecast ? "border-blue-200 bg-white" : "border-amber-200 bg-white"}`}>
        <p className="text-xs text-muted-foreground">Ориентир ставки</p>
        <p className="mt-1 text-xl font-bold numeric-tabular">{percent(metrics.rate)}</p>
      </div>
      <div className={`rounded-xl border p-4 ${forecast ? "border-blue-200 bg-white" : "border-amber-200 bg-white"}`}>
        <p className="text-xs text-muted-foreground">Платёж в месяц</p>
        <p className="mt-1 text-xl font-bold numeric-tabular">{fmtMoney(metrics.monthlyPayment)}</p>
      </div>
      <div className={`rounded-xl border p-4 ${forecast ? "border-blue-200 bg-white" : "border-amber-200 bg-white"}`}>
        <p className="text-xs text-muted-foreground">Переплата <TermHint term="overpayment" /></p>
        <p className="mt-1 text-xl font-bold numeric-tabular">{fmtMoney(metrics.overpayment)}</p>
      </div>
      <div className={`rounded-xl border p-4 ${forecast ? "border-blue-200 bg-white" : "border-amber-200 bg-white"}`}>
        <p className="text-xs text-muted-foreground">Общая выплата</p>
        <p className="mt-1 text-xl font-bold numeric-tabular">{fmtMoney(metrics.totalPayment)}</p>
      </div>
      <div className={`rounded-xl border p-4 ${forecast ? "border-blue-200 bg-white" : "border-amber-200 bg-white"}`}> 
        <p className="text-xs text-muted-foreground">Кредитный потенциал <TermHint term="creditPotential" /></p>
        <p className="mt-1 text-xl font-bold numeric-tabular">{fmtMoney(metrics.creditPotential)}</p>
      </div>
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
  applyUrl?: string;
  onApply?: () => void;
  applyBusy?: boolean;
}

function ProductOption({ option, primary = false, applyUrl, onApply, applyBusy = false }: ProductOptionProps) {
  const actionLabel = primary ? "Перейти к заявке" : "Выбрать и перейти к заявке";

  return (
    <div className={`rounded-xl border p-4 ${primary ? "border-emerald-300 bg-emerald-50/60" : "bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-semibold">
            {primary ? <BadgeCheck className="h-5 w-5 text-emerald-700" /> : <Landmark className="h-4 w-4 text-muted-foreground" />}
            {option.product.name}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{option.product.tagline}</p>
        </div>
        <Badge className={option.exactMatch ? "border-emerald-200 bg-emerald-100 text-emerald-800" : "border-amber-200 bg-amber-100 text-amber-800"}>
          {option.exactMatch ? "Точное совпадение" : "Ближайший вариант"}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-3">
        <div className="rounded-lg bg-white p-2"><p className="text-[11px] text-muted-foreground">Сумма</p><p className="font-semibold">{fmtMoney(option.amount)}</p></div>
        <div className="rounded-lg bg-white p-2"><p className="text-[11px] text-muted-foreground">Срок</p><p className="font-semibold">{option.termMonths} мес.</p></div>
        <div className="rounded-lg bg-white p-2"><p className="text-[11px] text-muted-foreground">Ориентир ставки</p><p className="font-semibold">{percent(option.economics.rate)}</p></div>
        <div className="rounded-lg bg-white p-2"><p className="text-[11px] text-muted-foreground">Платёж в месяц</p><p className="font-semibold">{fmtMoney(option.economics.monthlyPayment)}</p></div>
        <div className="rounded-lg bg-white p-2"><p className="text-[11px] text-muted-foreground">Переплата</p><p className="font-semibold">{fmtMoney(option.economics.overpayment)}</p></div>
        <div className="rounded-lg bg-white p-2"><p className="text-[11px] text-muted-foreground">Общая выплата</p><p className="font-semibold">{fmtMoney(option.economics.totalPayment)}</p></div>
      </div>
      <p className="mt-2 rounded-lg bg-white px-3 py-2 text-xs text-muted-foreground">
        Индекс соответствия: <strong className="text-foreground">{option.economics.compatibilityIndex} из 100</strong> · {compatibilityLabel(option.economics.compatibilityLevel)}
      </p>
      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        {option.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
      </ul>
      {applyUrl && (
        <Button asChild className="mt-4 w-full bg-[#EF3124] text-white hover:bg-[#d9271c] sm:w-auto">
          <Link to={applyUrl}>{actionLabel} <ArrowRight /></Link>
        </Button>
      )}
      {!applyUrl && onApply && (
        <Button type="button" variant="outline" className="mt-4 w-full" onClick={onApply} disabled={applyBusy}>
          {applyBusy ? <Loader2 className="animate-spin" /> : <ArrowRight />} {actionLabel}
        </Button>
      )}
    </div>
  );
}

export default function CreditCalculator() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryCategory = searchParams.get("category");
  const [amount, setAmount] = useState(searchParams.get("amount") ?? "1500000");
  const [term, setTerm] = useState(searchParams.get("term") ?? "12");
  const [category, setCategory] = useState(queryCategory && PURPOSE_CATEGORIES.includes(queryCategory) ? queryCategory : PURPOSE_CATEGORIES[0]);
  const [result, setResult] = useState<CalculatorResponse | null>(null);
  const [calculatedRequest, setCalculatedRequest] = useState<CalculatorRequest | null>(null);
  const [scenario, setScenario] = useState<CalculatorScenario>(DEFAULT_SCENARIO);
  const [busy, setBusy] = useState(false);
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [choosingProductId, setChoosingProductId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const resetResult = () => {
    setResult(null);
    setCalculatedRequest(null);
    setError("");
  };

  const requestBody = (): CalculatorRequest => ({
    amount: Number(amount),
    term_months: Number(term),
    purpose_category: category,
  });

  const calculate = async (event: React.FormEvent) => {
    event.preventDefault();
    const request = requestBody();
    setBusy(true);
    setError("");
    try {
      const response = await api.evaluateCalculator(request);
      setResult(response);
      setCalculatedRequest(request);
      setScenario({
        bki_score: clamp(Math.round(numberFromFactor(response.current.publicFactors, "bki", DEFAULT_SCENARIO.bki_score)), 300, 900),
        pdn: clamp(Math.round(numberFromFactor(response.current.publicFactors, "pdn", DEFAULT_SCENARIO.pdn)), 0, 100),
        margin_percent: clamp(Math.round(response.current.margin ?? DEFAULT_SCENARIO.margin_percent), -20, 100),
      });
    } catch (caught) {
      setError((caught as Error).message);
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

  return (
    <div className="space-y-5">
      <Card className="border-[#EF3124]/20">
        <CardHeader>
          <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-[#EF3124]" /><CardTitle className="text-xl">Определите потребность в финансировании</CardTitle></div>
          <CardDescription>Укажите задачу, точную сумму и срок. Система сама подберёт продукт — разбираться в банковских названиях не нужно.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={calculate} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="calculator-category">Для чего нужны деньги</Label>
                <Select value={category} onValueChange={(value) => { setCategory(value); resetResult(); }}>
                  <SelectTrigger id="calculator-category" className="w-full" aria-label="Цель финансирования"><SelectValue /></SelectTrigger>
                  <SelectContent>{PURPOSE_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="calculator-amount">Точная сумма, ₽</Label>
                <Input id="calculator-amount" type="number" min="100000" max="150000000" step="1000" value={amount}
                  onChange={(event) => { setAmount(event.target.value); resetResult(); }} required />
                <p className="text-xs text-muted-foreground">От 100 тыс. до 150 млн ₽</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="calculator-term">Желаемый срок, месяцев</Label>
                <Input id="calculator-term" type="number" min="3" max="84" value={term}
                  onChange={(event) => { setTerm(event.target.value); resetResult(); }} required />
                <p className="text-xs text-muted-foreground">От 3 месяцев до 7 лет</p>
              </div>
            </div>
            {error && (manualReviewRequired
              ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status"><p className="font-semibold">Нужна ручная проверка</p><p className="mt-1">{error.replace(/^Нужна ручная проверка:\s*/, "")}</p><p className="mt-2 text-xs">Система не будет называть неподходящий продукт рекомендованным. Измените параметры потребности или обратитесь к сотруднику банка.</p></div>
              : <p className="text-sm text-red-600" role="alert">{error}</p>)}
            <Button type="submit" className="w-full sm:w-auto" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Подобрать продукт и рассчитать
            </Button>
          </form>
        </CardContent>
      </Card>

      {result && calculatedRequest && (
        <div className="space-y-5" aria-live="polite">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2"><BadgeCheck className="h-5 w-5 text-emerald-700" /><CardTitle>Система подобрала подходящий продукт</CardTitle></div>
              <CardDescription>Выбор сделан по сумме, сроку, цели и данным выручки компании.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ProductOption option={result.selection.recommended} primary applyUrl={applyUrl} />
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
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-amber-300 bg-amber-100 text-amber-900"><CircleAlert className="mr-1 h-3.5 w-3.5" /> Только предварительный расчёт</Badge>
                <CardTitle>Ориентировочные условия</CardTitle>
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
                        <Badge variant="outline" className={`w-fit shrink-0 ${impactClass(factor.impact)}`}>{impactLabel(factor.impact)}</Badge>
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
                                <Badge variant="outline" className="border-blue-300 bg-white text-blue-800">Идея, не расчёт</Badge>
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
            </CardContent>
          </Card>


          <Card className="border-blue-200 bg-blue-50/50">
            <CardHeader>
              <div className="flex items-center gap-2"><SlidersHorizontal className="size-5 text-blue-700" /><CardTitle>Сценарий «Что если»</CardTitle></div>
              <CardDescription>Измените показатели и сравните прогноз с текущим предварительным расчётом.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <ScenarioControl id="scenario-bki" label="Показатель БКИ" hint="bki" value={scenario.bki_score} min={300} max={900} onChange={(bki_score) => setScenario((current) => ({ ...current, bki_score }))} />
                <ScenarioControl id="scenario-pdn" label="Долговая нагрузка" hint="pdn" value={scenario.pdn} min={0} max={100} suffix="%" onChange={(pdn) => setScenario((current) => ({ ...current, pdn }))} />
                <ScenarioControl id="scenario-margin" label="Маржа бизнеса" value={scenario.margin_percent} min={-20} max={100} suffix="%" onChange={(margin_percent) => setScenario((current) => ({ ...current, margin_percent }))} />
              </div>
              <Button type="button" variant="secondary" onClick={calculateScenario} disabled={scenarioBusy} className="w-full sm:w-auto">
                {scenarioBusy ? <Loader2 className="animate-spin" /> : <TrendingUp />} Рассчитать прогноз
              </Button>
              {result.scenario && (
                <section className="space-y-3 rounded-2xl border border-blue-300 bg-blue-100/70 p-4 sm:p-5" aria-labelledby="forecast-title">
                  <div><h3 id="forecast-title" className="font-semibold text-blue-950">Прогнозный результат</h3><p className="text-xs text-blue-800">Сценарий не меняет данные компании и используется только для моделирования.</p></div>
                  <Metrics metrics={result.scenario} forecast />
                </section>
              )}
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
}
