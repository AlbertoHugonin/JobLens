use anyhow::{Context, Result, anyhow};
use serde_json::Value;
use sqlx::{PgPool, Row};

use crate::util::read_json_string;

use super::types::{LinkedInSearch, LinkedInSession};

pub(crate) async fn read_linkedin_search(pool: &PgPool, search_id: &str) -> Result<LinkedInSearch> {
    let row = sqlx::query(
        r#"
        SELECT
          searches.id::text AS search_id,
          searches.query,
          providers.id::text AS provider_id
        FROM searches
        JOIN providers ON providers.id = searches.provider_id
        WHERE searches.id = $1::uuid
          AND searches.enabled = true
          AND providers.provider_key = 'linkedin'
        "#,
    )
    .bind(search_id)
    .fetch_optional(pool)
    .await
    .context("read LinkedIn search query failed")?
    .context("enabled LinkedIn search was not found")?;

    Ok(LinkedInSearch {
        provider_id: row.try_get("provider_id")?,
        query: row.try_get("query")?,
        search_id: row.try_get("search_id")?,
    })
}

pub(crate) async fn read_active_linkedin_session(
    pool: &PgPool,
    provider_id: &str,
) -> Result<LinkedInSession> {
    let row = sqlx::query(
        r#"
        SELECT session_data
        FROM provider_sessions
        WHERE provider_id = $1::uuid
          AND status = 'active'
        ORDER BY COALESCE(last_verified_at, updated_at) DESC, created_at DESC
        LIMIT 1
        "#,
    )
    .bind(provider_id)
    .fetch_optional(pool)
    .await
    .context("read LinkedIn session failed")?
    .context("no active LinkedIn session is available")?;

    Ok(LinkedInSession {
        data: row.try_get("session_data")?,
    })
}

pub(crate) async fn read_optional_active_linkedin_session(
    pool: &PgPool,
    provider_id: &str,
) -> Result<Option<LinkedInSession>> {
    let row = sqlx::query(
        r#"
        SELECT session_data
        FROM provider_sessions
        WHERE provider_id = $1::uuid
          AND status = 'active'
        ORDER BY COALESCE(last_verified_at, updated_at) DESC, created_at DESC
        LIMIT 1
        "#,
    )
    .bind(provider_id)
    .fetch_optional(pool)
    .await
    .context("read optional LinkedIn session failed")?;

    Ok(row
        .map(|row| row.try_get("session_data"))
        .transpose()?
        .map(|data| LinkedInSession { data }))
}

/// Browser-like default used when the session does not carry a user agent.
const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/126 Safari/537.36";

/// Voyager request headers, rebuilt from the two minimal secrets.
///
/// The persisted envelope only stores `secrets.li_at` and `secrets.jsessionid`
/// (verified to be the only mandatory credentials). The full `cookie` header is
/// reconstructed here, and the `csrf-token` header is the JSESSIONID value with
/// the surrounding quotes stripped. A legacy full-cookie envelope is still
/// accepted as a fallback.
pub(crate) fn build_linkedin_headers(
    session: &LinkedInSession,
) -> Result<reqwest::header::HeaderMap> {
    use reqwest::header::{
        ACCEPT, ACCEPT_LANGUAGE, COOKIE, HeaderMap, HeaderName, HeaderValue, USER_AGENT,
    };

    let (cookie, csrf_token) = resolve_cookie_and_csrf(session)?;
    let mut headers = HeaderMap::new();

    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.linkedin.normalized+json+2.1"),
    );
    headers.insert(COOKIE, HeaderValue::from_str(&cookie)?);
    headers.insert(
        HeaderName::from_static("csrf-token"),
        HeaderValue::from_str(&csrf_token)?,
    );
    headers.insert(
        HeaderName::from_static("x-restli-protocol-version"),
        HeaderValue::from_static("2.0.0"),
    );

    let user_agent =
        read_session_hint(session, "userAgent").unwrap_or_else(|| DEFAULT_USER_AGENT.to_string());
    headers.insert(USER_AGENT, HeaderValue::from_str(&user_agent)?);

    if let Some(accept_language) = read_session_hint(session, "acceptLanguage") {
        headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_str(&accept_language)?);
    }
    if let Some(x_li_lang) = read_session_hint(session, "xLiLang") {
        headers.insert(
            HeaderName::from_static("x-li-lang"),
            HeaderValue::from_str(&x_li_lang)?,
        );
    }
    if let Some(x_li_track) = read_session_hint(session, "xLiTrack") {
        headers.insert(
            HeaderName::from_static("x-li-track"),
            HeaderValue::from_str(&x_li_track)?,
        );
    }

    Ok(headers)
}

fn strip_quotes(value: &str) -> String {
    value.trim_matches('"').to_string()
}

/// Resolve the `(cookie, csrf-token)` pair from a session envelope.
fn resolve_cookie_and_csrf(session: &LinkedInSession) -> Result<(String, String)> {
    if let (Some(li_at), Some(jsessionid)) = (
        read_secret(session, "li_at"),
        read_secret(session, "jsessionid"),
    ) {
        let jsessionid = strip_quotes(&jsessionid);
        let cookie = format!("li_at={li_at}; JSESSIONID=\"{jsessionid}\"");
        return Ok((cookie, jsessionid));
    }

    // Legacy envelope: a full cookie header plus an explicit CSRF token.
    if let Some(cookie) = read_json_string(&session.data, "cookie") {
        let csrf = read_json_string(&session.data, "csrfToken")
            .or_else(|| extract_cookie_value(&cookie, "JSESSIONID"))
            .context("LinkedIn session is missing a CSRF token")?;
        return Ok((cookie, strip_quotes(&csrf)));
    }

    Err(anyhow!(
        "LinkedIn session is missing li_at / JSESSIONID credentials"
    ))
}

