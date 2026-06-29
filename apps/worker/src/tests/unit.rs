use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use serde_json::json;
use time::{Date, Month, OffsetDateTime, Time};

use super::*;

#[test]
fn health_response_reports_worker_status() {
    let state = TestAppState {
        database_configured: true,
        metrics: Arc::new(TestWorkerMetrics::default()),
        pool: None,
        run_loop: true,
        started_at: Instant::now(),
        version: "0.0.0",
        worker_id: "test-worker".to_string(),
    };

    let health = build_health_response(&state);

    assert_eq!(health.service, "worker");
    assert_eq!(health.status, "ok");
    assert!(health.database_configured);
    assert!(health.loop_enabled);
    assert_eq!(health.worker_id, "test-worker");
}

#[test]
fn duration_seconds_are_never_zero_for_leases() {
    assert_eq!(duration_as_i64_seconds(Duration::from_millis(1)), 1);
    assert_eq!(duration_as_i64_seconds(Duration::from_secs(5)), 5);
}

#[test]
fn divided_duration_is_never_zero() {
    assert_eq!(
        divided_duration(Duration::from_millis(10), 5),
        Duration::from_millis(2)
    );
    assert_eq!(
        divided_duration(Duration::from_millis(1), 5),
        Duration::from_millis(1)
    );
}

#[test]
fn dummy_steps_respect_minimum_and_heartbeat() {
    let mut config = test_config("test-worker");
    config.dummy_duration = Duration::from_secs(5);
    config.heartbeat_interval = Duration::from_millis(500);

    assert_eq!(dummy_activity_steps(&config), 10);

    config.heartbeat_interval = Duration::from_secs(5);
    assert_eq!(dummy_activity_steps(&config), DUMMY_ACTIVITY_STEPS);
}

#[test]
fn scheduled_search_respects_interval_delay_days_and_inactive_window() {
    let schedule = json!({
        "activeDays": [1],
        "enabled": true,
        "extraDelayMinutes": 15,
        "inactiveWindow": {
            "endTime": "06:00",
            "startTime": "22:00"
        },
        "intervalMinutes": 60
    });

    assert!(is_search_due(
        &schedule,
        Some(75 * 60),
        utc_datetime(2026, Month::June, 29, 12, 0),
    ));
    assert!(!is_search_due(
        &schedule,
        Some(74 * 60),
        utc_datetime(2026, Month::June, 29, 12, 0),
    ));
    assert!(!is_search_due(
        &schedule,
        Some(24 * 60 * 60),
        utc_datetime(2026, Month::June, 30, 12, 0),
    ));
    assert!(!is_search_due(
        &schedule,
        Some(24 * 60 * 60),
        utc_datetime(2026, Month::June, 29, 23, 0),
    ));
    assert!(!is_search_due(
        &schedule,
        Some(24 * 60 * 60),
        utc_datetime(2026, Month::June, 29, 5, 59),
    ));
}

#[test]
fn scheduled_search_is_disabled_by_default_and_supports_sunday_alias() {
    assert!(!is_search_due(
        &json!({}),
        None,
        utc_datetime(2026, Month::June, 28, 12, 0),
    ));
    assert!(is_search_due(
        &json!({
            "activeDays": [7],
            "enabled": true,
            "intervalMinutes": 10
        }),
        None,
        utc_datetime(2026, Month::June, 28, 12, 0),
    ));
}

#[test]
fn ai_pause_supports_cross_midnight_window() {
    let pauses = json!([
        {
            "dayOfWeek": 5,
            "enabled": true,
            "endTime": "02:00",
            "startTime": "22:00"
        }
    ]);

    assert!(is_ai_paused(
        &pauses,
        utc_datetime(2026, Month::July, 3, 23, 0),
    ));
    assert!(is_ai_paused(
        &pauses,
        utc_datetime(2026, Month::July, 4, 1, 59),
    ));
    assert!(!is_ai_paused(
        &pauses,
        utc_datetime(2026, Month::July, 4, 3, 0),
    ));
}

