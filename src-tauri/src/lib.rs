use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Manager, State};

// ── Constants ──────────────────────────────────────────────────────────────
const KEYRING_SERVICE: &str = "github-meter";
const KEYRING_USER: &str = "github-token";

// This is a *public* OAuth client ID for the GitHub Device Flow.
// Device Flow apps are "public clients" (RFC 8628) — the client_id is shipped
// in the binary and is not a secret. It cannot be used alone to obtain tokens;
// the user must explicitly authorise via github.com/login/device.
// Verify the GitHub App settings only grant the scopes below and have no
// redirect URI configured.
const GITHUB_CLIENT_ID: &str = "Ov23lipF7hO4UESDUMhq";
const GITHUB_SCOPES: &str = "user read:org";

// ── App State ──────────────────────────────────────────────────────────────
struct AppState {
    token: Mutex<Option<String>>,
    cancel_poll: AtomicBool,
    http: reqwest::Client,
}

// ── GitHub API response types ──────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokenResponse {
    pub access_token: Option<String>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
    pub interval: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHubUser {
    pub login: String,
    pub avatar_url: String,
    pub name: Option<String>,
    pub plan: Option<GitHubPlan>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHubPlan {
    pub name: Option<String>,
}

/// One row from the new Enhanced Billing usage/summary response
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UsageItem {
    pub product: String,
    pub sku: String,
    pub unit_type: String,
    pub price_per_unit: f64,
    pub gross_quantity: f64,
    pub gross_amount: f64,
    #[serde(default)]
    pub discount_quantity: f64,
    #[serde(default)]
    pub discount_amount: f64,
    pub net_quantity: f64,
    pub net_amount: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BillingUsageSummaryResponse {
    pub usage_items: Option<Vec<UsageItem>>,
}

/// One row from the premium_request/usage endpoint (per-model Copilot breakdown)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PremiumRequestItem {
    pub product: String,
    pub sku: String,
    pub model: String,
    pub unit_type: String,
    pub price_per_unit: f64,
    pub gross_quantity: f64,
    pub gross_amount: f64,
    #[serde(default)]
    pub discount_quantity: f64,
    #[serde(default)]
    pub discount_amount: f64,
    pub net_quantity: f64,
    pub net_amount: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PremiumRequestUsageResponse {
    pub usage_items: Option<Vec<PremiumRequestItem>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CopilotInfo {
    pub plan_type: Option<String>,
    pub last_activity_at: Option<String>,
    pub last_activity_editor: Option<String>,
    pub pending_cancellation_date: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MeterPayload {
    pub user: Option<GitHubUser>,
    pub usage_items: Vec<UsageItem>,
    pub premium_request_items: Vec<PremiumRequestItem>,
    pub usage_error: Option<String>,
    pub copilot_plan: Option<String>,
    pub rate_limit: Option<RateLimitInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitInfo {
    pub limit: u64,
    pub used: u64,
    pub remaining: u64,
    pub reset: u64,
}

// ── Keyring helpers ────────────────────────────────────────────────────────
fn save_token_to_keyring(token: &str) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.set_password(token);
    }
}

fn load_token_from_keyring() -> Option<String> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        entry.get_password().ok()
    } else {
        None
    }
}

fn delete_token_from_keyring() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_credential();
    }
}

/// Lock the token Mutex, returning a friendly error instead of panicking on poison.
fn lock_token(state: &AppState) -> Result<std::sync::MutexGuard<'_, Option<String>>, String> {
    state
        .token
        .lock()
        .map_err(|_| "Internal error: token lock poisoned".to_string())
}

// ── Tauri Commands ─────────────────────────────────────────────────────────

/// Initiate the GitHub Device Authorization Flow.
/// Returns the user_code + verification_uri for the frontend to display.
#[tauri::command]
async fn start_device_flow(state: State<'_, AppState>) -> Result<DeviceCodeResponse, String> {
    state.cancel_poll.store(false, Ordering::Relaxed);

    let resp = state
        .http
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", GITHUB_CLIENT_ID),
            ("scope", GITHUB_SCOPES),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to start device flow: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub rejected device flow request: {}", &body[..body.len().min(200)]));
    }

    let text = resp.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str::<DeviceCodeResponse>(&text)
        .map_err(|e| format!("Unexpected device code response: {} — raw: {}", e, &text[..text.len().min(200)]))
}

/// Poll GitHub for the access token after the user enters the device code.
/// Blocks until the token is granted, denied, expired, or cancelled.
#[tauri::command]
async fn poll_device_token(
    device_code: String,
    interval: u64,
    expires_in: u64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(expires_in);
    let mut wait_secs = interval.max(5);

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(wait_secs)).await;

        if state.cancel_poll.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }

        if std::time::Instant::now() > deadline {
            return Err("Device code expired — please try again.".into());
        }

        let resp = state
            .http
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", GITHUB_CLIENT_ID),
                ("device_code", device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|e| format!("Network error during polling: {}", e))?;

        let token_resp: TokenResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))?;

        match token_resp.error.as_deref() {
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                wait_secs = token_resp.interval.unwrap_or(wait_secs + 5);
                continue;
            }
            Some("expired_token") => {
                return Err("Device code expired — please try again.".into());
            }
            Some("access_denied") => {
                return Err("Authorization was denied. Please try again.".into());
            }
            Some(other) => {
                return Err(format!(
                    "GitHub error: {} — {}",
                    other,
                    token_resp.error_description.as_deref().unwrap_or("")
                ));
            }
            None => {}
        }

        if let Some(token) = token_resp.access_token {
            save_token_to_keyring(&token);
            *lock_token(&state)? = Some(token.clone());
            return Ok(token);
        }
    }
}

