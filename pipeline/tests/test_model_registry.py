import io
import zipfile
from datetime import datetime, timedelta, timezone

from ainews.processing.model_registry import (
    normalize_key,
    slugify,
    derive_family,
    format_parameters,
    coerce_open_weight,
    accessibility_to_open_weight,
    within_window,
    clean_description,
    parse_models_csv,
    parse_eci_roster,
    parse_benchmark_zip,
    build_version_alias,
    build_alias_index,
    match_models,
    openrouter_key,
    parse_openrouter_models,
    split_or_name,
    openrouter_new_model_rows,
    parse_aa_models,
    aa_base_key,
)


# ── normalize_key (the benchmark↔roster join key) ──────────────────────────────

def test_normalize_key_strips_effort_suffix():
    assert normalize_key("claude-opus-4-8_max") == "claudeopus48"
    assert normalize_key("gemini-3.5-flash_high") == "gemini35flash"


def test_normalize_key_strips_embedded_date():
    assert normalize_key("gpt-5-mini-2025-08-07_high") == "gpt5mini"


def test_normalize_key_matches_clean_roster_name():
    # roster "GPT-5 mini" and benchmark "gpt-5-mini-2025-08-07_high" must collide
    assert normalize_key("GPT-5 mini") == normalize_key("gpt-5-mini-2025-08-07_high")
    assert normalize_key("Qwen 3.7 Max") == normalize_key("qwen3.7-max")


def test_normalize_key_empty():
    assert normalize_key("") == ""


# ── slugify / derive_family / format_parameters / coerce_open_weight ───────────

def test_slugify():
    assert slugify("Claude Opus 4.8") == "claude-opus-4-8"
    assert slugify("GPT-5 mini") == "gpt-5-mini"
    assert slugify("") == "model"


def test_derive_family():
    assert derive_family("Claude Opus 4.8") == "Claude"
    assert derive_family("GPT-5 mini") == "GPT"
    assert derive_family("Gemini 3.5 Flash") == "Gemini"
    assert derive_family("Some Unknown Model") is None


def test_format_parameters():
    assert format_parameters("3000000000000.0") == "3T"
    assert format_parameters("70000000000") == "70B"
    assert format_parameters("540000000") == "540M"
    assert format_parameters("") is None
    assert format_parameters("not-a-number") is None
    assert format_parameters("0") is None


def test_coerce_open_weight():
    assert coerce_open_weight("Yes") is True
    assert coerce_open_weight("No") is False
    assert coerce_open_weight("") is None
    assert coerce_open_weight("unknown") is None


# ── within_window ──────────────────────────────────────────────────────────────

def test_within_window():
    recent = (datetime.now(timezone.utc) - timedelta(days=10)).strftime("%Y-%m-%d")
    old = (datetime.now(timezone.utc) - timedelta(days=400)).strftime("%Y-%m-%d")
    assert within_window(recent, 365) is True
    assert within_window(old, 365) is False
    assert within_window("", 365) is False
    assert within_window("garbage", 365) is False


# ── parse_models_csv ───────────────────────────────────────────────────────────

def _models_csv(rows: str) -> str:
    header = "Model,Publication date,Organization,Parameters,Link,Model accessibility,Open model weights?\n"
    return header + rows


def test_parse_models_csv_keeps_recent_and_maps_fields():
    recent = (datetime.now(timezone.utc) - timedelta(days=5)).strftime("%Y-%m-%d")
    text = _models_csv(
        f"Claude Opus 4.8,{recent},Anthropic,,https://x.test,API access,No\n"
    )
    rows = parse_models_csv(text, 365)
    assert len(rows) == 1
    r = rows[0]
    assert r["slug"] == "claude-opus-4-8"
    assert r["epoch_key"] == "Claude Opus 4.8"
    assert r["vendor"] == "Anthropic"
    assert r["family"] == "Claude"
    assert r["released_at"] == recent
    assert r["accessibility"] == "API access"
    assert r["is_open_weight"] is False


def test_parse_models_csv_drops_old_models():
    old = (datetime.now(timezone.utc) - timedelta(days=500)).strftime("%Y-%m-%d")
    text = _models_csv(f"Ancient Model,{old},OpenAI,,,,\n")
    assert parse_models_csv(text, 365) == []


def test_parse_models_csv_disambiguates_slug_collisions():
    recent = (datetime.now(timezone.utc) - timedelta(days=5)).strftime("%Y-%m-%d")
    text = _models_csv(
        f"GPT 5,{recent},OpenAI,,,,\n"
        f"GPT-5,{recent},OpenAI,,,,\n"
    )
    rows = parse_models_csv(text, 365)
    slugs = {r["slug"] for r in rows}
    assert len(slugs) == 2  # second 'gpt-5' became 'gpt-5-2'


