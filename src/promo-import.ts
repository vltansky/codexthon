import type { PromoBundleImportRow } from "./csv.ts";

export interface ExistingPromoImportRow {
  id: string;
  code: string;
  codex_credit_url?: string;
  api_credit_url?: string;
  api_credit_code?: string;
  assigned_email: string;
  assigned_at?: string;
}

export type PromoImportCreate = Omit<ExistingPromoImportRow, "id">;

export interface PromoImportUpdate {
  id: string;
  data: Partial<PromoImportCreate>;
}

export interface PromoImportPlan {
  creates: PromoImportCreate[];
  updates: PromoImportUpdate[];
  unchanged: number;
}

export function planPromoImport(imported: PromoBundleImportRow[], existing: ExistingPromoImportRow[]): PromoImportPlan {
  const creates: PromoImportCreate[] = [];
  const updates: PromoImportUpdate[] = [];
  const working = existing.map((promo) => ({ ...promo }));
  const consumed = new Set<string>();
  let unchanged = 0;

  for (const { codexCreditUrl, apiCreditValue } of imported) {
    const codexMatch = codexCreditUrl ? working.find((promo) => promoCodexCredit(promo) === codexCreditUrl) : undefined;
    const apiMatch = apiCreditValue ? working.find((promo) => promoApiCredit(promo) === apiCreditValue) : undefined;
    if (codexMatch && apiMatch && codexMatch.id !== apiMatch.id) {
      throw new Error("uploaded Codex and API credits already belong to different rows");
    }

    const exactMatch = codexMatch || apiMatch;
    const duplicate = exactMatch
      && (!codexCreditUrl || promoCodexCredit(exactMatch) === codexCreditUrl)
      && (!apiCreditValue || promoApiCredit(exactMatch) === apiCreditValue);
    if (duplicate) {
      unchanged += 1;
      continue;
    }

    const counterpart = exactMatch || working.find((promo) => {
      if (consumed.has(promo.id) || promo.assigned_email) return false;
      if (codexCreditUrl && !apiCreditValue) return !promoCodexCredit(promo) && Boolean(promoApiCredit(promo));
      if (apiCreditValue && !codexCreditUrl) return Boolean(promoCodexCredit(promo)) && !promoApiCredit(promo);
      return false;
    });
    if (counterpart) {
      const currentCodex = promoCodexCredit(counterpart);
      const currentApi = promoApiCredit(counterpart);
      if ((codexCreditUrl && currentCodex && currentCodex !== codexCreditUrl)
        || (apiCreditValue && currentApi && currentApi !== apiCreditValue)) {
        throw new Error("uploaded credit conflicts with an existing promo row");
      }

      const data: Partial<PromoImportCreate> = {};
      if (codexCreditUrl && !currentCodex) {
        data.code = codexCreditUrl;
        data.codex_credit_url = codexCreditUrl;
      }
      if (apiCreditValue && !currentApi) Object.assign(data, apiCreditFields(apiCreditValue));
      updates.push({ id: counterpart.id, data });
      Object.assign(counterpart, data);
      consumed.add(counterpart.id);
      continue;
    }

    creates.push({
      code: codexCreditUrl,
      codex_credit_url: codexCreditUrl,
      ...apiCreditFields(apiCreditValue),
      assigned_email: "",
      assigned_at: "",
    });
  }

  return { creates, updates, unchanged };
}

function promoCodexCredit(promo: ExistingPromoImportRow): string {
  return promo.codex_credit_url || (promoApiCredit(promo) ? "" : promo.code);
}

function promoApiCredit(promo: ExistingPromoImportRow): string {
  return promo.api_credit_code || promo.api_credit_url || "";
}

function apiCreditFields(value: string): Pick<PromoImportCreate, "api_credit_code" | "api_credit_url"> {
  return /^https?:\/\//i.test(value)
    ? { api_credit_code: "", api_credit_url: value }
    : { api_credit_code: value, api_credit_url: "" };
}