/// Cancel an in-progress device flow poll
#[tauri::command]
async fn cancel_device_flow(state: State<'_, AppState>) -> Result<(), String> {
    state.cancel_poll.store(true, Ordering::Relaxed);
    Ok(())
}

/// Try to get token from gh CLI (non-blocking via tokio::process)
#[tauri::command]
async fn gh_cli_token(state: State<'_, AppState>) -> Result<String, String> {
    let output = tokio::process::Command::new("gh")
        .args(["auth", "token"])
        .output()
        .await
        .map_err(|e| format!("Failed to run gh CLI: {}", e))?;

    if output.status.success() {
        let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !token.is_empty() {
            save_token_to_keyring(&token);
            *lock_token(&state)? = Some(token.clone());
            return Ok(token);
        }
    }
    Err("gh CLI not available or not authenticated".into())
}

/// Try to load saved token from keyring
#[tauri::command]
async fn load_saved_token(state: State<'_, AppState>) -> Result<String, String> {
    if let Some(token) = load_token_from_keyring() {
        *lock_token(&state)? = Some(token.clone());
        Ok(token)
    } else {
        Err("No saved token".into())
    }
}

/// Validate a token by calling GET /user and store it if valid
#[tauri::command]
async fn store_token(token: String, state: State<'_, AppState>) -> Result<(), String> {
    // Validate the token before saving — catches truncated/invalid PATs early
    let resp = state
        .http
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json")
        .header("User-Agent", "github-meter")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Network error validating token: {}", e))?;

    if !resp.status().is_success() {
        return Err("Invalid token — GitHub rejected authentication. Please check and try again.".into());
    }

    save_token_to_keyring(&token);
    *lock_token(&state)? = Some(token);
    Ok(())
}

/// Logout – clear stored token.
///
/// Note: Device Flow tokens are issued by a public OAuth client (no client_secret),
/// so server-side revocation via DELETE /applications/{client_id}/token is not
/// possible. The token is removed from the local keyring and memory. Users who
/// want to fully revoke the grant can do so at:
///   https://github.com/settings/connections/applications/{GITHUB_CLIENT_ID}
#[tauri::command]
async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    delete_token_from_keyring();
    *lock_token(&state)? = None;
    Ok(())
}

/// Helper to make authenticated GitHub API calls
async fn gh_api_get<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    token: &str,
    url: &str,
) -> Result<T, String> {
    gh_api_get_with_hint(client, token, url, None).await
}

async fn gh_api_get_with_hint<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    token: &str,
    url: &str,
    hint_403: Option<&str>,
) -> Result<T, String> {
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json")
        .header("User-Agent", "github-meter")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        // Try to extract the human-readable "message" from GitHub's error JSON
        let gh_message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| body.chars().take(120).collect());

        let friendly = match status.as_u16() {
            401 => "Not authenticated — please sign out and sign in again.".into(),
            403 => {
                let base = hint_403.unwrap_or("Access denied — sign out and sign in again to grant the required permissions.");
                format!("{} ({})", base, gh_message)
            }
            404 => "Not available — GitHub has migrated most accounts to the new billing platform. Check github.com/settings/billing for your usage.".into(),
            _ => format!("GitHub API {} — {}", status.as_u16(), gh_message),
        };
        return Err(friendly);
    }

    resp.json::<T>().await.map_err(|e| format!("Failed to parse response: {}", e))
}

