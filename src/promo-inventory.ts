export interface PromoInventoryRecord {
  code?: string;
  codex_credit_url?: string;
  api_credit_url?: string;
  api_credit_code?: string;
  assigned_email?: string;
  blocked?: boolean;
}

export type PromoInventoryStatus = "assigned" | "available" | "blocked" | "incomplete";

export function isCompletePromo(promo: PromoInventoryRecord): boolean {
  return Boolean((promo.codex_credit_url || promo.code) && (promo.api_credit_code || promo.api_credit_url));
}

export function isAvailablePromo(promo: PromoInventoryRecord): boolean {
  return !promo.assigned_email && promo.blocked !== true && isCompletePromo(promo);
}

export function getPromoInventoryStatus(promo: PromoInventoryRecord): PromoInventoryStatus {
  if (promo.assigned_email) return "assigned";
  if (promo.blocked === true) return "blocked";
  return isCompletePromo(promo) ? "available" : "incomplete";
}

export function countAvailableCredits(promos: PromoInventoryRecord[]): { codex: number; api: number } {
  let codex = 0;
  let api = 0;
  for (const promo of promos) {
    if (promo.assigned_email || promo.blocked === true) continue;
    if (promo.codex_credit_url || promo.code) codex += 1;
    if (promo.api_credit_code || promo.api_credit_url) api += 1;
  }
  return { codex, api };
}
