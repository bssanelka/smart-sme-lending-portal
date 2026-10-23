import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, LockKeyhole, PencilLine, RefreshCw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, fmtMoney, type SavedCalculation } from "@/lib/api";
import { clearMutationKey, getMutationKey, recoverMutationOutcome } from "@/lib/mutation-recovery";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function Apply() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const calculationIdParam = searchParams.get("calculation_id");
  const calculationId = calculationIdParam && Number.isInteger(Number(calculationIdParam)) ? Number(calculationIdParam) : null;
  const [calculation, setCalculation] = useState<SavedCalculation | null>(null);
  const [calculationStatus, setCalculationStatus] = useState<"loading" | "error" | "success">("loading");
  const [calculationError, setCalculationError] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcomeUnresolved, setOutcomeUnresolved] = useState(false);
  const mutationScope = `application:create:${calculationId ?? "invalid"}`;

  const loadCalculation = useCallback(async () => {
    if (!calculationId) return;
    await Promise.resolve();
    setCalculationStatus("loading");
    setCalculationError("");
    try {
      const savedCalculation = await api.savedCalculation(calculationId);
      if (savedCalculation.application) {
        clearMutationKey(mutationScope);
        nav(`/applications/${savedCalculation.application.id}`, { replace: true });
        return;
      }
      setCalculation(savedCalculation);
      setCalculationError("");
      setCalculationStatus("success");
    } catch (reason) {
      setCalculationError(reason instanceof Error ? reason.message : "Не удалось загрузить расчёт");
      setCalculationStatus("error");
    }
  }, [calculationId, mutationScope, nav]);

  useEffect(() => { void loadCalculation(); }, [loadCalculation]);

  if (!calculationId) {
    return (
      <div className="min-h-screen bg-neutral-50 p-4 flex items-center justify-center">
        <Card className="max-w-lg">
          <CardHeader><CardTitle>Сначала выполните расчёт</CardTitle><CardDescription>Заявка создаётся только из сохранённого подбора, чтобы продукт и условия не менялись незаметно.</CardDescription></CardHeader>
          <CardContent><Button asChild><Link to="/dashboard?tab=calculator">Перейти к подбору</Link></Button></CardContent>
        </Card>
      </div>
    );
  }

  if (calculationStatus === "loading") {
    return <div className="min-h-screen bg-neutral-50 flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка расчёта…</div>;
  }

  if (calculationStatus === "error" || !calculation) {
    return (
      <div className="min-h-screen bg-neutral-50 p-4 flex items-center justify-center">
        <Card className="w-full max-w-lg border-red-200">
          <CardHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600"><AlertCircle className="h-5 w-5" /></div>
            <CardTitle>Не удалось загрузить расчёт</CardTitle>
            <CardDescription className="text-red-700" role="alert">{calculationError || "Расчёт недоступен"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={() => void loadCalculation()}><RefreshCw className="h-4 w-4" /> Повторить</Button>
            <Button asChild variant="outline"><Link to="/dashboard?tab=calculator">Новый расчёт</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const editUrl = `/dashboard?${new URLSearchParams({
    tab: "calculator",
    amount: String(calculation.requested_amount),
    term: String(calculation.requested_term_months),
    category: calculation.purpose_category,
  }).toString()}`;

  const verifySubmission = async () => {
    setBusy(true);
    setSubmitError("");
    try {
      const recovered = await api.savedCalculation(calculation.calculation_id);
      if (recovered.application) {
        clearMutationKey(mutationScope);
        setOutcomeUnresolved(false);
        nav(`/applications/${recovered.application.id}`, { replace: true });
        return;
      }
      setOutcomeUnresolved(false);
      setSubmitError("Сервер подтвердил, что заявка не создана. Можно повторить отправку с тем же ключом команды.");
    } catch (reason) {
      setOutcomeUnresolved(true);
      setSubmitError(`Результат отправки пока неизвестен. Не отправляйте заявку повторно. ${reason instanceof Error ? reason.message : "Не удалось выполнить проверку."}`);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setSubmitError("");
    const key = getMutationKey(mutationScope);
    try {
      const result = await api.createApplication({
        purpose,
        calculation_id: calculation.calculation_id,
      }, key);
      clearMutationKey(mutationScope);
      setOutcomeUnresolved(false);
      setConfirmOpen(false);
      nav(`/applications/${result.id}`);
    } catch (reason) {
      const recovery = await recoverMutationOutcome(
        reason,
        () => api.savedCalculation(calculation.calculation_id),
        (saved) => Boolean(saved.application),
      );
      setConfirmOpen(false);
      if (recovery.status === "applied") {
        clearMutationKey(mutationScope);
        setOutcomeUnresolved(false);
        nav(`/applications/${recovery.value.application!.id}`, { replace: true });
      } else if (recovery.status === "retry") {
        setOutcomeUnresolved(false);
        setSubmitError("Сервер подтвердил, что заявка не создана. Можно повторить отправку с тем же ключом команды.");
      } else if (recovery.status === "unresolved") {
        setOutcomeUnresolved(true);
        setSubmitError(`Результат отправки пока неизвестен. Не отправляйте заявку повторно. ${recovery.error.message}`);
      } else {
        clearMutationKey(mutationScope);
        setOutcomeUnresolved(false);
        setSubmitError(recovery.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm"><Link to="/dashboard"><ArrowLeft className="w-4 h-4" /> Назад</Link></Button>
          <span className="font-bold">Проверка заявки</span>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
          <div><p className="font-semibold">Параметры зафиксированы расчётом</p><p className="mt-1 text-blue-800">Это защищает заявку от случайного изменения продукта, суммы или срока. Для корректировки вернитесь в калькулятор и создайте новый расчёт.</p></div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{calculation.product.name}</CardTitle>
              <Badge className={calculation.selection_source === "CLIENT_ALTERNATIVE" ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800"}>
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                {calculation.selection_source === "CLIENT_ALTERNATIVE" ? "Выбрано вами из подходящих" : "Рекомендовано системой"}
              </Badge>
            </div>
            <CardDescription>{calculation.product.tagline}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(event) => { event.preventDefault(); setSubmitError(""); setConfirmOpen(true); }} className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border bg-neutral-50 p-4"><p className="text-xs text-muted-foreground">Продукт</p><p className="mt-1 font-semibold">{calculation.product.name}</p><LockKeyhole className="mt-2 h-4 w-4 text-muted-foreground" /></div>
                <div className="rounded-xl border bg-neutral-50 p-4"><p className="text-xs text-muted-foreground">Сумма</p><p className="mt-1 font-semibold">{fmtMoney(calculation.amount)}</p><LockKeyhole className="mt-2 h-4 w-4 text-muted-foreground" /></div>
                <div className="rounded-xl border bg-neutral-50 p-4"><p className="text-xs text-muted-foreground">Срок</p><p className="mt-1 font-semibold">{calculation.term_months} мес.</p><LockKeyhole className="mt-2 h-4 w-4 text-muted-foreground" /></div>
                <div className="rounded-xl border bg-neutral-50 p-4"><p className="text-xs text-muted-foreground">Категория цели</p><p className="mt-1 font-semibold capitalize">{calculation.purpose_category}</p><LockKeyhole className="mt-2 h-4 w-4 text-muted-foreground" /></div>
              </div>

              {(calculation.amount !== calculation.requested_amount || calculation.term_months !== calculation.requested_term_months) && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Вы запрашивали {fmtMoney(calculation.requested_amount)} на {calculation.requested_term_months} мес. Система подобрала ближайшие доступные условия выше.</p>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="application-purpose">Опишите потребность подробнее</Label>
                <Input id="application-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)}
                  placeholder="Например: закупка оборудования для расширения производства" required minLength={5} />
                <p className="text-xs text-muted-foreground">Реквизиты компании подставляются из профиля. Повторно вводить их не нужно.</p>
              </div>

              {submitError && (
                <div className={`rounded-lg border p-3 text-sm ${outcomeUnresolved ? "border-amber-300 bg-amber-50 text-amber-950" : "border-red-200 bg-red-50 text-red-700"}`} role="alert">
                  <p>{submitError}</p>
                  {outcomeUnresolved && <Button type="button" size="sm" variant="outline" className="mt-3 bg-white" disabled={busy} onClick={() => void verifySubmission()}><RefreshCw className="h-4 w-4" /> Проверить результат</Button>}
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" className="flex-1" disabled={busy || outcomeUnresolved}>
                  {busy ? <Loader2 className="animate-spin" /> : <Send />} Отправить заявку в банк
                </Button>
                <Button asChild type="button" variant="outline"><Link to={editUrl}><PencilLine /> Изменить расчёт</Link></Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>

      <ConfirmDialog
        open={confirmOpen}
        title="Отправить заявку в банк?"
        description={(
          <div className="space-y-3">
            <p>После подтверждения заявка будет сохранена и передана в банковский конвейер. Параметры этого расчёта изменить внутри заявки будет нельзя.</p>
            <dl className="space-y-1.5 rounded-lg bg-neutral-50 p-3 text-foreground">
              <div><dt className="inline text-muted-foreground">Продукт: </dt><dd className="inline font-medium">{calculation.product.name}</dd></div>
              <div><dt className="inline text-muted-foreground">Сумма: </dt><dd className="inline font-medium">{fmtMoney(calculation.amount)}</dd></div>
              <div><dt className="inline text-muted-foreground">Срок: </dt><dd className="inline font-medium">{calculation.term_months} мес.</dd></div>
              <div><dt className="inline text-muted-foreground">Цель: </dt><dd className="inline font-medium">{purpose}</dd></div>
            </dl>
          </div>
        )}
        confirmLabel="Отправить заявку"
        busy={busy}
        error={submitError}
        onConfirm={() => void submit()}
        onOpenChange={(open) => { if (!busy && !outcomeUnresolved) setConfirmOpen(open); }}
      />
    </div>
  );
}
