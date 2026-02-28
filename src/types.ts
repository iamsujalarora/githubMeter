/* ── GitHub API types mirroring Rust structs ─────────────────── */

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
  plan?: { name: string | null } | null;
}

/** One row from the Enhanced Billing /usage/summary endpoint */
export interface UsageItem {
  product: string;
  sku: string;
  unitType: string;
  pricePerUnit: number;
  grossQuantity: number;
  grossAmount: number;
  discountQuantity: number;
  discountAmount: number;
  netQuantity: number;
  netAmount: number;
}

/** One row from the premium_request/usage endpoint (per-model Copilot breakdown) */
export interface PremiumRequestItem {
  product: string;
  sku: string;
  model: string;
  unitType: string;
  pricePerUnit: number;
  grossQuantity: number;
  grossAmount: number;
  discountQuantity: number;
  discountAmount: number;
  netQuantity: number;
  netAmount: number;
}

export interface CopilotInfo {
  plan_type: string | null;
  last_activity_at: string | null;
  last_activity_editor: string | null;
  pending_cancellation_date: unknown | null;
}

export interface RateLimitInfo {
  limit: number;
  used: number;
  remaining: number;
  reset: number;
}

export interface MeterPayload {
  user: GitHubUser | null;
  usageItems: UsageItem[];
  premiumRequestItems: PremiumRequestItem[];
  usageError: string | null;
  copilotPlan: string | null;
  rateLimit: RateLimitInfo | null;
}

export type AuthStatus = "loading" | "unauthenticated" | "authenticating" | "authenticated";

export interface BudgetEntry {
  /** Matches the product name from billing API, e.g. "Copilot", "Actions", "Codespaces" */
  product: string;
  /** Spending limit in USD */
  amountDollars: number;
}

export interface UserConfig {
  copilotPlan: string; // "free" | "pro" | "pro_plus" | "business" | "enterprise"
  budgets: BudgetEntry[];
  configuredAt: number;
}

/** Response from GitHub Device Authorization Flow initiation */
export interface DeviceCodeInfo {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}