#[test]
fn ai_pause_ignores_disabled_windows() {
    assert!(!is_ai_paused(
        &json!([
            {
                "dayOfWeek": 1,
                "enabled": false,
                "endTime": "18:00",
                "startTime": "09:00"
            }
        ]),
        utc_datetime(2026, Month::June, 29, 12, 0),
    ));
}

#[test]
fn ai_runtime_parses_retry_settings() {
    let runtime = AiRuntime::from_value(&json!({
        "retryAttempts": 2,
        "retryDelaySeconds": 0
    }));

    assert_eq!(runtime.retry_attempts, 2);
    assert_eq!(runtime.retry_delay_seconds, 0);
}

#[test]
fn ai_fixture_completion_can_simulate_retry_success() {
    let payload = json!({
        "fixtureAiFailuresBeforeSuccess": 1,
        "fixtureAiOutput": {
            "response": "{\"decision\":\"apply\",\"score\":88}"
        }
    });

    assert!(
        read_ai_fixture_completion(&payload, 1)
            .expect("fixture should exist")
            .is_err()
    );
    let completion = read_ai_fixture_completion(&payload, 2)
        .expect("fixture should exist")
        .expect("second attempt should succeed");

    assert!(completion.raw_output.contains("\"decision\":\"apply\""));
}

#[test]
fn linkedin_query_maps_public_search_filters_to_voyager() {
    let query = json!({
        "currentJobId": null,
        "distance": "25",
        "exactMatch": true,
        "experienceLevels": ["1", "2", "3"],
        "geoId": "103350119",
        "keywords": "React Developer",
        "location": "Italy",
        "preservedParams": {
            "f_JT": "F",
            "f_TPR": "r86400"
        },
        "workplaceTypes": ["2", "3"],
    });
    let voyager = build_linkedin_voyager_query(&query).expect("query should build");

    assert!(voyager.contains("origin:JOB_SEARCH_PAGE_JOB_FILTER"));
    assert!(voyager.contains("keywords:\"React Developer\""));
    assert!(voyager.contains("locationUnion:(geoId:103350119)"));
    assert!(voyager.contains("distance:List(25)"));
    assert!(voyager.contains("experience:List(1,2,3)"));
    assert!(voyager.contains("workplaceType:List(2,3)"));
    assert!(voyager.contains("timePostedRange:List(r86400)"));
    assert!(voyager.contains("jobType:List(F)"));
}

fn utc_datetime(year: i32, month: Month, day: u8, hour: u8, minute: u8) -> OffsetDateTime {
    Date::from_calendar_date(year, month, day)
        .expect("valid test date")
        .with_time(Time::from_hms(hour, minute, 0).expect("valid test time"))
        .assume_utc()
}

#[test]
fn linkedin_job_cards_url_preserves_restli_query_syntax() {
    let voyager = "(origin:JOB_SEARCH_PAGE_JOB_FILTER,keywords:\"React Developer\",locationUnion:(geoId:103350119),selectedFilters:(distance:List(25),experience:List(1,2,3)),spellCorrectionEnabled:true)";
    let url = build_linkedin_job_cards_url(
        "com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollection-220",
        voyager,
        0,
        25,
    );

    assert!(url.contains("query=(origin:JOB_SEARCH_PAGE_JOB_FILTER,"));
    assert!(url.contains("keywords:%22React%20Developer%22"));
    assert!(url.contains("selectedFilters:(distance:List(25),experience:List(1,2,3))"));
    assert!(!url.contains("query=%28"));
}

#[test]
fn linkedin_payload_extracts_deduplicated_jobs() {
    let payload = json!({
        "data": {
            "paging": { "total": 2 },
            "elements": [
                {
                    "jobPostingId": "100",
                    "title": "Old title",
                    "companyName": "Acme"
                },
                {
                    "jobPostingId": "100",
                    "title": "New title",
                    "companyName": "Acme"
                },
                {
                    "entityUrn": "urn:li:fsd_jobPosting:101",
                    "title": { "text": "Backend Engineer" },
                    "companyName": "Beta"
                }
            ]
        }
    });
    let jobs = extract_jobs_from_payload(&payload);

    assert_eq!(extract_total_results(&payload), Some(2));
    assert_eq!(jobs.len(), 2);
    assert!(
        jobs.iter()
            .any(|job| job.external_id == "100" && job.title == "New title")
    );
    assert!(jobs.iter().any(|job| job.external_id == "101"));
}

