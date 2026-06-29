use std::time::{Duration, Instant};

use serde_json::Value;

pub(crate) fn duration_as_i64_seconds(duration: Duration) -> i64 {
    let seconds = duration.as_secs().max(1);
    i64::try_from(seconds).unwrap_or(i64::MAX)
}

pub(crate) fn divided_duration(duration: Duration, divisor: u32) -> Duration {
    duration
        .checked_div(divisor)
        .unwrap_or(duration)
        .max(Duration::from_millis(1))
}

pub(crate) fn read_json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn read_json_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

pub(crate) fn read_json_i32(value: &Value, key: &str) -> Option<i32> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .or_else(|| {
            value
                .get(key)
                .and_then(Value::as_str)
                .and_then(|value| value.parse::<i32>().ok())
        })
}

pub(crate) fn read_json_string_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn elapsed_millis_i32(started: Instant) -> i32 {
    i32::try_from(started.elapsed().as_millis()).unwrap_or(i32::MAX)
}
