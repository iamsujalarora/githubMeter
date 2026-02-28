import { useState, useCallback } from "react";
import {
  startDeviceFlow,
  pollDeviceToken,
  cancelDeviceFlow,
  ghCliToken,
  storeToken,
  openUrl,
} from "../api";
import {
  Github,
  Terminal,
  Key,
  Loader2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from "lucide-react";
import styles from "./LoginScreen.module.css";

interface LoginScreenProps {
  onAuthenticated: () => void;
}

type View = "login" | "device";

export default function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [view, setView] = useState<View>("login");
  const [error, setError] = useState<string | null>(null);
  const [showAlts, setShowAlts] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [userCode, setUserCode] = useState("");
  const [copied, setCopied] = useState(false);

  // ── Device Flow ─────────────────────────────────────────────
  const signInWithGitHub = useCallback(async () => {
    setError(null);
    setIsBusy(true);
    try {
      const info = await startDeviceFlow();
      setUserCode(info.user_code);
      setView("device");

      await openUrl(info.verification_uri);
      await pollDeviceToken(info.device_code, info.interval, info.expires_in);
      onAuthenticated();
    } catch (e) {
      const msg = String(e);
      if (msg !== "cancelled") {
        setError(msg);
      }
      setView("login");
    } finally {
      setIsBusy(false);
    }
  }, [onAuthenticated]);

  const cancelFlow = async () => {
    await cancelDeviceFlow();
    setView("login");
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access failed silently
    }
  };

  // ── gh CLI ────────────────────────────────────────────────────
  const tryGhCli = async () => {
    setError(null);
    setIsBusy(true);
    try {
      await ghCliToken();
      onAuthenticated();
    } catch {
      setError("gh CLI not found or not authenticated. Run 'gh auth login' first.");
    } finally {
      setIsBusy(false);
    }
  };

  // ── PAT ───────────────────────────────────────────────────────
  const submitPAT = async () => {
    if (!manualToken.trim()) return;
    setError(null);
    setIsBusy(true);
    try {
      await storeToken(manualToken.trim());
      onAuthenticated();
    } catch (e) {
      setError(String(e));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logoWrap}>
          <div className={styles.logoCircle}>
            <svg width="36" height="36" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </div>
          <h1 className={styles.heading}>GitHub Meter</h1>
          <p className={styles.subtitle}>Sign in to monitor your usage</p>
        </div>

        {/* Error */}
        {error && <div className={styles.errorBox}><span>{error}</span></div>}

        {/* ── LOGIN VIEW ── */}
        {view === "login" && (
          <div className={styles.buttons}>
            <button className={styles.primaryBtn} onClick={signInWithGitHub} disabled={isBusy}>
              {isBusy ? <Loader2 size={16} className={styles.spinner} /> : <Github size={16} />}
              Sign in with GitHub
            </button>
            <p className={styles.oauthHint}>You'll get a code to enter on GitHub.</p>
            <div className={styles.divider}><span>other ways to sign in</span></div>
            <button className={styles.secondaryBtn} onClick={tryGhCli} disabled={isBusy}>
              {isBusy ? <Loader2 size={14} className={styles.spinner} /> : <Terminal size={14} />}
              Use gh CLI Token
            </button>
            <button className={styles.tertiaryBtn} onClick={() => setShowAlts(!showAlts)}>
              <Key size={13} /> Enter PAT manually
              {showAlts ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showAlts && (
              <div className={styles.fieldGroup}>
                <input type="password" className={styles.tokenInput}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitPAT()} autoFocus />
                <button className={styles.submitBtn} onClick={submitPAT}
                  disabled={!manualToken.trim() || isBusy}>Connect</button>
              </div>
            )}
          </div>
        )}

        {/* ── DEVICE CODE VIEW ── */}
        {view === "device" && (
          <div className={styles.waitingSection}>
            <div className={styles.codeSection}>
              <p className={styles.codeLabel}>Your verification code</p>
              <div className={styles.codeBox}>
                <span className={styles.userCode}>{userCode}</span>
                <button className={styles.copyBtn} onClick={copyCode} title="Copy code">
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>
            <div className={styles.polling}>
              <Loader2 size={14} className={styles.spinner} />
              <span>Waiting for authorization...</span>
            </div>
            <p className={styles.waitingHint}>
              Enter this code at <strong>github.com/login/device</strong><br />
              A browser tab has been opened for you.
            </p>
            <button className={styles.cancelBtn} onClick={cancelFlow}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
