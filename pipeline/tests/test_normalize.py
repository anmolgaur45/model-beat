from ainews.processing.normalize import (
    categorize,
    is_ai_relevant,
    is_financial_noise,
    is_github_rolling_build,
    normalize_excerpt,
    strip_html,
    truncate_words,
)


class TestIsFinancialNoise:
    def test_stock_article(self):
        assert is_financial_noise("Top AI stocks to buy hand over fist")

    def test_motley_fool(self):
        assert is_financial_noise("The Motley Fool: Best AI ETF picks")

    def test_billionaire_article(self):
        assert is_financial_noise("Billionaire hedge fund buys NVIDIA shares")

    def test_legitimate_news(self):
        assert not is_financial_noise("OpenAI releases GPT-5 model")

    def test_research_paper(self):
        assert not is_financial_noise("Scaling laws for neural language models")

    def test_case_insensitive(self):
        assert is_financial_noise("NVIDIA STOCK surges after earnings report")


class TestIsAiRelevant:
    def test_ai_standalone_word(self):
        assert is_ai_relevant("New AI model breaks benchmark", None)

    def test_openai_keyword(self):
        assert is_ai_relevant("OpenAI announces new product", None)

    def test_llm_keyword(self):
        assert is_ai_relevant("LLM inference gets 10x faster", None)

    def test_irrelevant_article(self):
        assert not is_ai_relevant("Fed raises interest rates again", None)

    def test_ai_in_email_avoided(self):
        # "email" contains "ai" but not as standalone word
        assert not is_ai_relevant("How to organize your email inbox", None)

    def test_body_fallback(self):
        assert is_ai_relevant("New product launch", "Uses large language model for inference")

    def test_model_name_in_title(self):
        assert is_ai_relevant("Claude 3 vs GPT-4 comparison", None)


class TestCategorize:
    def test_model_release(self):
        assert categorize("OpenAI launches new GPT model", None) == "model-releases"

    def test_research_paper(self):
        assert categorize("Arxiv paper on neural scaling laws", None) == "research-papers"

    def test_company_news(self):
        assert categorize("Anthropic raises $500 million in funding round", None) == "company-news"

    def test_hardware(self):
        assert categorize("NVIDIA H100 GPU supply increases", None) == "hardware-infrastructure"

    def test_open_source(self):
        # "open-source", "apache", "github" have no overlap with any higher-priority category
        assert categorize("Apache-licensed open-source library published on GitHub", None) == "open-source"

    def test_uncategorized_fallback(self):
        assert categorize("Something completely unrelated here", None) == "uncategorized"

    def test_body_fallback(self):
        result = categorize("Generic title", "This is a paper we present on benchmarks")
        assert result == "research-papers"


class TestStripHtml:
    def test_strips_tags(self):
        assert strip_html("<p>Hello <b>world</b></p>") == "Hello world"

    def test_plain_text_unchanged(self):
        assert strip_html("plain text") == "plain text"

    def test_collapses_whitespace(self):
        result = strip_html("<p>  too  \n  many   spaces  </p>")
        assert "  " not in result

    def test_nested_tags(self):
        assert strip_html("<div><span>inner</span></div>") == "inner"


class TestTruncateWords:
    def test_short_text_unchanged(self):
        text = "short text here"
        assert truncate_words(text, max_words=10) == text

    def test_truncates_long_text(self):
        text = " ".join(["word"] * 200)
        result = truncate_words(text, max_words=150)
        assert result.endswith("…")
        assert len(result.split()) == 150  # "…" is appended to the last word, not a separate token

    def test_exact_limit_unchanged(self):
        text = " ".join(["word"] * 150)
        assert truncate_words(text, max_words=150) == text


class TestNormalizeExcerpt:
    def test_strips_html_and_truncates(self):
        html = "<p>" + " ".join(["word"] * 200) + "</p>"
        result = normalize_excerpt(html)
        assert result is not None
        assert result.endswith("…")

    def test_none_input(self):
        assert normalize_excerpt(None) is None

    def test_empty_string(self):
        assert normalize_excerpt("") is None

    def test_short_plain_text(self):
        result = normalize_excerpt("Short excerpt here.")
        assert result == "Short excerpt here."


class TestIsGithubRollingBuild:
    def test_hex_hash_is_rolling(self):
        assert is_github_rolling_build("abc1234", None)

    def test_long_hex_hash(self):
        assert is_github_rolling_build("a1b2c3d4e5f6", None)

    def test_semver_is_release(self):
        assert not is_github_rolling_build("v1.2.3", None)

    def test_semver_without_v(self):
        assert not is_github_rolling_build("1.2.3", None)

    def test_b_prefix_is_rolling(self):
        assert is_github_rolling_build("b12345", None)

    def test_name_equals_tag_is_rolling(self):
        assert is_github_rolling_build("nightly", "nightly")

    def test_name_differs_from_tag(self):
        assert not is_github_rolling_build("nightly", "Release v2.0")
