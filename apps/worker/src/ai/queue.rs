use anyhow::{Context, Result};
use serde_json::Value;
use sqlx::{PgPool, Row};
use time::{OffsetDateTime, Weekday};

#[derive(Debug, Clone, Copy)]
struct PauseWindow {
    day_of_week: u8,
    end_minute: u16,
    start_minute: u16,
}

pub(crate) async fn is_ai_review_paused_now(pool: &PgPool, now: OffsetDateTime) -> Result<bool> {
    let pauses = read_ai_pauses(pool).await?;
    Ok(is_ai_paused(&pauses, now))
}

pub(crate) fn is_ai_paused(pauses: &Value, now: OffsetDateTime) -> bool {
    let Some(items) = pauses.as_array() else {
        return false;
    };

    items.iter().any(|item| {
        read_pause_window(item)
            .is_some_and(|window| window.contains(weekday_index(now.weekday()), minute_of_day(now)))
    })
}

async fn read_ai_pauses(pool: &PgPool) -> Result<Value> {
    let row = sqlx::query(
        r#"
        SELECT value
        FROM settings
        WHERE key = 'ai.pauses'
        "#,
    )
    .fetch_optional(pool)
    .await
    .context("read AI pause settings failed")?;

    Ok(row
        .map(|row| row.try_get("value"))
        .transpose()?
        .unwrap_or(Value::Array(Vec::new())))
}

fn read_pause_window(value: &Value) -> Option<PauseWindow> {
    if !value
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }

    let day_of_week = value.get("dayOfWeek").and_then(read_day_index).unwrap_or(0);
    let start_minute = value
        .get("startTime")
        .and_then(Value::as_str)
        .and_then(parse_time_minutes)?;
    let end_minute = value
        .get("endTime")
        .and_then(Value::as_str)
        .and_then(parse_time_minutes)?;

    (start_minute != end_minute).then_some(PauseWindow {
        day_of_week,
        end_minute,
        start_minute,
    })
}

fn read_day_index(value: &Value) -> Option<u8> {
    let raw = value
        .as_u64()
        .or_else(|| value.as_str()?.trim().parse::<u64>().ok())?;

    match raw {
        0 => Some(0),
        1..=6 => Some(raw as u8),
        7 => Some(0),
        _ => None,
    }
}

fn parse_time_minutes(value: &str) -> Option<u16> {
    let (hours, minutes) = value.trim().split_once(':')?;
    let hours = hours.parse::<u16>().ok()?;
    let minutes = minutes.parse::<u16>().ok()?;

    if hours < 24 && minutes < 60 {
        Some(hours * 60 + minutes)
    } else {
        None
    }
}

fn weekday_index(weekday: Weekday) -> u8 {
    match weekday {
        Weekday::Sunday => 0,
        Weekday::Monday => 1,
        Weekday::Tuesday => 2,
        Weekday::Wednesday => 3,
        Weekday::Thursday => 4,
        Weekday::Friday => 5,
        Weekday::Saturday => 6,
    }
}

fn minute_of_day(now: OffsetDateTime) -> u16 {
    u16::from(now.hour()) * 60 + u16::from(now.minute())
}

impl PauseWindow {
    fn contains(self, current_day: u8, current_minute: u16) -> bool {
        if self.start_minute < self.end_minute {
            current_day == self.day_of_week
                && current_minute >= self.start_minute
                && current_minute < self.end_minute
        } else {
            (current_day == self.day_of_week && current_minute >= self.start_minute)
                || (current_day == next_day(self.day_of_week) && current_minute < self.end_minute)
        }
    }
}

fn next_day(day: u8) -> u8 {
    (day + 1) % 7
}
