use anyhow::{Context, Result};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use time::{OffsetDateTime, Weekday};

use crate::activities::insert_activity_log;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MinuteWindow {
    end_minute: u16,
    start_minute: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SearchSchedule {
    active_days: Vec<u8>,
    extra_delay_minutes: i64,
    inactive_window: Option<MinuteWindow>,
    interval_minutes: i64,
}

#[derive(Debug)]
struct ScheduledSearchRow {
    elapsed_seconds: Option<i64>,
    id: String,
    name: String,
    schedule_config: Value,
}

const DEFAULT_INTERVAL_MINUTES: i64 = 24 * 60;
const MAX_INTERVAL_MINUTES: i64 = 30 * 24 * 60;

pub(crate) async fn enqueue_due_searches(pool: &PgPool, now: OffsetDateTime) -> Result<usize> {
    let searches = read_schedulable_searches(pool).await?;
    let mut queued = 0;

    for search in searches {
        if !is_search_due(&search.schedule_config, search.elapsed_seconds, now) {
            continue;
        }

        if enqueue_linkedin_collection(pool, &search).await? {
            queued += 1;
        }
    }

    Ok(queued)
}

pub(crate) fn is_search_due(
    schedule_config: &Value,
    elapsed_seconds: Option<i64>,
    now: OffsetDateTime,
) -> bool {
    let Some(schedule) = parse_search_schedule(schedule_config) else {
        return false;
    };

    if !is_active_day(&schedule.active_days, now.weekday()) {
        return false;
    }

    if schedule
        .inactive_window
        .is_some_and(|window| window.contains(minute_of_day(now)))
    {
        return false;
    }

    match elapsed_seconds {
        Some(seconds) => {
            let due_after_seconds =
                (schedule.interval_minutes + schedule.extra_delay_minutes).max(1) * 60;
            seconds >= due_after_seconds
        }
        None => true,
    }
}

fn parse_search_schedule(value: &Value) -> Option<SearchSchedule> {
    if !read_bool(value, "enabled", false) {
        return None;
    }

    let interval_minutes =
        read_i64(value, "intervalMinutes", DEFAULT_INTERVAL_MINUTES).clamp(1, MAX_INTERVAL_MINUTES);
    let extra_delay_minutes =
        read_i64(value, "extraDelayMinutes", 0).clamp(0, MAX_INTERVAL_MINUTES);
    let active_days = read_active_days(value.get("activeDays"));
    let inactive_window = read_inactive_window(value);

    Some(SearchSchedule {
        active_days,
        extra_delay_minutes,
        inactive_window,
        interval_minutes,
    })
}

async fn read_schedulable_searches(pool: &PgPool) -> Result<Vec<ScheduledSearchRow>> {
    let rows = sqlx::query(
        r#"
            SELECT
              searches.id::text AS id,
              searches.name,
              searches.schedule_config,
              CASE
                WHEN searches.last_run_at IS NULL THEN NULL
                ELSE EXTRACT(EPOCH FROM (now() - searches.last_run_at))::bigint
              END AS elapsed_seconds
            FROM searches
            JOIN providers ON providers.id = searches.provider_id
            WHERE providers.provider_key = 'linkedin'
              AND providers.enabled = true
              AND searches.enabled = true
            ORDER BY searches.created_at ASC, searches.id ASC
            "#,
    )
    .fetch_all(pool)
    .await
    .context("read scheduled searches failed")?;

    rows.into_iter()
        .map(|row| {
            Ok(ScheduledSearchRow {
                elapsed_seconds: row.try_get("elapsed_seconds")?,
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                schedule_config: row.try_get("schedule_config")?,
            })
        })
        .collect()
}

async fn enqueue_linkedin_collection(pool: &PgPool, search: &ScheduledSearchRow) -> Result<bool> {
    let payload = json!({
        "providerKey": "linkedin",
        "scheduled": true,
        "searchId": search.id,
        "searchName": search.name,
    });
    let row = sqlx::query(
        r#"
        INSERT INTO activities(
          activity_type,
          status,
          subject_type,
          subject_id,
          phase,
          message,
          payload,
          progress_current,
          progress_total,
          source
        )
        SELECT
          'linkedin_collect',
          'queued',
          'search',
          $1::uuid,
          'queued',
          'LinkedIn collection queued by scheduler',
          $2::jsonb,
          0,
          NULL,
          'scheduler'
        WHERE pg_try_advisory_xact_lock(hashtext('joblens.scheduler'), hashtext($1))
          AND NOT EXISTS (
            SELECT 1
            FROM activities
            WHERE activity_type = 'linkedin_collect'
              AND subject_type = 'search'
              AND subject_id = $1::uuid
              AND status IN ('queued', 'running')
          )
        RETURNING id::text AS id
        "#,
    )
    .bind(&search.id)
    .bind(&payload)
    .fetch_optional(pool)
    .await
    .context("enqueue scheduled LinkedIn collection failed")?;

    if let Some(row) = row {
        let activity_id: String = row.try_get("id")?;
        insert_activity_log(
            pool,
            &activity_id,
            "info",
            "Queued scheduled LinkedIn collection",
            json!({
                "providerKey": "linkedin",
                "searchId": search.id,
                "source": "scheduler",
            }),
        )
        .await?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn read_bool(value: &Value, key: &str, fallback: bool) -> bool {
    value
        .get(key)
        .and_then(|item| item.as_bool().or_else(|| parse_bool(item.as_str()?)))
        .unwrap_or(fallback)
}

fn parse_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn read_i64(value: &Value, key: &str, fallback: i64) -> i64 {
    value
        .get(key)
        .and_then(|item| {
            item.as_i64()
                .or_else(|| item.as_f64().map(|number| number.round() as i64))
                .or_else(|| item.as_str()?.trim().parse::<i64>().ok())
        })
        .unwrap_or(fallback)
}

fn read_active_days(value: Option<&Value>) -> Vec<u8> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut days = items.iter().filter_map(read_day_index).collect::<Vec<_>>();
    days.sort_unstable();
    days.dedup();
    days
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

fn read_inactive_window(value: &Value) -> Option<MinuteWindow> {
    let window = value.get("inactiveWindow");
    let enabled = window
        .and_then(|item| item.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(true);

    if !enabled {
        return None;
    }

    let start = window
        .and_then(|item| item.get("startTime"))
        .or_else(|| value.get("inactiveStartTime"))
        .and_then(Value::as_str)
        .and_then(parse_time_minutes)?;
    let end = window
        .and_then(|item| item.get("endTime"))
        .or_else(|| value.get("inactiveEndTime"))
        .and_then(Value::as_str)
        .and_then(parse_time_minutes)?;

    (start != end).then_some(MinuteWindow {
        end_minute: end,
        start_minute: start,
    })
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

fn is_active_day(active_days: &[u8], weekday: Weekday) -> bool {
    active_days.is_empty() || active_days.contains(&weekday_index(weekday))
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

impl MinuteWindow {
    fn contains(self, minute: u16) -> bool {
        if self.start_minute < self.end_minute {
            minute >= self.start_minute && minute < self.end_minute
        } else {
            minute >= self.start_minute || minute < self.end_minute
        }
    }
}