# ── parse_benchmark_zip ────────────────────────────────────────────────────────

def _benchmark_zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def test_parse_benchmark_zip_joins_known_models_and_takes_max():
    gpqa = (
        "Model version,mean_score,Release date\n"
        "claude-opus-4-8_high,0.80,2026-05-28\n"
        "claude-opus-4-8_max,0.88,2026-05-28\n"   # higher effort variant wins
        "unknown-model_high,0.99,2026-01-01\n"    # not in registry → dropped
    )
    eci = (
        "Model version,ECI Score,Release date\n"
        "claude-opus-4-8_max,160.5,2026-05-28\n"
    )
    raw = _benchmark_zip({"gpqa_diamond.csv": gpqa, "epoch_capabilities_index.csv": eci})
    known = {normalize_key("Claude Opus 4.8")}

    scores = parse_benchmark_zip(raw, known)
    key = normalize_key("Claude Opus 4.8")
    assert scores[(key, "GPQA Diamond")] == (0.88, "%")
    assert scores[(key, "Epoch Capabilities Index")] == (160.5, "index")
    # unknown model excluded entirely
    assert all(k[0] == key for k in scores)


def test_build_version_alias_and_benchmark_join_via_alias():
    # ECI carries both Model version and clean Model name; build the bridge.
    eci = (
        "Model version,ECI Score,Release date,Organization,Country,Model accessibility,"
        "Training compute (FLOP),Confidence,Model name,Description,Display name\n"
        "deepseek/deepseek-v3.2,150,2025-12-01,DeepSeek,China,Open weights (unrestricted),,,DeepSeek-V3.2,,DeepSeek-V3.2\n"
    )
    raw = _benchmark_zip({"epoch_capabilities_index.csv": eci})
    alias = build_version_alias(raw)
    # version key resolves to the clean name key
    assert alias[normalize_key("deepseek/deepseek-v3.2")] == normalize_key("DeepSeek-V3.2")

    # a benchmark row keyed by the messy version still matches the roster name key
    gpqa = (
        "Model version,mean_score,Release date\n"
        "deepseek/deepseek-v3.2_high,0.77,2025-12-01\n"
    )
    raw2 = _benchmark_zip({"gpqa_diamond.csv": gpqa})
    known = {normalize_key("DeepSeek-V3.2")}
    scores = parse_benchmark_zip(raw2, known, alias)
    assert scores[(normalize_key("DeepSeek-V3.2"), "GPQA Diamond")] == (0.77, "%")


def test_parse_benchmark_zip_tolerates_missing_files_and_bad_rows():
    gpqa = (
        "Model version,mean_score,Release date\n"
        "claude-opus-4-8_max,not-a-number,2026-05-28\n"  # unparseable score skipped
    )
    raw = _benchmark_zip({"gpqa_diamond.csv": gpqa})
    scores = parse_benchmark_zip(raw, {normalize_key("Claude Opus 4.8")})
    assert scores == {}


# ── news linkage ───────────────────────────────────────────────────────────────

def test_build_alias_index_and_match():
    aliases = build_alias_index([("id-1", "Claude Opus 4.8"), ("id-2", "Gemini 3.5 Flash")])
    assert match_models("Anthropic ships Claude Opus 4.8 with longer context", aliases) == ["id-1"]
    assert set(match_models("Claude Opus 4.8 vs Gemini 3.5 Flash benchmarks", aliases)) == {"id-1", "id-2"}
    assert match_models("Unrelated AI funding news", aliases) == []


def test_build_alias_index_skips_short_names():
    aliases = build_alias_index([("id-1", "Yi")])  # too short to alias safely
    assert aliases == {}


def test_build_alias_index_matches_umbrella_stripped_short_name():
    # News says "Fable 5", not the registry's "Claude Fable 5"
    aliases = build_alias_index([("id-1", "Claude Fable 5")])
    assert match_models("Anthropic Says US Lifted Restrictions on Fable 5", aliases) == ["id-1"]
    # the full name still matches too
    assert match_models("Claude Fable 5 is back worldwide", aliases) == ["id-1"]


def test_build_alias_index_short_name_requires_a_version_digit():
    # bare family words must not become aliases (would match unrelated prose)
    aliases = build_alias_index([("id-1", "Claude Haiku")])
    assert "haiku" not in aliases
    assert match_models("She wrote a haiku about the sea", aliases) == []


# ── ECI roster supplement (models missing from the notable CSV) ────────────────

def test_accessibility_to_open_weight():
    assert accessibility_to_open_weight("Open weights (unrestricted)") is True
    assert accessibility_to_open_weight("Open weights (non-commercial)") is True
    assert accessibility_to_open_weight("API access") is False
    assert accessibility_to_open_weight("Hosted access (no API)") is False
    assert accessibility_to_open_weight("Unreleased") is False
    assert accessibility_to_open_weight("") is None


