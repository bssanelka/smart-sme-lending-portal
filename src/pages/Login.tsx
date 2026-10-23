import { useState } from "react";
import { Navigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/auth";

const DEMO_ACCOUNTS = [
  { login: "client1", label: "Соколова А.В. — ИП «Кафе», собственник" },
  { login: "client2", label: "Морозов Д.С. — ООО «Вектор Строй», ген. директор" },
  { login: "client3", label: "Ким Е.О. — ООО «Импульс Трейд», фин. директор" },
  { login: "bank", label: "Петрова О.И. — кредитный аналитик банка" },
];

export default function Login() {
  const { login, user } = useAuth();
  const [l, setL] = useState("client1");
  const [p, setP] = useState("demo123");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to={user.role === "BANK" ? "/bank" : "/dashboard"} replace />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { await login(l, p); } catch (er) { setError((er as Error).message); } finally { setBusy(false); }
  };

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-50 to-neutral-200 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-lg bg-[#EF3124] flex items-center justify-center text-white font-black text-lg">A</div>
            <CardTitle className="text-xl"><h1>Умный кредитный кабинет</h1></CardTitle>
          </div>
          <CardDescription>Прототип цифрового кредитного конвейера для малого и микробизнеса. Вход по синтетической тестовой учётной записи (пароль у всех: demo123).</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="login-name">Логин</Label><Input id="login-name" name="username" autoComplete="username" value={l} onChange={(e) => setL(e.target.value)} placeholder="Логин" /></div>
            <div className="space-y-1.5"><Label htmlFor="login-password">Пароль</Label><Input id="login-password" name="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} placeholder="Пароль" type="password" /></div>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <Button className="w-full" disabled={busy}>{busy ? "Вход…" : "Войти"}</Button>
          </form>
          <div className="mt-5">
            <p className="text-xs font-medium text-muted-foreground mb-2">Тестовые учётные записи:</p>
            <div className="space-y-1">
              {DEMO_ACCOUNTS.map((a) => (
                <button key={a.login} type="button" onClick={() => setL(a.login)}
                  className={`w-full text-left text-xs rounded-md px-2 py-1.5 border transition-colors ${l === a.login ? "border-[#EF3124] bg-red-50" : "border-neutral-200 hover:bg-neutral-50"}`}>
                  <span className="font-mono font-semibold">{a.login}</span> — {a.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
