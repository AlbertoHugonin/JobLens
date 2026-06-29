use sha2::{Digest, Sha256};

pub(crate) fn normalize_description_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn description_content_hash(normalized_text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(normalized_text.to_lowercase().as_bytes());
    format!("{:x}", hasher.finalize())
}

pub(crate) fn strip_html_to_text(value: &str) -> String {
    // Drop blocks whose *content* is not human text, otherwise stripping only the
    // tags would leak JavaScript/CSS into the description (the "code instead of
    // text" problem). Then remove the remaining tags.
    let cleaned = remove_html_block(value, "<script", "</script>");
    let cleaned = remove_html_block(&cleaned, "<style", "</style>");
    let cleaned = remove_html_block(&cleaned, "<!--", "-->");

    let mut text = String::with_capacity(cleaned.len());
    let mut in_tag = false;

    for character in cleaned.chars() {
        match character {
            '<' => {
                in_tag = true;
                text.push(' ');
            }
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }

    decode_basic_html_entities(&text)
}

/// ASCII case-insensitive substring search over byte indices of `haystack`.
fn find_ascii_ci(haystack: &str, needle: &str, from: usize) -> Option<usize> {
    let hay = haystack.as_bytes();
    let pat = needle.as_bytes();
    if pat.is_empty() || from > hay.len() || hay.len() - from < pat.len() {
        return None;
    }

    (from..=hay.len() - pat.len())
        .find(|&start| hay[start..start + pat.len()].eq_ignore_ascii_case(pat))
}

/// Remove every `open .. close` block (delimiters included). Both delimiters are
/// ASCII, so byte indices stay on char boundaries.
fn remove_html_block(value: &str, open: &str, close: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut index = 0;

    while let Some(start) = find_ascii_ci(value, open, index) {
        output.push_str(&value[index..start]);
        match find_ascii_ci(value, close, start + open.len()) {
            Some(end) => index = end + close.len(),
            None => return output,
        }
    }

    output.push_str(&value[index..]);
    output
}

fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_script_and_style_content_keeping_text() {
        let html = r#"
            <style>.a{color:red}</style>
            <div>Vero testo dell'offerta</div>
            <script>var x = 1; document.write("boom");</script>
            <!-- commento da scartare -->
            <p>Secondo paragrafo &amp; altro</p>
        "#;
        let text = normalize_description_text(&strip_html_to_text(html));

        assert!(text.contains("Vero testo dell'offerta"));
        assert!(text.contains("Secondo paragrafo & altro"));
        assert!(!text.contains("color:red"));
        assert!(!text.contains("document.write"));
        assert!(!text.contains("var x"));
        assert!(!text.contains("commento"));
    }
}
