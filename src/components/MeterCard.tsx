import { type ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./MeterCard.module.css";

interface MeterCardProps {
  title: string;
  icon: ReactNode;
  accentColor: string;
  children: ReactNode;
  delay?: number;
  error?: string | null;
  /** Short summary shown in the header when collapsed, e.g. "1945 / 3000 min" */
  summary?: string;
  /** 0-100 fill % for the slim bar shown when collapsed */
  summaryPct?: number;
  /** Color of the slim collapsed bar */
  summaryColor?: string;
  defaultCollapsed?: boolean;
}

export default function MeterCard({
  title,
  icon,
  accentColor,
  children,
  delay = 0,
  error,
  summary,
  summaryPct,
  summaryColor,
  defaultCollapsed = false,
}: MeterCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const collapsible = !!summary;

  return (
    <div
      className={`${styles.card} ${collapsed ? styles.cardCollapsed : ""}`}
      style={{
        animationDelay: `${delay}ms`,
        borderColor: `color-mix(in srgb, ${accentColor} 25%, transparent)`,
      }}
    >
      <div
        className={`${styles.header} ${collapsible ? styles.headerClickable : ""}`}
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
      >
        <div
          className={styles.iconWrap}
          style={{
            background: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
            color: accentColor,
          }}
        >
          {icon}
        </div>
        <span className={styles.title}>{title}</span>
        {collapsible && collapsed && summary && (
          <span className={styles.collapsedSummary}>{summary}</span>
        )}
        {collapsible && (
          <ChevronDown
            size={13}
            className={`${styles.chevron} ${collapsed ? styles.chevronUp : ""}`}
          />
        )}
      </div>

      {/* Slim progress bar shown only when collapsed */}
      {collapsible && collapsed && summaryPct !== undefined && (
        <div className={styles.collapsedBar}>
          <div
            className={styles.collapsedFill}
            style={{
              width: `${summaryPct}%`,
              background: summaryColor ?? accentColor,
            }}
          />
        </div>
      )}

      {/* Full body — hidden when collapsed */}
      {!collapsed && (
        error ? (
          <div className={styles.errorBody}>
            <span className={styles.errorIcon}>⚠️</span>
            <span className={styles.errorText}>{error}</span>
          </div>
        ) : (
          <div className={styles.body}>{children}</div>
        )
      )}
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────── */

interface UsageBarProps {
  label: string;
  used: number;
  total: number;
  unit?: string;
  color: string;
}

export function UsageBar({ label, used, total, unit = "", color }: UsageBarProps) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const isWarning = pct > 80;
  const isCritical = pct > 95;
  const barColor = isCritical ? "var(--accent-red)" : isWarning ? "var(--accent-orange)" : color;

  return (
    <div className={styles.usageRow}>
      <div className={styles.usageHeader}>
        <span className={styles.usageLabel}>{label}</span>
        <span className={styles.usageValue}>
          {formatNumber(used)}
          {total > 0 && <span className={styles.usageTotal}> / {formatNumber(total)} {unit}</span>}
          {total === 0 && unit && <span className={styles.usageTotal}> {unit}</span>}
        </span>
      </div>
      {total > 0 && (
        <div className={styles.barTrack}>
          <div
            className={styles.barFill}
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${barColor}, color-mix(in srgb, ${barColor} 70%, white))`,
              boxShadow: `0 0 8px color-mix(in srgb, ${barColor} 40%, transparent)`,
            }}
          />
        </div>
      )}
    </div>
  );
}

interface StatProps {
  label: string;
  value: string | number;
  sub?: string;
}

export function Stat({ label, value, sub }: StatProps) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}