/// Detect the Copilot plan from billing SKUs, GitHub plan, and premium request data.
///
/// Detection priority:
/// 1. Billing SKU names: copilot_enterprise, copilot_for_business, copilot_standalone
///    (standalone price: ~$39 → Pro+, ~$10 → Pro)
/// 2. GitHub account plan: "pro" includes Copilot Pro (300 req)
/// 3. Any Copilot usage present → Free tier (50 req)
///
/// NOTE: This heuristic depends on GitHub's current SKU naming and pricing.
/// If GitHub changes SKU names or prices, this may mis-classify plans.
fn infer_copilot_plan(
    user_plan: &Option<GitHubPlan>,
    usage_items: &[UsageItem],
    premium_items: &[PremiumRequestItem],
) -> Option<String> {
    // 1. Check billing SKUs for subscription-level indicators
    for item in usage_items.iter() {
        let sku = item.sku.to_lowercase();
        if sku.contains("copilot_enterprise") || sku.contains("copilot enterprise") {
            eprintln!("[github-meter] Copilot plan detected from SKU: enterprise (sku={})", item.sku);
            return Some("enterprise".into());
        }
        if sku.contains("copilot_for_business") || sku.contains("copilot business") {
            eprintln!("[github-meter] Copilot plan detected from SKU: business (sku={})", item.sku);
            return Some("business".into());
        }
        if sku.contains("copilot_standalone") || sku.contains("copilot standalone") {
            // Distinguish Pro ($10/mo) from Pro+ ($39/mo) by unit price
            let plan = if item.price_per_unit >= 30.0 { "pro_plus" } else { "pro" };
            eprintln!(
                "[github-meter] Copilot plan detected from SKU: {} (sku={}, price={})",
                plan, item.sku, item.price_per_unit
            );
            return Some(plan.into());
        }
    }

    // 2. GitHub Pro includes Copilot Pro
    if let Some(plan) = user_plan {
        if let Some(ref name) = plan.name {
            if name.to_lowercase() == "pro" {
                eprintln!("[github-meter] Copilot plan inferred from GitHub plan: pro");
                return Some("pro".into());
            }
        }
    }

    // 3. Any Copilot usage at all → Free tier
    let has_copilot_usage = usage_items.iter().any(|i| i.product.to_lowercase().contains("copilot"))
        || !premium_items.is_empty();
    if has_copilot_usage {
        eprintln!("[github-meter] Copilot plan inferred from usage presence: free");
        return Some("free".into());
    }

    eprintln!("[github-meter] No Copilot activity detected — plan unknown");
    // No Copilot activity detected
    None
}

/// Fetch all metered usage data
#[tauri::command]
async fn fetch_billing(state: State<'_, AppState>) -> Result<MeterPayload, String> {
    let token = lock_token(&state)?
        .clone()
        .ok_or("Not authenticated")?;

    let client = &state.http;

    // Fetch user info first to get the username
    let user: GitHubUser =
        gh_api_get(client, &token, "https://api.github.com/user").await?;
    let username = &user.login;

    // New Enhanced Billing Platform endpoint — replaces the old per-product 410'd endpoints
    let usage_url = format!("https://api.github.com/users/{}/settings/billing/usage/summary", username);
    // Per-model Copilot premium request breakdown (GA as of Feb 2026)
    let premium_url = format!("https://api.github.com/users/{}/settings/billing/premium_request/usage", username);

    let (usage_res, premium_res, rate_limit_res) = tokio::join!(
        gh_api_get::<BillingUsageSummaryResponse>(client, &token, &usage_url),
        gh_api_get::<PremiumRequestUsageResponse>(client, &token, &premium_url),
        gh_api_get::<serde_json::Value>(client, &token, "https://api.github.com/rate_limit"),
    );

    let (usage_items, usage_error) = match usage_res {
        Ok(summary) => (summary.usage_items.unwrap_or_default(), None),
        Err(e) => (vec![], Some(e)),
    };

    // Premium request items are best-effort; don't surface errors for this endpoint
    let premium_request_items = premium_res
        .ok()
        .and_then(|r| r.usage_items)
        .unwrap_or_default();

    // Detect copilot plan from billing SKUs, GitHub plan, and premium request data
    let copilot_plan = infer_copilot_plan(&user.plan, &usage_items, &premium_request_items);

    let rate_limit = rate_limit_res.ok().and_then(|v| {
        let core = v.get("rate")?;
        Some(RateLimitInfo {
            limit: core.get("limit")?.as_u64()?,
            used: core.get("used")?.as_u64()?,
            remaining: core.get("remaining")?.as_u64()?,
            reset: core.get("reset")?.as_u64()?,
        })
    });

    Ok(MeterPayload {
        user: Some(user),
        usage_items,
        premium_request_items,
        usage_error,
        copilot_plan,
        rate_limit,
    })
}

/// Set window opacity (0.0 - 1.0).
/// The frontend sets the CSS opacity directly; this command is kept for API
/// compatibility but no longer uses eval() to inject JS into the webview.
#[tauri::command]
async fn set_opacity(_app: tauri::AppHandle, _opacity: f64) -> Result<(), String> {
    Ok(())
}

/// Open a URL in the default browser.
/// Only allows http:// and https:// schemes to prevent arbitrary file/command execution.
#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only http:// and https:// URLs are allowed".into());
    }
    open::that(&url).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Clean up legacy OAuth App credentials from the old flow
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, "github-meter-client-id") {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, "github-meter-client-secret") {
        let _ = entry.delete_credential();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Set the window icon at runtime so the Windows taskbar shows the
            // custom icon instead of the default Tauri feather.
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    let _ = window.set_icon(icon.clone());
                }
            }
            Ok(())
        })
        .manage(AppState {
            token: Mutex::new(None),
            cancel_poll: AtomicBool::new(false),
            http: reqwest::Client::new(),
        })
        .invoke_handler(tauri::generate_handler![
            start_device_flow,
            poll_device_token,
            cancel_device_flow,
            gh_cli_token,
            load_saved_token,
            store_token,
            logout,
            fetch_billing,
            set_opacity,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
