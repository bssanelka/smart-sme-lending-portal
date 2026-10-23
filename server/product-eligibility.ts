export interface EligibleProduct {
  id: number;
  code: string;
  name: string;
  minAmount: number;
  maxAmount: number;
  rateFrom: number;
  termMin: number;
  termMax: number;
  purposeTags: string[];
  minRevenue: number;
}

export type ProductConstraintCode =
  | "AMOUNT_MIN"
  | "AMOUNT_MAX"
  | "TERM_MIN"
  | "TERM_MAX"
  | "MIN_REVENUE"
  | "PURPOSE";

export interface ProductConstraintViolation {
  code: ProductConstraintCode;
  message: string;
}

export interface ProductEligibilityInput {
  amount: number;
  termMonths: number;
  purposeCategory: string;
  annualRevenue: number;
}

export interface ProductEligibilityResult {
  eligible: boolean;
  purposeMatches: boolean;
  violations: ProductConstraintViolation[];
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU");
}

export function productPurposeMatches(product: EligibleProduct, purposeCategory: string): boolean {
  const purpose = normalized(purposeCategory);
  if (!purpose) return false;
  if (product.purposeTags.length === 0) return true;
  return product.purposeTags.some((tag) => {
    const candidate = normalized(tag);
    return candidate.length > 0 && (purpose.includes(candidate) || candidate.includes(purpose));
  });
}

export function evaluateProductEligibility(
  product: EligibleProduct,
  input: ProductEligibilityInput,
): ProductEligibilityResult {
  const violations: ProductConstraintViolation[] = [];
  const purposeMatches = productPurposeMatches(product, input.purposeCategory);

  if (input.amount < product.minAmount) {
    violations.push({ code: "AMOUNT_MIN", message: `Сумма ниже минимальной для продукта: ${product.minAmount.toLocaleString("ru-RU")} ₽` });
  }
  if (input.amount > product.maxAmount) {
    violations.push({ code: "AMOUNT_MAX", message: `Сумма выше максимальной для продукта: ${product.maxAmount.toLocaleString("ru-RU")} ₽` });
  }
  if (input.termMonths < product.termMin) {
    violations.push({ code: "TERM_MIN", message: `Срок короче минимального для продукта: ${product.termMin} мес.` });
  }
  if (input.termMonths > product.termMax) {
    violations.push({ code: "TERM_MAX", message: `Срок превышает максимальный для продукта: ${product.termMax} мес.` });
  }
  if (input.annualRevenue < product.minRevenue) {
    violations.push({ code: "MIN_REVENUE", message: `Годовая выручка ниже минимальной для продукта: ${product.minRevenue.toLocaleString("ru-RU")} ₽` });
  }
  if (!purposeMatches) {
    violations.push({ code: "PURPOSE", message: `Продукт не предназначен для цели «${input.purposeCategory}»` });
  }

  return { eligible: violations.length === 0, purposeMatches, violations };
}

export function formatEligibilityError(product: EligibleProduct, result: ProductEligibilityResult): string {
  return `${product.name}: ${result.violations.map((violation) => violation.message).join("; ")}`;
}

export class ProductEligibilityError extends Error {
  readonly code = "PRODUCT_NOT_ELIGIBLE";

  constructor(message: string) {
    super(message);
    this.name = "ProductEligibilityError";
  }
}

export function assertProductEligibility(product: EligibleProduct, input: ProductEligibilityInput): void {
  const result = evaluateProductEligibility(product, input);
  if (!result.eligible) throw new ProductEligibilityError(formatEligibilityError(product, result));
}

export function productFromRecord(row: Record<string, unknown>): EligibleProduct {
  return {
    id: row.id as number,
    code: row.code as string,
    name: row.name as string,
    minAmount: row.min_amount as number,
    maxAmount: row.max_amount as number,
    rateFrom: row.rate_from as number,
    termMin: row.term_min as number,
    termMax: row.term_max as number,
    purposeTags: String(row.purpose_tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    minRevenue: row.min_revenue as number,
  };
}