def _eci_zip(rows: str) -> bytes:
    header = (
        "Model version,ECI Score,Release date,Organization,Country,"
        "Model accessibility,Training compute (FLOP),Confidence,Model name,Description,Display name\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("epoch_capabilities_index.csv", header + rows)
    return buf.getvalue()


def test_parse_eci_roster_adds_clean_named_models():
    recent = (datetime.now(timezone.utc) - timedelta(days=20)).strftime("%Y-%m-%d")
    raw = _eci_zip(
        f"gemini-3.5-flash_high,150,{recent},Google,USA,,,,Gemini 3.5 Flash,,Gemini 3.5 Flash (high)\n"
        # effort variant of the same model collapses to one entry
        f"gemini-3.5-flash_minimal,140,{recent},Google,USA,,,,Gemini 3.5 Flash,,Gemini 3.5 Flash (minimal)\n"
    )
    rows = parse_eci_roster(raw, 365)
    assert len(rows) == 1
    r = rows[0]
    assert r["name"] == "Gemini 3.5 Flash"
    assert r["slug"] == "gemini-3-5-flash"
    assert r["vendor"] == "Google"
    assert r["family"] == "Gemini"


def test_parse_eci_roster_skips_unreleased_and_old():
    recent = (datetime.now(timezone.utc) - timedelta(days=20)).strftime("%Y-%m-%d")
    old = (datetime.now(timezone.utc) - timedelta(days=500)).strftime("%Y-%m-%d")
    raw = _eci_zip(
        f"secret-x,200,{recent},Lab,USA,Unreleased,,,Secret X,,Secret X\n"
        f"old-model,100,{old},Lab,USA,API access,,,Old Model,,Old Model\n"
    )
    assert parse_eci_roster(raw, 365) == []


def test_parse_eci_roster_derives_open_weight_from_accessibility():
    recent = (datetime.now(timezone.utc) - timedelta(days=20)).strftime("%Y-%m-%d")
    raw = _eci_zip(
        f"oss-1,120,{recent},Lab,China,Open weights (unrestricted),,,OSS One,,OSS One\n"
        f"api-1,130,{recent},Lab,USA,API access,,,API One,,API One\n"
    )
    by_name = {r["name"]: r for r in parse_eci_roster(raw, 365)}
    assert by_name["OSS One"]["is_open_weight"] is True
    assert by_name["API One"]["is_open_weight"] is False


# ── OpenRouter pricing (Phase O1) ──────────────────────────────────────────────

def test_openrouter_key_strips_provider_and_variant():
    assert openrouter_key("google/gemini-3.5-flash") == normalize_key("Gemini 3.5 Flash")
    assert openrouter_key("google/gemini-3.5-flash:free") == normalize_key("Gemini 3.5 Flash")
    assert openrouter_key("anthropic/claude-opus-4.8") == normalize_key("Claude Opus 4.8")


def test_parse_openrouter_models_converts_pricing_and_specs():
    data = [{
        "id": "google/gemini-3.5-flash",
        "pricing": {"prompt": "0.0000015", "completion": "0.000009"},
        "context_length": 1048576,
        "architecture": {"input_modalities": ["text", "image"], "output_modalities": ["text"]},
        "description": "  Gemini 3.5 Flash is Google's high-efficiency multimodal model.  ",
    }]
    catalog = parse_openrouter_models(data)
    rec = catalog[normalize_key("Gemini 3.5 Flash")]
    assert rec["price_in"] == 1.5    # $/M input
    assert rec["price_out"] == 9.0   # $/M output
    assert rec["context_window"] == 1048576
    assert rec["input_modalities"] == "text, image"
    assert rec["openrouter_id"] == "google/gemini-3.5-flash"
    assert rec["description"] == "Gemini 3.5 Flash is Google's high-efficiency multimodal model."


def test_parse_openrouter_models_missing_description_is_none():
    data = [{"id": "x/model", "pricing": {"prompt": "0.000001", "completion": "0"}}]
    rec = parse_openrouter_models(data)[normalize_key("model")]
    assert rec["description"] is None


def test_clean_description_trims_truncated_fragment():
    # OpenRouter cuts long descriptions mid-clause with a trailing "..."
    raw = (
        "Opus 4.8 is Anthropic's most capable model in the Opus family. "
        "It supports text, image, and file inputs with a 1M-token..."
    )
    assert clean_description(raw) == "Opus 4.8 is Anthropic's most capable model in the Opus family."


def test_clean_description_keeps_all_complete_sentences():
    assert clean_description("A is good. B is better. C is the...") == "A is good. B is better."


def test_clean_description_passthrough_and_empty():
    assert clean_description("A complete sentence.") == "A complete sentence."
    assert clean_description("   ") is None
    assert clean_description(None) is None


def test_parse_openrouter_models_zero_price_is_none():
    data = [{"id": "x/free-model", "pricing": {"prompt": "0", "completion": "0"}, "context_length": 8000}]
    rec = parse_openrouter_models(data)[normalize_key("free model")]
    assert rec["price_in"] is None and rec["price_out"] is None


def test_parse_openrouter_models_prefers_cheapest_nonzero_variant():
    data = [
        {"id": "x/model:free", "pricing": {"prompt": "0", "completion": "0"}},
        {"id": "x/model", "pricing": {"prompt": "0.000002", "completion": "0.000008"}},
        {"id": "y/model", "pricing": {"prompt": "0.000001", "completion": "0.000004"}},  # cheapest
    ]
    rec = parse_openrouter_models(data)[normalize_key("model")]
    assert rec["price_in"] == 1.0  # cheapest non-zero input price wins


# ── Phase O5: OpenRouter auto-create + AA benchmark ingest ──────────────────────

def _ts(days_ago: int) -> int:
    return int((datetime.now(timezone.utc) - timedelta(days=days_ago)).timestamp())


def test_split_or_name_separates_vendor():
    assert split_or_name("Anthropic: Claude Sonnet 5") == ("Anthropic", "Claude Sonnet 5")
    assert split_or_name("SomeModel") == (None, "SomeModel")
    assert split_or_name(None) == (None, None)


def test_openrouter_new_model_rows_recency_and_curation():
    catalog = {
        "fresh":  {"openrouter_id": "anthropic/claude-sonnet-5", "name": "Anthropic: Claude Sonnet 5",
                   "created": _ts(2), "price_in": 3.0, "context_window": 1000000, "output_modalities": "text"},
        "old":    {"openrouter_id": "x/old", "name": "X: Old Model", "created": _ts(400),
                   "output_modalities": "text"},
        "image":  {"openrouter_id": "g/banana", "name": "Google: Nano Banana", "created": _ts(1),
                   "output_modalities": "image, text"},
        "alias":  {"openrouter_id": "o/gpt-latest", "name": "OpenAI: GPT Chat Latest", "created": _ts(1),
                   "output_modalities": "text"},
        "router": {"openrouter_id": "openrouter/fusion", "name": "OpenRouter: Fusion", "created": _ts(1),
                   "output_modalities": "text"},
    }
    rows = openrouter_new_model_rows(catalog, existing_keys=set(), days=60)
    names = {r["name"] for r in rows}
    assert names == {"Claude Sonnet 5"}  # old/image/alias/router all filtered
    r = rows[0]
    assert r["slug"] == "claude-sonnet-5" and r["vendor"] == "Anthropic" and r["price_in"] == 3.0


def test_openrouter_new_model_rows_skips_existing():
    # Catalog is keyed by the normalized OpenRouter key (as parse_openrouter_models
    # produces), which matches normalize_key(name) for a model already in the registry.
    key = normalize_key("B Model")
    catalog = {key: {"openrouter_id": "a/b", "name": "A: B Model", "created": _ts(1), "output_modalities": "text"}}
    assert openrouter_new_model_rows(catalog, existing_keys={key}, days=60) == []


def test_aa_base_key_strips_effort_variant():
    assert aa_base_key("GPT-5.5 (high)") == aa_base_key("GPT-5.5 (low)") == normalize_key("GPT-5.5")


def test_parse_aa_models_maps_benchmarks_and_collapses_variants():
    data = [
        {"name": "GPT-5.5 (low)", "evaluations": {"artificial_analysis_intelligence_index": 40,
                                                   "gpqa": 0.80, "scicode": 0.40}},
        {"name": "GPT-5.5 (high)", "evaluations": {"artificial_analysis_intelligence_index": 53,
                                                    "gpqa": 0.93, "scicode": 0.56, "mmlu_pro": 0.89}},
    ]
    cat = parse_aa_models(data)
    key = normalize_key("GPT-5.5")
    assert key in cat
    # strongest variant (high, ii=53) wins
    assert cat[key]["GPQA Diamond"] == (0.93, "%")
    assert cat[key]["SciCode"] == (0.56, "%")
    assert cat[key]["MMLU-Pro"] == (0.89, "%")


def test_parse_aa_models_ignores_null_scores():
    data = [{"name": "M", "evaluations": {"gpqa": None, "hle": 0.4, "aime": None}}]
    cat = parse_aa_models(data)
    scores = cat[normalize_key("M")]
    assert "GPQA Diamond" not in scores and scores["Humanity's Last Exam"] == (0.4, "%")
