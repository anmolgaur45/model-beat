from ainews.processing.summarize import build_prompt, clean_summary


def test_build_prompt_includes_headline_and_excerpts():
    prompt = build_prompt(
        "OpenAI ships GPT-6",
        [("OpenAI Blog", "OpenAI announced GPT-6 today with longer context."),
         ("The Verge", "Coverage of the GPT-6 launch.")],
        8,
    )
    assert "OpenAI ships GPT-6" in prompt
    assert "[OpenAI Blog]" in prompt
    assert "[The Verge]" in prompt
    assert "max 90 words" in prompt
    assert "Significance: 8/10" in prompt


def test_build_prompt_caps_member_count():
    members = [(f"Source {i}", f"excerpt {i}") for i in range(6)]
    prompt = build_prompt("Headline", members, 5)
    # only the first 3 members are included
    assert "[Source 0]" in prompt and "[Source 2]" in prompt
    assert "[Source 3]" not in prompt


def test_build_prompt_handles_missing_excerpt():
    prompt = build_prompt("Headline", [("Reuters", None)], 4)
    assert "[Reuters]" in prompt


def test_build_prompt_no_members():
    prompt = build_prompt("Headline", [], 4)
    assert "(no excerpts available)" in prompt


def test_clean_summary_strips_and_collapses_whitespace():
    assert clean_summary("  Hello   world\n\n ") == "Hello world"


def test_clean_summary_empty_returns_empty():
    assert clean_summary("") == ""
    assert clean_summary("   ") == ""


def test_clean_summary_drops_leading_label():
    assert clean_summary("Summary: A new model launched.") == "A new model launched."
    assert clean_summary("TL;DR - chips got faster.") == "chips got faster."


def test_clean_summary_strips_markdown_fences():
    assert clean_summary("`A short summary.`") == "A short summary."


def test_clean_summary_caps_word_count():
    long_text = " ".join(["word"] * 120)
    out = clean_summary(long_text)
    assert out.endswith("…")
    assert len(out.split(" ")) == 90  # capped at 90 words; ellipsis attaches to the last
