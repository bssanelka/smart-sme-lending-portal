import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ui] Необработанная ошибка интерфейса", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
        <section className="w-full max-w-lg rounded-3xl border bg-white p-7 text-center shadow-xl" role="alert">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-[#EF3124]">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-xl font-bold">Не удалось показать страницу</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Данные не изменены. Обновите страницу; если проблема повторится, запустите проверку состояния сервиса.
          </p>
          <Button className="mt-6 w-full" onClick={() => window.location.reload()}>
            <RefreshCcw className="h-4 w-4" /> Обновить страницу
          </Button>
          <a className="mt-4 inline-block text-xs text-muted-foreground underline-offset-4 hover:underline" href="/api/health">
            Проверить состояние сервиса
          </a>
        </section>
      </main>
    );
  }
}
