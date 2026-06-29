mod availability;
mod collection;
mod description;
mod jobs;
mod request;
mod session;
mod text;
mod types;

pub(crate) use availability::run_availability_activity;
pub(crate) use collection::run_collect_activity;
pub(crate) use description::run_describe_activity;

#[cfg(test)]
pub(crate) use jobs::{extract_jobs_from_payload, extract_total_results};
#[cfg(test)]
pub(crate) use request::{build_linkedin_job_cards_url, build_linkedin_voyager_query};
#[cfg(test)]
pub(crate) use text::{description_content_hash, normalize_description_text, strip_html_to_text};
