import { useState } from "react";
import { saveConfig } from "../config";
import type { BudgetEntry, UserConfig } from "../types";
import styles from "./SetupModal.module.css";

// ── Copilot plan options ──────────────────────────────────────────────────────
const COPILOT_PLANS = [
  { id: "free",       label: "Copilot Free",        reqPerMonth: 50,   note: "GitHub Free" },
  { id: "pro",        label: "Copilot Pro",          reqPerMonth: 300,  note: "GitHub Pro / Copilot Pro" },
  { id: "pro_plus",   label: "Copilot Pro+",         reqPerMonth: 1500, note: "Copilot Pro+" },
  { id: "business",   label: "Copilot Business",     reqPerMonth: 300,  note: "Team / Business" },
  { id: "enterprise", label: "Copilot Enterprise",   reqPerMonth: 1000, note: "Enterprise" },
] as const;

// ── Products that can have spending budgets ───────────────────────────────────
const BUDGET_PRODUCTS = [
  "Actions",
  "Packages",
  "Copilot",
  "Codespaces",
  "Storage",
  "Git LFS",
  "Spark",
];

interface Props {
  onComplete: () => void;
  existing?: UserConfig;
}

export default function SetupModal({ onComplete, existing }: Props) {
  // ── Step state ──────────────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2>(1);

  // ── Step 1: plan ────────────────────────────────────────────────────────────
  const [selectedPlan, setSelectedPlan] = useState<string>(
    existing?.copilotPlan ?? ""
  );

  // ── Step 2: budgets ─────────────────────────────────────────────────────────
  const [budgets, setBudgets] = useState<BudgetEntry[]>(
    existing?.budgets.length ? existing.budgets : []
  );

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleAddBudget() {
    setBudgets((prev) => [...prev, { product: BUDGET_PRODUCTS[0], amountDollars: 0 }]);
  }

  function handleRemoveBudget(idx: number) {
    setBudgets((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleBudgetChange(idx: number, field: keyof BudgetEntry, value: string) {
    setBudgets((prev) =>
      prev.map((b, i) =>
        i === idx
          ? {
              ...b,
              [field]: field === "amountDollars" ? Number(value) : value,
            }
          : b
      )
    );
  }

  function handleSave() {
    const config: UserConfig = {
      copilotPlan: selectedPlan || "free",
      budgets: budgets.filter((b) => b.amountDollars > 0),
      configuredAt: Date.now(),
    };
    saveConfig(config);
    onComplete();
  }

  // ── Render: Step 1 ───────────────────────────────────────────────────────────
  const isEdit = !!existing;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>
            {isEdit ? "Settings" : "Welcome to GitHub Meter"}
          </h2>
          {!isEdit && (
            <p className={styles.subtitle}>
              Let's set up your account so we can display accurate usage limits.
            </p>
          )}
          {/* Step indicators */}
          <div className={styles.steps}>
            <StepDot num={1} active={step === 1} done={step > 1} />
            <div className={styles.stepLine} />
            <StepDot num={2} active={step === 2} done={false} />
          </div>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {step === 1 && (
            <>
              <p className={styles.sectionLabel}>
                What Copilot subscription do you have?
              </p>
              <div className={styles.planGrid}>
                {COPILOT_PLANS.map((p) => (
                  <button
                    key={p.id}
                    className={[
                      styles.planTile,
                      selectedPlan === p.id ? styles.planTileSelected : "",
                    ].join(" ")}
                    onClick={() => setSelectedPlan(p.id)}
                  >
                    <span className={styles.planName}>{p.label}</span>
                    <span className={styles.planReqs}>
                      {p.reqPerMonth.toLocaleString()} req/mo
                    </span>
                    <span className={styles.planNote}>{p.note}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className={styles.sectionLabel}>
                Spending budgets <span className={styles.subtle}>(optional)</span>
              </p>
              <p className={styles.hint}>
                Add a monthly dollar budget for a product and we'll calculate your extra units.
              </p>

              {budgets.length === 0 && (
                <p className={styles.emptyBudgets}>No budgets set – usage limits are plan defaults only.</p>
              )}

              {budgets.map((b, idx) => (
                <div key={idx} className={styles.budgetRow}>
                  <select
                    className={styles.budgetProduct}
                    value={b.product}
                    onChange={(e) => handleBudgetChange(idx, "product", e.target.value)}
                  >
                    {BUDGET_PRODUCTS.map((prod) => (
                      <option key={prod} value={prod}>{prod}</option>
                    ))}
                  </select>
                  <span className={styles.budgetDollar}>$</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className={styles.budgetAmount}
                    value={b.amountDollars === 0 ? "" : b.amountDollars}
                    placeholder="0"
                    onChange={(e) => handleBudgetChange(idx, "amountDollars", e.target.value)}
                  />
                  <span className={styles.budgetPer}>/mo</span>
                  <button
                    className={styles.budgetRemove}
                    onClick={() => handleRemoveBudget(idx)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}

              <button className={styles.addBudget} onClick={handleAddBudget}>
                + Add product budget
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {step === 1 && (
            <>
              <span />
              <button
                className={styles.btnPrimary}
                disabled={!selectedPlan}
                onClick={() => setStep(2)}
              >
                Next →
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button className={styles.btnSecondary} onClick={() => setStep(1)}>
                ← Back
              </button>
              <button className={styles.btnPrimary} onClick={handleSave}>
                {isEdit ? "Save Changes" : "Save & Continue"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helper component ─────────────────────────────────────────────────────────
function StepDot({ num, active, done }: { num: number; active: boolean; done: boolean }) {
  const cls = [
    styles.stepDot,
    active ? styles.stepDotActive : "",
    done ? styles.stepDotDone : "",
  ].join(" ");
  return <div className={cls}>{done ? "✓" : num}</div>;
}
