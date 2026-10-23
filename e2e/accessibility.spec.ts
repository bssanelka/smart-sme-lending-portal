import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, loginName: string) {
  await page.goto("/login");
  await page.getByLabel("Логин").fill(loginName);
  await page.getByLabel("Пароль").fill("demo123");
  await page.getByRole("button", { name: "Войти" }).click();
}

async function expectNoSeriousViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
}

test("login and client dashboard have no serious axe violations", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Умный кредитный кабинет" })).toBeVisible();
  await expectNoSeriousViolations(page);

  await login(page, "client1");
  await expect(page.getByRole("heading", { name: /Узнайте возможности бизнеса/ })).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("bank queue has no serious axe violations", async ({ page }) => {
  await login(page, "bank");
  await expect(page.getByRole("heading", { name: "Очередь заявок" })).toBeVisible();
  await expect(page.getByLabel("Фильтр очереди по статусу")).toBeVisible();
  await expectNoSeriousViolations(page);
});