fn read_secret(session: &LinkedInSession, key: &str) -> Option<String> {
    session
        .data
        .get("secrets")
        .and_then(|secrets| secrets.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

/// Read a non-secret hint from `fingerprint`, falling back to the top level for
/// legacy envelopes.
fn read_session_hint(session: &LinkedInSession, key: &str) -> Option<String> {
    session
        .data
        .get("fingerprint")
        .and_then(|fingerprint| fingerprint.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| read_json_string(&session.data, key))
}

pub(crate) fn read_session_decoration_id(session: &LinkedInSession) -> Option<String> {
    // Ignore the lean "Lite" decoration that HAR prefetch requests often carry;
    // it returns near-empty cards. Fall back to the rich default instead.
    read_session_hint(session, "decorationId").filter(|id| !id.contains("Lite"))
}

/// User agent to send on every LinkedIn request: the value captured in the
/// session (if any), otherwise a browser-like default. Sending a realistic user
/// agent avoids looking like an automated client.
pub(crate) fn linkedin_user_agent(session: Option<&LinkedInSession>) -> String {
    session
        .and_then(|session| read_session_hint(session, "userAgent"))
        .unwrap_or_else(|| DEFAULT_USER_AGENT.to_string())
}

fn extract_cookie_value(cookie: &str, key: &str) -> Option<String> {
    cookie.split(';').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        if name.trim() == key {
            Some(strip_quotes(value.trim()))
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use reqwest::header::{ACCEPT, COOKIE, USER_AGENT};
    use serde_json::json;

    use super::*;

    #[test]
    fn rebuilds_cookie_and_csrf_from_minimal_secrets() {
        let session = LinkedInSession {
            data: json!({
                "secrets": { "li_at": "AQEDtoken", "jsessionid": "ajax:123" },
                "fingerprint": { "userAgent": "CustomUA/1.0" }
            }),
        };
        let headers = build_linkedin_headers(&session).expect("headers should build");

        assert_eq!(
            headers.get(COOKIE).and_then(|value| value.to_str().ok()),
            Some("li_at=AQEDtoken; JSESSIONID=\"ajax:123\"")
        );
        assert_eq!(
            headers
                .get("csrf-token")
                .and_then(|value| value.to_str().ok()),
            Some("ajax:123")
        );
        assert_eq!(
            headers
                .get(USER_AGENT)
                .and_then(|value| value.to_str().ok()),
            Some("CustomUA/1.0")
        );
        assert_eq!(
            headers.get(ACCEPT).and_then(|value| value.to_str().ok()),
            Some("application/vnd.linkedin.normalized+json+2.1")
        );
    }

    #[test]
    fn strips_quotes_from_jsessionid_secret() {
        let session = LinkedInSession {
            data: json!({
                "secrets": { "li_at": "AQEDtoken", "jsessionid": "\"ajax:777\"" }
            }),
        };
        let headers = build_linkedin_headers(&session).expect("headers should build");

        assert_eq!(
            headers
                .get("csrf-token")
                .and_then(|value| value.to_str().ok()),
            Some("ajax:777")
        );
        assert_eq!(
            headers
                .get(USER_AGENT)
                .and_then(|value| value.to_str().ok()),
            Some(DEFAULT_USER_AGENT)
        );
    }

    #[test]
    fn supports_legacy_full_cookie_envelope() {
        let session = LinkedInSession {
            data: json!({
                "cookie": "bcookie=x; li_at=legacy; JSESSIONID=\"ajax:9\"; lidc=z",
                "csrfToken": "ajax:9"
            }),
        };
        let headers = build_linkedin_headers(&session).expect("headers should build");

        assert_eq!(
            headers.get(COOKIE).and_then(|value| value.to_str().ok()),
            Some("bcookie=x; li_at=legacy; JSESSIONID=\"ajax:9\"; lidc=z")
        );
        assert_eq!(
            headers
                .get("csrf-token")
                .and_then(|value| value.to_str().ok()),
            Some("ajax:9")
        );
    }

    #[test]
    fn fails_without_credentials() {
        let session = LinkedInSession {
            data: json!({ "fingerprint": {} }),
        };

        assert!(build_linkedin_headers(&session).is_err());
    }

    #[test]
    fn reads_decoration_id_from_fingerprint() {
        let session = LinkedInSession {
            data: json!({
                "secrets": { "li_at": "a", "jsessionid": "ajax:1" },
                "fingerprint": { "decorationId": "deco-xyz" }
            }),
        };

        assert_eq!(
            read_session_decoration_id(&session),
            Some("deco-xyz".to_string())
        );
    }

    #[test]
    fn ignores_lean_lite_decoration_id() {
        let session = LinkedInSession {
            data: json!({
                "fingerprint": {
                    "decorationId":
                        "com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollectionLite-88"
                }
            }),
        };

        assert_eq!(read_session_decoration_id(&session), None);
    }

    #[test]
    fn omits_unstable_micro_schema_header() {
        let session = LinkedInSession {
            data: json!({ "secrets": { "li_at": "a", "jsessionid": "ajax:1" } }),
        };
        let headers = build_linkedin_headers(&session).expect("headers should build");

        assert!(!headers.contains_key("x-li-deco-include-micro-schema"));
    }
}
