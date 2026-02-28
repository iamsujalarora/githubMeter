import { useState, useEffect, Component, type ReactNode } from "react";
import TitleBar from "./components/TitleBar";
import LoginScreen from "./components/LoginScreen";
import Dashboard from "./components/Dashboard";
import SetupModal from "./components/SetupModal";
import { loadSavedToken } from "./api";
import { loadConfig } from "./config";
import type { AuthStatus, UserConfig } from "./types";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            color: "var(--text-secondary)",
            fontSize: "13px",
            textAlign: "center",
            gap: "12px",
          }}
        >
          <span style={{ color: "var(--accent-red)", fontSize: "15px", fontWeight: 500 }}>
            Something went wrong
          </span>
          <span style={{ color: "var(--text-muted)", maxWidth: "320px", wordBreak: "break-word" }}>
            {this.state.error.message}
          </span>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: "8px",
              padding: "6px 16px",
              background: "var(--bg-card)",
              border: "1px solid var(--border-default)",
              borderRadius: "6px",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [showSetup, setShowSetup] = useState(false);
  const [config, setConfig] = useState<UserConfig | null>(null);

  useEffect(() => {
    // Try to restore a saved session
    loadSavedToken()
      .then(() => {
        const saved = loadConfig();
        setConfig(saved);
        if (!saved) setShowSetup(true);
        setAuthStatus("authenticated");
      })
      .catch(() => setAuthStatus("unauthenticated"));
  }, []);

  const handleAuthenticated = () => {
    const saved = loadConfig();
    setConfig(saved);
    if (!saved) setShowSetup(true);
    setAuthStatus("authenticated");
  };
  const handleLogout = () => {
    setConfig(null);
    setAuthStatus("unauthenticated");
  };
  const handleSetupComplete = () => {
    setConfig(loadConfig());
    setShowSetup(false);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--bg-primary)",
        borderRadius: "var(--radius-xl)",
        overflow: "hidden",
        border: "1px solid var(--border-muted)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <TitleBar />
      <ErrorBoundary>
        {authStatus === "loading" ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: "13px",
            }}
          >
            Loading…
          </div>
        ) : authStatus === "authenticated" ? (
          <Dashboard
            onLogout={handleLogout}
            onOpenSettings={() => setShowSetup(true)}
            config={config}
          />
        ) : (
          <LoginScreen onAuthenticated={handleAuthenticated} />
        )}
      </ErrorBoundary>
      {showSetup && (
        <SetupModal
          onComplete={handleSetupComplete}
          existing={config ?? undefined}
        />
      )}
    </div>
  );
}

export default App;
