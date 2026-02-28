import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import {
  Zap,
  Package,
  HardDrive,
  Activity,
  RefreshCw,
  LogOut,
  Clock,
  Loader2,
  Monitor,
  Bot,
  DollarSign,
  Settings,
} from "lucide-react";
import MeterCard, { Stat } from "./MeterCard";
import TransparencySlider from "./TransparencySlider";
import { fetchBilling, logout as apiLogout, setOpacity } from "../api";
import type { MeterPayload, UsageItem, UserConfig } from "../types";
import styles from "./Dashboard.module.css";

interface DashboardProps {
  onLogout: () => void;
  onOpenSettings: () => void;
  config: UserConfig | null;
}

/** Products always shown even with zero usage this month */
const ALWAYS_SHOW_PRODUCTS: { product: string; unitType: string }[] = [
  { product: "Packages", unitType: "GB" },
  { product: "Storage",  unitType: "GB" },
  { product: "Git LFS",  unitType: "GB" },
];

/** Known free-tier included amounts per GitHub plan */
const PLAN_LIMITS: Record<string, Record<string, number>> = {
  free:  { actions_min: 2000, packages_gb: 1,  storage_gb: 1,  codespaces_ch: 120 },
  pro:   { actions_min: 3000, packages_gb: 2,  storage_gb: 2,  codespaces_ch: 180 },
  team:  { actions_min: 3000, packages_gb: 2,  storage_gb: 2,  codespaces_ch: 180 },
};

/** Monthly premium request limits per Copilot plan */
const COPILOT_REQUEST_LIMITS: Record<string, number> = {
  free: 50,
  pro: 300,
  "pro+": 1500,
  pro_plus: 1500,   // actual API value
  business: 300,
  enterprise: 1000,
};

/** Infer copilot request quota from the resolved copilot plan */
function resolveCopilotLimit(
  copilotPlan: string | null | undefined,
): number {
  if (copilotPlan) {
    return COPILOT_REQUEST_LIMITS[copilotPlan.toLowerCase()] ?? 50;
  }
  return 50;
}

/** Resolve a display label for the copilot plan */
function copilotPlanLabel(copilotPlan: string | null | undefined): string {
  const p = (copilotPlan ?? "").toLowerCase();
  if (p === "pro_plus" || p === "pro+") return "Pro+";
  if (p === "enterprise") return "Enterprise";
  if (p === "business") return "Business";
  if (p === "pro") return "Pro";
  if (p === "free") return "Free";
  return "Free";
}

function getIncluded(
  product: string,
  unitType: string,
  planName: string | null | undefined,
  copilotPlan: string | null | undefined,
): number | null {
  const p = product.toLowerCase();
  const u = unitType.toLowerCase();
  if (p.includes("copilot") && u.includes("request")) {
    return resolveCopilotLimit(copilotPlan);
  }
  const limits = PLAN_LIMITS[(planName ?? "free").toLowerCase()] ?? PLAN_LIMITS.free;
  if (p.includes("action") && u.includes("min")) return limits.actions_min;
  if (p.includes("package") && u.includes("gb"))  return limits.packages_gb;
  if ((p.includes("storage") || p.includes("lfs")) && u.includes("gb")) return limits.storage_gb;
  if (p.includes("codespace") && (u.includes("hour") || u.includes("core"))) return limits.codespaces_ch;
  return null;
}


interface ProductGroup {
  product: string;
  totalQuantity: number;
  unitType: string;
  totalNetAmount: number;
  totalGrossAmount: number;
  pricePerUnit: number;
  skus: { sku: string; quantity: number; unitType: string; netAmount: number }[];
}

function groupByProduct(items: UsageItem[]): ProductGroup[] {
  const map = new Map<string, UsageItem[]>();
  for (const item of items) {
    const key = item.product;
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return Array.from(map.entries()).map(([product, rows]) => ({
    product,
    totalQuantity: rows.reduce((s, r) => s + r.grossQuantity, 0),
    unitType: rows[0].unitType,
    totalNetAmount: rows.reduce((s, r) => s + r.netAmount, 0),
    totalGrossAmount: rows.reduce((s, r) => s + r.grossAmount, 0),
    pricePerUnit: Math.max(...rows.map((r) => r.pricePerUnit)),
    skus: rows.map((r) => ({
      sku: r.sku,
      quantity: r.grossQuantity,
      unitType: r.unitType,
      netAmount: r.netAmount,
    })),
  }));
}

function productIcon(product: string) {
  const p = product.toLowerCase();
  if (p.includes("action")) return { icon: <Zap size={16} />, color: "var(--accent-orange)" };
  if (p.includes("package")) return { icon: <Package size={16} />, color: "var(--accent-purple)" };
  if (p.includes("storage") || p.includes("lfs")) return { icon: <HardDrive size={16} />, color: "var(--accent-cyan)" };
  if (p.includes("codespace")) return { icon: <Monitor size={16} />, color: "var(--accent-blue)" };
  if (p.includes("copilot")) return { icon: <Bot size={16} />, color: "var(--accent-green)" };
  return { icon: <DollarSign size={16} />, color: "var(--accent-orange)" };
}

/** Known words that need special casing after title-casing */
const SKU_CASING: Record<string, string> = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
  lfs: "LFS",
  gb: "GB",
};