#[test]
fn linkedin_payload_prefers_normalized_search_cards_over_auxiliary_records() {
    let payload = json!({
        "data": {
            "paging": { "total": 1 },
            "elements": [
                {
                    "$type": "com.linkedin.voyager.dash.jobs.JobCard",
                    "jobCardUnion": {
                        "*jobPostingCard": "urn:li:fsd_jobPostingCard:(4369648557,JOBS_SEARCH)"
                    }
                }
            ]
        },
        "included": [
            {
                "$type": "com.linkedin.voyager.dash.jobs.InfoPromptAction",
                "entityUrn": "urn:li:fsd_talentMarketplacePromotedEntity:(urn:li:jobPosting:4369648557,JOB_SEARCH)"
            },
            {
                "$type": "com.linkedin.voyager.dash.jobs.JobPosting",
                "entityUrn": "urn:li:fsd_jobPosting:4369648557",
                "title": "Platform Engineer"
            },
            {
                "$type": "com.linkedin.voyager.dash.jobs.JobPostingCard",
                "entityUrn": "urn:li:fsd_jobPostingCard:(4369648557,JOBS_SEARCH)",
                "jobPostingTitle": "Platform Engineer",
                "jobPostingUrn": "urn:li:fsd_jobPosting:4369648557",
                "primaryDescription": { "text": "MC Engineering" },
                "secondaryDescription": { "text": "Torino, Piemonte, Italia (Ibrido)" },
                "footerItems": [
                    { "type": "PROMOTED", "text": { "text": "Promosso" } },
                    { "type": "LISTED_DATE", "timeAt": 1781436110000_i64 }
                ]
            }
        ]
    });
    let jobs = extract_jobs_from_payload(&payload);

    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].external_id, "4369648557");
    assert_eq!(jobs[0].title, "Platform Engineer");
    assert_eq!(jobs[0].company_name, "MC Engineering");
    assert_eq!(
        jobs[0].location_text.as_deref(),
        Some("Torino, Piemonte, Italia (Ibrido)")
    );
    assert_eq!(jobs[0].workplace_type.as_deref(), Some("Ibrido"));
    assert_eq!(jobs[0].published_at_ms, Some(1781436110000));
}

#[test]
fn linkedin_payload_ignores_collection_response_container() {
    // The real CollectionResponse carries the search keywords as text and an
    // entityUrn with digits; without $type gating it produced a phantom job.
    let payload = json!({
        "data": {
            "$type": "com.linkedin.restli.common.CollectionResponse",
            "entityUrn": "urn:li:fsd_jobSearch:(keywords:junior,count:9)",
            "metadata": { "title": "junior software engineer qui: Torino, Piemonte" },
            "paging": { "total": 1 },
            "elements": []
        },
        "included": [
            {
                "$type": "com.linkedin.voyager.dash.jobs.JobPostingCard",
                "entityUrn": "urn:li:fsd_jobPostingCard:(4369648557,JOBS_SEARCH)",
                "jobPostingTitle": "Platform Engineer",
                "jobPostingUrn": "urn:li:fsd_jobPosting:4369648557",
                "primaryDescription": { "text": "MC Engineering" },
                "secondaryDescription": { "text": "Torino, Piemonte, Italia (Ibrido)" }
            }
        ]
    });
    let jobs = extract_jobs_from_payload(&payload);

    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].company_name, "MC Engineering");
    assert!(!jobs.iter().any(|job| job.company_name == "Unknown company"));
}

#[test]
fn description_hash_deduplicates_equivalent_text() {
    let first = normalize_description_text(" Senior  Rust\nEngineer ");
    let second = normalize_description_text("senior rust engineer");

    assert_eq!(first, "Senior Rust Engineer");
    assert_eq!(
        description_content_hash(&first),
        description_content_hash(&second)
    );
    assert_eq!(
        normalize_description_text(&strip_html_to_text("<p>Senior&nbsp;Rust &amp; React</p>")),
        "Senior Rust & React"
    );
}
