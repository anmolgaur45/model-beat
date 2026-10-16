from ainews.processing.normalize import (
    build_normalized_article,
    categorize,
    is_ai_relevant,
    is_english,
    is_financial_noise,
    is_github_rolling_build,
    is_market_report,
    normalize_excerpt,
    strip_html,
    truncate_words,
)
from ainews.sources import Source


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


class TestIsEnglish:
    def test_short_cjk_title_is_not_english(self):
        # 6 space-separated "words", so the short-text default used to keep it
        assert not is_english("Claude Haiku 5.5 对比 Sakana Namazu：通才还是专才？")
        assert not is_english("Stability AI 完成 7600 万美元 B 轮融资")

    def test_other_scripts(self):
        assert not is_english("Alibaba ने लॉन्च किया अब तक का सबसे बड़ा AI Model")

    def test_scattered_glyphs_stay_english(self):
        assert is_english("This Is the Worst Possible Time for OpenAI to BfЖ7!م#2猫$9&क")

    def test_short_english_and_accents_stay(self):
        assert is_english("Claude partial outage")
        assert is_english("Mistral AI, Luxembourg’s 10-million-euro bet with Café Société")


class TestIsMarketReport:
    def test_market_research_templates(self):
        assert is_market_report("Artificial Intelligence (AI) in Textile Market Size, Share, Trends and Forecast to 2030 at 33.6% CAGR")
        assert is_market_report("AI Fridge Market to Reach $6.27 Billion by 2030: Key Trends and Growth Drivers")
        assert is_market_report("AI Curtains Global Market Report 2026")
        assert is_market_report("Market Report on Artificial Intelligence (AI)-Driven Compliance Tools Analyzes Market Trends")

    def test_market_news_passes(self):
        assert not is_market_report("Foxconn third-quarter revenue soars on AI demand, beats market forecast")
        assert not is_market_report("AI Chipmaker Biren Taps Market Again in $515 Million Share Sale")
        assert not is_market_report("DeepSeek has 64% market share")


class TestBuildNormalizedArticle:
    def test_title_entities_are_decoded(self):
        # The Verge double-encodes, so feedparser hands over a literal entity
        src = Source("The Verge", "The Verge", "https://example.com/feed", "rss", 6, "company-news")
        a = build_normalized_article("Eight states sue OpenAI, saying ChatGPT isn&#8217;t safe for kids",
                                     "https://example.com/a", None, None, "2026-10-14T12:00:00+00:00", src)
        assert a.title == "Eight states sue OpenAI, saying ChatGPT isn’t safe for kids"