export default function Dashboard({ onLogout, onOpenSettings, config }: DashboardProps) {
  const [data, setData] = useState<MeterPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [opacity, setOpacityState] = useState(0.92);
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fetchIdRef = useRef(0);

  const loadData = useCallback(async () => {
    const id = ++fetchIdRef.current;
    try {
      setRefreshing(true);
      setError(null);
      const payload = await fetchBilling();
      // Discard stale responses from superseded fetches
      if (id !== fetchIdRef.current) return;
      setData(payload);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      if (id !== fetchIdRef.current) return;
      setError(String(e));
    } finally {
      if (id === fetchIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 300_000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Auto-resize the Tauri window to fit content height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const h = Math.ceil(entries[0].contentRect.height);
      getCurrentWindow().setSize(new LogicalSize(420, Math.max(160, h + 2)));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const productGroups = useMemo(() => {
    const groups = groupByProduct(data?.usageItems ?? []);
    // Inject zero-usage groups for always-show products when absent from API data
    for (const { product, unitType } of ALWAYS_SHOW_PRODUCTS) {
      if (!groups.some((g) => g.product.toLowerCase() === product.toLowerCase())) {
        groups.push({
          product,
          totalQuantity: 0,
          unitType,
          totalNetAmount: 0,
          totalGrossAmount: 0,
          pricePerUnit: 0,
          skus: [],
        });
      }
    }
    return groups;
  }, [data]);

  const handleOpacityChange = async (val: number) => {
    setOpacityState(val);
    document.documentElement.style.opacity = String(val);
    try {
      await setOpacity(val);
    } catch {
      // fallback: CSS handles it
    }
  };

  const handleLogout = async () => {
    await apiLogout();
    onLogout();
  };

  // Read copilot plan from user config (set during onboarding)
  const effectiveCopilotPlan = config?.copilotPlan ?? data?.copilotPlan;

  if (loading && !data) {
    return (
      <div className={styles.loadingWrap}>
        <Loader2 size={28} className={styles.spinner} />
        <span className={styles.loadingText}>Loading your GitHub metrics…</span>
      </div>
    );
  }

  const premiumRequestItems = data?.premiumRequestItems ?? [];

  return (
    <div ref={containerRef} className={styles.container}>
      {/* User header */}
      {data?.user && (
        <div className={styles.userHeader}>
          <div className={styles.userInfo}>
            <img
              src={data.user.avatar_url}
              alt={data.user.login}
              className={styles.avatar}
            />
            <div className={styles.userText}>
              <span className={styles.displayName}>
                {data.user.name || data.user.login}
              </span>
              <div className={styles.userMeta}>
                <span className={styles.username}>@{data.user.login}</span>
                {/* Copilot plan badge */}
                {(() => {
                  const label = copilotPlanLabel(effectiveCopilotPlan);
                  const cls = label === "Pro+" ? styles.badgeCopilotProPlus
                    : label === "Pro" ? styles.badgeCopilotPro
                    : label === "Business" ? styles.badgeCopilotPro
                    : label === "Enterprise" ? styles.badgeCopilotProPlus
                    : styles.badgeCopilotFree;
                  return (
                    <span className={`${styles.badge} ${cls}`} title={`Copilot ${label}`}>
                      Copilot {label}
                    </span>
                  );
                })()}
                {data.user.plan?.name && data.user.plan.name.toLowerCase() === "pro" && (
                  <span className={`${styles.badge} ${styles.badgeGitHubPro}`} title="GitHub Pro account">
                    Pro
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.iconBtn}
              onClick={onOpenSettings}
              title="Settings"
            >
              <Settings size={14} />
            </button>
            <button
              className={`${styles.iconBtn} ${refreshing ? styles.spinning : ""}`}
              onClick={loadData}
              disabled={refreshing}
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            <button
              className={styles.iconBtn}
              onClick={handleLogout}
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && <div className={styles.errorBanner}>{error}</div>}

      {/* Meter cards */}
      <div className={styles.cards}>
        {/* Usage error (whole billing fetch failed) */}
        {data?.usageError && (
          <MeterCard
            title="Billing Usage"
            icon={<Activity size={16} />}
            accentColor="var(--accent-orange)"
            error={data.usageError}
            delay={0}
          >
            <></>
          </MeterCard>
        )}

        {/* Dynamic product cards from Enhanced Billing API */}
        {productGroups.map((group, i) => {
          const { icon, color } = productIcon(group.product);
          const multiSku = group.skus.length > 1;
          const planName = data?.user?.plan?.name;
          const included = getIncluded(group.product, group.unitType, planName, effectiveCopilotPlan);
          // Extra units purchased via spending budget
          const budgetEntry = config?.budgets.find(
            (b) => b.product.toLowerCase() === group.product.toLowerCase()
          );
          const extraUnits =
            budgetEntry && budgetEntry.amountDollars > 0 && group.pricePerUnit > 0
              ? Math.floor(budgetEntry.amountDollars / group.pricePerUnit)
              : 0;
          const total = included !== null ? included + extraUnits : null;
          const pct = total ? Math.min((group.totalQuantity / total) * 100, 100) : null;
          const barColor = pct !== null
            ? (pct > 95 ? "var(--accent-red)" : pct > 80 ? "var(--accent-orange)" : color)
            : color;
          const summaryText = total
            ? `${formatQty(group.totalQuantity)} / ${formatQty(total)} ${group.unitType}`
            : `${formatQty(group.totalQuantity)} ${group.unitType}`;
          const budgetNote =
            budgetEntry && extraUnits > 0
              ? `$${budgetEntry.amountDollars.toFixed(2)}/mo budget adds ${formatQty(extraUnits)} ${group.unitType}`
              : null;
          return (
            <MeterCard
              key={group.product}
              title={group.product}
              icon={icon}
              accentColor={color}
              delay={i * 60}
              summary={summaryText}
              summaryPct={pct ?? undefined}
              summaryColor={barColor}
              defaultCollapsed={true}
            >
              <div className={styles.statsRow}>
                <Stat
                  label={formatUnit(group.unitType)}
                  value={summaryText}
                />
                {group.totalNetAmount > 0 && (
                  <Stat label="Cost" value={`$${group.totalNetAmount.toFixed(2)}`} />
                )}
              </div>
              {total !== null && pct !== null && (
                <div className={styles.includedBar}>
                  <div
                    className={styles.includedFill}
                    style={{ width: `${pct}%`, background: barColor }}
                  />
                </div>
              )}
              {budgetNote && <div className={styles.budgetNote}>{budgetNote}</div>}
              {/* Per-model Copilot premium request breakdown (Metrics GA) */}
              {group.product.toLowerCase().includes("copilot") && premiumRequestItems.length > 0 && (
                <div className={styles.breakdown}>
                  <div className={styles.breakdownHeader}>By model</div>
                  {premiumRequestItems.map((m) => (
                    <div key={m.model} className={styles.breakdownRow}>
                      <span className={styles.breakdownLabel}>{m.model}</span>
                      <span className={styles.breakdownValue}>
                        {formatQty(m.grossQuantity)} req
                        {m.netAmount > 0 && ` · $${m.netAmount.toFixed(2)}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {multiSku && (
                <div className={styles.breakdown}>
                  {group.skus.map((s) => (
                    <div key={s.sku} className={styles.breakdownRow}>
                      <span className={styles.breakdownLabel}>{formatSku(s.sku)}</span>
                      <span className={styles.breakdownValue}>
                        {formatQty(s.quantity)} {s.unitType}
                        {s.netAmount > 0 && ` · $${s.netAmount.toFixed(2)}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </MeterCard>
          );
        })}

        {/* No usage yet */}
        {!data?.usageError && productGroups.length === 0 && data && (
          <MeterCard
            title="Billing Usage"
            icon={<Activity size={16} />}
            accentColor="var(--accent-orange)"
            delay={0}
          >
            <div className={styles.copilotNote}>
              No usage recorded this month yet.
            </div>
          </MeterCard>
        )}

        {/* REST API Rate Limit */}
        <MeterCard
          title="REST API Rate Limit"
          icon={<Activity size={16} />}
          accentColor="var(--accent-cyan)"
          delay={productGroups.length * 60 + 120}
          summary={data?.rateLimit ? `${data.rateLimit.used.toLocaleString()} / ${data.rateLimit.limit.toLocaleString()} req` : undefined}
          summaryPct={data?.rateLimit ? Math.min((data.rateLimit.used / data.rateLimit.limit) * 100, 100) : undefined}
          summaryColor="var(--accent-cyan)"
          defaultCollapsed={true}
        >
          {data?.rateLimit && (
            <>
              <div className={styles.statsRow}>
                <Stat label="Used" value={`${data.rateLimit.used.toLocaleString()} / ${data.rateLimit.limit.toLocaleString()}`} />
                <Stat label="Remaining" value={data.rateLimit.remaining.toLocaleString()} />
              </div>
              <div className={styles.rateLimitFooter}>
                <Clock size={11} />
                <span>Resets {new Date(data.rateLimit.reset * 1000).toLocaleTimeString()}</span>
              </div>
            </>
          )}
        </MeterCard>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <TransparencySlider value={opacity} onChange={handleOpacityChange} />
        {lastRefresh && (
          <span className={styles.lastRefresh}>
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}

function formatQty(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n < 1) return n.toFixed(3);
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}

function formatUnit(unit: string): string {
  const map: Record<string, string> = {
    minutes: "Minutes", hours: "Hours", GB: "Bandwidth",
    requests: "Requests", "GB-hours": "Storage",
  };
  return map[unit] ?? unit;
}

function formatSku(sku: string): string {
  return sku
    .split("_")
    .map((word) => {
      const lower = word.toLowerCase();
      return SKU_CASING[lower] ?? (word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    })
    .join(" ");
}
