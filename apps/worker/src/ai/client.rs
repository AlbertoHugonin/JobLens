use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use serde_json::{Map, Value, json};

#[derive(Debug, Clone)]
pub(crate) struct AiRuntime {
    pub(crate) keep_alive: String,
    pub(crate) num_ctx: i64,
    pub(crate) num_predict: i64,
    pub(crate) retry_attempts: u64,
    pub(crate) retry_delay_seconds: u64,
    pub(crate) temperature: f64,
    pub(crate) think: bool,
    pub(crate) timeout_seconds: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct AiCompletion {
    pub(crate) metrics: Value,
    pub(crate) raw_output: String,
}

/// Outcome of a failed AI request, split so callers can treat a server that is
/// simply down differently from one that answered with an error.
#[derive(Debug)]
pub(crate) enum AiRequestError {
    /// The endpoint could not be reached (connection refused, host down, …).
    Unreachable(anyhow::Error),
    /// The endpoint responded but the call failed (HTTP error, bad body, timeout).
    Failed(anyhow::Error),
}

impl AiRequestError {
    pub(crate) fn is_unreachable(&self) -> bool {
        matches!(self, AiRequestError::Unreachable(_))
    }

    pub(crate) fn message(&self) -> String {
        match self {
            AiRequestError::Unreachable(error) | AiRequestError::Failed(error) => {
                format!("{error:#}")
            }
        }
    }
}

impl From<anyhow::Error> for AiRequestError {
    fn from(error: anyhow::Error) -> Self {
        AiRequestError::Failed(error)
    }
}

fn classify_send_error(error: reqwest::Error) -> AiRequestError {
    if error.is_connect() {
        AiRequestError::Unreachable(anyhow::Error::new(error).context("AI endpoint unreachable"))
    } else {
        AiRequestError::Failed(anyhow::Error::new(error).context("AI review request failed"))
    }
}

impl AiRuntime {
    pub(crate) fn from_value(value: &Value) -> Self {
        let object = value.as_object();
        Self {
            keep_alive: read_string(object, "keepAlive", "10m"),
            num_ctx: read_i64(object, "numCtx", 8192).max(512),
            num_predict: read_i64(object, "numPredict", 1024).max(128),
            retry_attempts: read_i64(object, "retryAttempts", 1).clamp(0, 10) as u64,
            retry_delay_seconds: read_i64(object, "retryDelaySeconds", 30).max(0) as u64,
            temperature: read_f64(object, "temperature", 0.2).clamp(0.0, 2.0),
            think: read_bool(object, "think", false),
            timeout_seconds: read_i64(object, "timeoutSeconds", 120).max(5) as u64,
        }
    }
}

pub(crate) async fn request_ai_review(
    base_url: &str,
    model_name: &str,
    prompt: &str,
    runtime: &AiRuntime,
    response_schema: &Value,
) -> Result<AiCompletion, AiRequestError> {
    let started = Instant::now();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(runtime.timeout_seconds))
        .build()
        .context("cannot build AI HTTP client")?;
    let response = client
        .post(build_chat_url(base_url)?)
        .json(&json!({
            "format": response_schema,
            "keep_alive": runtime.keep_alive,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a local job-offer evaluator. Return only valid compact JSON matching the provided schema. Do not use markdown or add text outside JSON."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "model": model_name,
            "options": {
                "num_ctx": runtime.num_ctx,
                "num_predict": runtime.num_predict,
                "temperature": runtime.temperature,
            },
            "stream": false,
            "think": runtime.think,
        }))
        .send()
        .await
        .map_err(classify_send_error)?;
    let status = response.status();
    let body = response.text().await.context("read AI response failed")?;

    if !status.is_success() {
        return Err(AiRequestError::Failed(anyhow!(
            "AI endpoint returned HTTP {}",
            status.as_u16()
        )));
    }

    let parsed = serde_json::from_str::<Value>(&body).unwrap_or(Value::String(body));
    let raw_output = extract_model_output(&parsed);
    let mut metrics = extract_metrics(&parsed);
    metrics["durationMs"] = json!(u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX));
    metrics["statusCode"] = json!(status.as_u16());

    Ok(AiCompletion {
        metrics,
        raw_output,
    })
}

fn build_chat_url(base_url: &str) -> Result<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(anyhow!("AI endpoint base URL is empty"));
    }
    if trimmed.ends_with("/api/chat") {
        Ok(trimmed.to_string())
    } else if let Some(prefix) = trimmed.strip_suffix("/api/generate") {
        Ok(format!("{prefix}/api/chat"))
    } else if trimmed.ends_with("/api") {
        Ok(format!("{trimmed}/chat"))
    } else {
        Ok(format!("{trimmed}/api/chat"))
    }
}

fn extract_model_output(value: &Value) -> String {
    value
        .get("response")
        .and_then(Value::as_str)
        .or_else(|| value.get("output").and_then(Value::as_str))
        .or_else(|| value.get("content").and_then(Value::as_str))
        .or_else(|| {
            value
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(Value::as_str)
        })
        .map(ToString::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn extract_metrics(value: &Value) -> Value {
    let mut metrics = Map::new();
    for (source, target) in [
        ("done_reason", "stopReason"),
        ("eval_count", "outputTokens"),
        ("eval_duration", "evalDurationNs"),
        ("load_duration", "loadDurationNs"),
        ("prompt_eval_count", "promptTokens"),
        ("prompt_eval_duration", "promptEvalDurationNs"),
        ("total_duration", "totalDurationNs"),
    ] {
        if let Some(item) = value.get(source) {
            metrics.insert(target.to_string(), item.clone());
        }
    }

    if let (Some(tokens), Some(duration_ns)) = (
        metrics.get("outputTokens").and_then(Value::as_f64),
        metrics.get("evalDurationNs").and_then(Value::as_f64),
    ) && duration_ns > 0.0
    {
        metrics.insert(
            "tokensPerSecond".to_string(),
            json!(tokens / (duration_ns / 1_000_000_000.0)),
        );
    }

    Value::Object(metrics)
}

fn read_string(object: Option<&Map<String, Value>>, key: &str, fallback: &str) -> String {
    object
        .and_then(|value| value.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn read_i64(object: Option<&Map<String, Value>>, key: &str, fallback: i64) -> i64 {
    object
        .and_then(|value| value.get(key))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str()?.parse::<i64>().ok())
        })
        .unwrap_or(fallback)
}

fn read_f64(object: Option<&Map<String, Value>>, key: &str, fallback: f64) -> f64 {
    object
        .and_then(|value| value.get(key))
        .and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str()?.parse::<f64>().ok())
        })
        .unwrap_or(fallback)
}

fn read_bool(object: Option<&Map<String, Value>>, key: &str, fallback: bool) -> bool {
    object
        .and_then(|value| value.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_url_accepts_base_or_legacy_generate_url() {
        assert_eq!(
            build_chat_url("http://localhost:11434").expect("base url"),
            "http://localhost:11434/api/chat"
        );
        assert_eq!(
            build_chat_url("http://localhost:11434/api").expect("api url"),
            "http://localhost:11434/api/chat"
        );
        assert_eq!(
            build_chat_url("http://localhost:11434/api/generate").expect("generate url"),
            "http://localhost:11434/api/chat"
        );
    }
}
