"""Model registry (Phase K).

Builds a canonical registry of models released in the last year from Epoch AI's
free, CC-BY datasets, plus their benchmark scores, and links existing news
clusters to a model as "in the news" coverage.

- Roster + specs:  notable_ai_models.csv (filtered to the last `model_roster_days`).
- Benchmarks:      benchmark_data.zip (Epoch Capabilities Index + core benchmarks).
- News linkage:    deterministic name matching against the registry (no LLM).

Every step is fault-isolated: an Epoch outage or a schema change logs a warning
and returns 0 so the pipeline run still completes. Data is attributed to Epoch AI
(CC BY) in the UI. No LLM and no paid API — $0 incremental cost.
"""

import csv
import io
import json
import re
import zipfile
from datetime import datetime, timedelta, timezone

import httpx
import psycopg
import structlog

from ..config import settings

log = structlog.get_logger()

_HTTP_TIMEOUT = 60.0

# Benchmark files we ingest from benchmark_data.zip → (display name, unit, score column).
# `%` benchmarks store a 0-1 fraction (the frontend renders ×100); `index` and `elo`
# store the raw value. Classic benchmarks (MMLU, GSM8K, HellaSwag) are intentionally
# excluded — Epoch has stopped scoring recent models on them (0 coverage in the last
# year). The set below is what actually has frontier/recent-model coverage.
_BENCHMARKS: dict[str, tuple[str, str, str]] = {
    # Epoch-run core (shared `mean_score` schema, 0-1 fraction)
    "epoch_capabilities_index.csv": ("Epoch Capabilities Index", "index", "ECI Score"),
    "gpqa_diamond.csv":             ("GPQA Diamond", "%", "mean_score"),
    "math_level_5.csv":             ("MATH Level 5", "%", "mean_score"),
    "frontiermath.csv":             ("FrontierMath", "%", "mean_score"),
    "swe_bench_verified.csv":       ("SWE-bench Verified", "%", "mean_score"),
    "otis_mock_aime_2024_2025.csv": ("AIME 2024/2025", "%", "mean_score"),
    "simpleqa_verified.csv":        ("SimpleQA Verified", "%", "mean_score"),
    "frontiermath_tier_4.csv":      ("FrontierMath Tier 4", "%", "mean_score"),
    # External leaderboards with strong recent-model coverage. `%` cols are 0-1
    # fractions (rendered ×100); `elo`/`min` store the raw value.
    "hle_external.csv":             ("Humanity's Last Exam", "%", "Accuracy"),
    "arc_agi_external.csv":         ("ARC-AGI", "%", "Score"),
    "arc_agi_2_external.csv":       ("ARC-AGI-2", "%", "Score"),
    "terminalbench_external.csv":   ("Terminal-Bench", "%", "Accuracy mean"),
    "simplebench_external.csv":     ("SimpleBench", "%", "Score (AVG@5)"),
    "weirdml_external.csv":         ("WeirdML", "%", "Accuracy"),
    "apex_agents_external.csv":     ("APEX", "%", "Pass@1 score"),
    "gso_external.csv":             ("GSO (code optimization)", "%", "Score OPT@1"),
    "gdpval_external.csv":          ("GDPval (win/tie rate)", "%", "Win + tie rate (%)"),
    "webdev_arena_external.csv":    ("WebDev Arena", "elo", "Arena Score"),
    "metr_time_horizons_external.csv": ("METR task horizon", "min", "Time horizon"),
}

# Family detection by keyword (substring on the alnum-collapsed name). Length >= 3
# keywords only, to avoid spurious 2-letter substring hits.
_FAMILIES: list[tuple[str, str]] = [
    ("gpt", "GPT"), ("claude", "Claude"), ("gemini", "Gemini"), ("gemma", "Gemma"),
    ("llama", "Llama"), ("qwen", "Qwen"), ("mixtral", "Mistral"), ("mistral", "Mistral"),
    ("grok", "Grok"), ("deepseek", "DeepSeek"), ("phi", "Phi"), ("nemotron", "Nemotron"),
    ("command", "Command"), ("kimi", "Kimi"), ("falcon", "Falcon"), ("pixtral", "Pixtral"),
    ("nova", "Nova"), ("minimax", "MiniMax"),
]

_EFFORT_RE = re.compile(r"_[a-z0-9]+$", re.IGNORECASE)
_EMBED_DATE_RE = re.compile(r"-?20\d\d-\d\d-\d\d")

_ECI_FILE = "epoch_capabilities_index.csv"


# ── Pure helpers (no network / no DB) ──────────────────────────────────────────

def normalize_key(name: str) -> str:
    """Collapse a model name/version to a join key.

    Strips a trailing reasoning-effort suffix (`_high`, `_max`) and any embedded
    ISO date, then keeps only lowercased alphanumerics — so a benchmark CSV's
    `Model version` ('gpt-5-mini-2025-08-07_high') joins to the roster's clean
    `Model` ('GPT-5 mini').
    """
    if not name:
        return ""
    s = _EFFORT_RE.sub("", name.strip())
    s = _EMBED_DATE_RE.sub("", s)
    return re.sub(r"[^a-z0-9]", "", s.lower())


def slugify(name: str) -> str:
    """URL-safe canonical id: 'Claude Opus 4.8' → 'claude-opus-4-8'."""
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "model"


def derive_family(name: str) -> str | None:
    """Best-effort model family label from the name, or None."""
    collapsed = re.sub(r"[^a-z0-9]", "", name.lower())
    for keyword, label in _FAMILIES:
        if keyword in collapsed:
            return label
    return None


def format_parameters(raw: str) -> str | None:
    """Epoch parameter count ('3000000000000.0') → human-readable ('3T', '70B')."""
    if not raw:
        return None
    try:
        n = float(raw)
    except ValueError:
        return None
    if n <= 0:
        return None
    for divisor, suffix in ((1e12, "T"), (1e9, "B"), (1e6, "M")):
        if n >= divisor:
            value = f"{n / divisor:.1f}".rstrip("0").rstrip(".")
            return f"{value}{suffix}"
    return str(int(n))


def coerce_open_weight(raw: str) -> bool | None:
    """Epoch 'Open model weights?' (Yes/No/'') → tri-state bool."""
    value = (raw or "").strip().lower()
    if value in ("yes", "true", "1"):
        return True
    if value in ("no", "false", "0"):
        return False
    return None


def accessibility_to_open_weight(access: str) -> bool | None:
    """Epoch 'Model accessibility' free text → tri-state open-weight bool."""
    a = (access or "").strip().lower()
    if not a:
        return None
    if "open weight" in a:
        return True
    if "api access" in a or "hosted" in a or "unreleased" in a:
        return False
    return None


def clean_description(text: str | None) -> str | None:
    """Tidy a model description for display.

    OpenRouter's public `/models` API truncates long descriptions to ~a couple
    of sentences with a trailing ellipsis ("…"/"..."). Rather than show a clause
    cut off mid-thought, trim the dangling fragment back to the last complete
    sentence so we only ever display whole sentences. Untruncated text is
    returned unchanged.
    """
    if not text:
        return None
    t = text.strip()
    if not t:
        return None
    if t.endswith("...") or t.endswith("…") or t.endswith(".."):
        body = t.rstrip(".… ").rstrip()
        cut = max(body.rfind(". "), body.rfind("! "), body.rfind("? "))
        if cut != -1:
            return body[: cut + 1]
        return f"{body}…" if body else None
    return t


def within_window(pub_date: str, days: int) -> bool:
    """True when an Epoch 'YYYY-MM-DD' publication date is within `days` of now."""
    try:
        d = datetime.strptime((pub_date or "")[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return d >= datetime.now(timezone.utc) - timedelta(days=days)


def parse_models_csv(text: str, days: int) -> list[dict]:
    """Parse notable_ai_models.csv → registry rows released within the window.

    Pure and unit-testable. Returns dicts keyed by `models` columns. Slug
    collisions within the batch are disambiguated with a numeric suffix.
    """
    out: list[dict] = []
    seen_slugs: dict[str, int] = {}
    for row in csv.DictReader(io.StringIO(text)):
        name = (row.get("Model") or "").strip()
        pub = (row.get("Publication date") or "").strip()
        if not name or not within_window(pub, days):
            continue
        slug = slugify(name)
        if slug in seen_slugs:
            seen_slugs[slug] += 1
            slug = f"{slug}-{seen_slugs[slug]}"
        else:
            seen_slugs[slug] = 1
        out.append({
            "slug": slug,
            "epoch_key": name,
            "name": name,
            "vendor": (row.get("Organization") or "").strip() or None,
            "family": derive_family(name),
            "released_at": pub[:10],
            "parameters": format_parameters(row.get("Parameters") or ""),
            "accessibility": (row.get("Model accessibility") or "").strip() or None,
            "is_open_weight": coerce_open_weight(row.get("Open model weights?") or ""),
            "description": clean_description(row.get("Description")),
            "primary_url": (row.get("Link") or "").strip() or None,
        })
    return out


def parse_eci_roster(raw: bytes, days: int) -> list[dict]:
    """Supplement the roster with ECI-scored models not in the notable CSV.

    Epoch's `notable_ai_models.csv` lags its benchmark hub, so major recent models
    (Gemini 3.5 Flash, Claude Opus 4.8, GPT-5.4 Mini, ...) are absent from it. The
    Epoch Capabilities Index file lists every model Epoch ranks, with a clean
    `Model name`, organization, release date and accessibility. One entry per model
    (effort variants collapse to one); `Unreleased` models are skipped. Pure and
    unit-testable: takes the benchmark zip bytes.
    """
    archive = zipfile.ZipFile(io.BytesIO(raw))
    if _ECI_FILE not in archive.namelist():
        return []
    out: list[dict] = []
    seen: set[str] = set()
    with archive.open(_ECI_FILE) as fh:
        reader = csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8", errors="replace"))
        for row in reader:
            name = (row.get("Model name") or "").strip()
            pub = (row.get("Release date") or "").strip()
            access = (row.get("Model accessibility") or "").strip()
            if not name or access == "Unreleased" or not within_window(pub, days):
                continue
            key = normalize_key(name)
            if not key or key in seen:
                continue
            seen.add(key)
            out.append({
                "slug": slugify(name),
                "epoch_key": name,
                "name": name,
                "vendor": (row.get("Organization") or "").strip() or None,
                "family": derive_family(name),
                "released_at": pub[:10],
                "parameters": None,
                "accessibility": access or None,
                "is_open_weight": accessibility_to_open_weight(access),
                "description": clean_description(row.get("Description")),
                "primary_url": None,
            })
    return out


_OR_VARIANT_RE = re.compile(r":(free|extended|beta|thinking|online|nitro|floor)$", re.IGNORECASE)


def openrouter_key(model_id: str) -> str:
    """Normalize an OpenRouter id ('google/gemini-3.5-flash:free') to a join key."""
    s = (model_id or "").split("/")[-1]
    s = _OR_VARIANT_RE.sub("", s)
    return normalize_key(s)


def _price_per_million(raw) -> float | None:
    """OpenRouter per-token price string → USD per 1M tokens, or None when 0/absent."""
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return round(value * 1_000_000, 4) if value > 0 else None


def _join_modalities(mods) -> str | None:
    if not isinstance(mods, list) or not mods:
        return None
    return ", ".join(str(x) for x in mods) or None


def split_or_name(raw: str | None) -> tuple[str | None, str | None]:
    """OpenRouter display name 'Anthropic: Claude Sonnet 5' → (vendor, name)."""
    if not raw:
        return None, None
    if ": " in raw:
        vendor, name = raw.split(": ", 1)
        return (vendor.strip() or None), (name.strip() or None)
    return None, (raw.strip() or None)


def openrouter_new_model_rows(catalog: dict, existing_keys: set[str], days: int) -> list[dict]:
    """OpenRouter catalog entries released within `days` and not already in the
    registry → new-model insert rows. Bounds the auto-create to genuinely fresh,
    Epoch-missing releases (not OpenRouter's whole back-catalogue). Pure/testable."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows: list[dict] = []
    seen_slugs: set[str] = set()
    for key, rec in catalog.items():
        if key in existing_keys:
            continue
        created = rec.get("created")
        if not isinstance(created, (int, float)):
            continue
        try:
            released = datetime.fromtimestamp(created, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            continue
        if released < cutoff:
            continue
        vendor, name = split_or_name(rec.get("name"))
        if not name:
            continue
        # Curation: keep this an LLM tracker. Skip image/audio-gen models (any
        # image output, or no text output), OpenRouter's own router meta-model,
        # and alias/serving variants ('-latest', '(Fast)', '(free)', '(preview)')
        # that duplicate a real model.
        out_mods = (rec.get("output_modalities") or "").lower()
        if "image" in out_mods or (out_mods and "text" not in out_mods):
            continue
        if (vendor or "").lower() == "openrouter":
            continue
        low = name.lower()
        if "latest" in low or "(fast)" in low or "(free)" in low or "(preview)" in low:
            continue
        slug = slugify(name)
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        rows.append({
            "slug": slug,
            "name": name,
            "vendor": vendor,
            "family": derive_family(name),
            "released_at": released.date().isoformat(),
            "openrouter_id": rec.get("openrouter_id"),
            "price_in": rec.get("price_in"),
            "price_out": rec.get("price_out"),
            "context_window": rec.get("context_window"),
            "input_modalities": rec.get("input_modalities"),
            "output_modalities": rec.get("output_modalities"),
            "description": rec.get("description"),
        })
    return rows


def parse_openrouter_models(data: list[dict]) -> dict[str, dict]:
    """OpenRouter `/models` data → {join_key: pricing/spec record}.

    Variants of one model (`:free`, provider forks) collapse to a single record,
    preferring the cheapest non-zero input price (the real cost, not a rate-limited
    free tier). Pure and unit-testable.
    """
    out: dict[str, dict] = {}
    for m in data:
        key = openrouter_key(m.get("id") or "")
        if not key:
            continue
        pricing = m.get("pricing") or {}
        arch = m.get("architecture") or {}
        rec = {
            "openrouter_id": m.get("id"),
            "name": m.get("name"),
            "created": m.get("created"),
            "price_in": _price_per_million(pricing.get("prompt")),
            "price_out": _price_per_million(pricing.get("completion")),
            "context_window": m.get("context_length") or None,
            "input_modalities": _join_modalities(arch.get("input_modalities")),
            "output_modalities": _join_modalities(arch.get("output_modalities")),
            "description": clean_description(m.get("description")),
        }
        prev = out.get(key)
        if prev is None or _cheaper_in(rec, prev):
            out[key] = rec
    return out


def _cheaper_in(a: dict, b: dict) -> bool:
    """True when record a has a (positive) input price that should replace b's."""
    pa, pb = a.get("price_in"), b.get("price_in")
    if pa is None:
        return False
    if pb is None:
        return True
    return pa < pb


# Artificial Analysis `evaluations` field → our benchmark (display name, unit).
# Scores arrive as 0–1 fractions, matching our '%' storage. The first three
# overlap Epoch (AA only fills them when Epoch is missing); the last four are
# AA-owned benchmarks we don't get from Epoch.
_AA_BENCHMARKS: dict[str, tuple[str, str]] = {
    "gpqa":          ("GPQA Diamond", "%"),
    "hle":           ("Humanity's Last Exam", "%"),
    "aime_25":       ("AIME 2024/2025", "%"),
    "tau2":          ("τ²-bench", "%"),
    "livecodebench": ("LiveCodeBench", "%"),
    "scicode":       ("SciCode", "%"),
    "mmlu_pro":      ("MMLU-Pro", "%"),
}
_AA_PAREN_RE = re.compile(r"\s*\([^)]*\)")


def aa_base_key(name: str) -> str:
    """AA model name → join key, stripping a reasoning-effort suffix like '(high)'
    so all variants of one model collapse to the registry's clean name."""
    return normalize_key(_AA_PAREN_RE.sub("", name or ""))


def parse_aa_models(data: list[dict]) -> dict[str, dict]:
    """AA `/data/llms/models` → {base_key: {our_benchmark: (score, unit)}}.

    Collapses reasoning-effort variants to the strongest (highest AA intelligence
    index), so one representative score per model. Pure and unit-testable.
    """
    best_ii: dict[str, float] = {}
    out: dict[str, dict] = {}
    for m in data:
        key = aa_base_key(m.get("name") or m.get("slug") or "")
        if not key:
            continue
        ev = m.get("evaluations") or {}
        ii = ev.get("artificial_analysis_intelligence_index")
        ii = float(ii) if isinstance(ii, (int, float)) else -1.0
        if key in best_ii and ii <= best_ii[key]:
            continue
        best_ii[key] = ii
        scores: dict[str, tuple[float, str]] = {}
        for field, (disp, unit) in _AA_BENCHMARKS.items():
            v = ev.get(field)
            if isinstance(v, (int, float)):
                scores[disp] = (float(v), unit)
        out[key] = scores
    return out


def build_version_alias(raw: bytes) -> dict[str, str]:
    """Map normalized benchmark `Model version` → normalized clean `Model name`.

    Built from the ECI file (the only one carrying both columns). Benchmark per-file
    CSVs key on messy `Model version` strings ('deepseek/deepseek-v3.2', 'grok-4-3')
    that don't normalize to the roster's clean `Model name` key ('DeepSeek-V3.2',
    'Grok 4.3 Beta'); this bridges them. Pure and unit-testable.
    """
    archive = zipfile.ZipFile(io.BytesIO(raw))
    if _ECI_FILE not in archive.namelist():
        return {}
    alias: dict[str, str] = {}
    with archive.open(_ECI_FILE) as fh:
        reader = csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8", errors="replace"))
        for row in reader:
            vkey = normalize_key(row.get("Model version") or "")
            nkey = normalize_key(row.get("Model name") or "")
            if vkey and nkey:
                alias[vkey] = nkey
    return alias


def parse_benchmark_zip(
    raw: bytes, known_keys: set[str], alias: dict[str, str] | None = None
) -> dict[tuple[str, str], tuple[float, str]]:
    """Parse benchmark_data.zip → best score per (model key, benchmark).

    Pure and unit-testable. `known_keys` are normalized registry keys; a benchmark
    row's `Model version` is canonicalized through `alias` (version→name, from
    `build_version_alias`) before matching, so provider-prefixed/suffixed versions
    still resolve to the right model. Effort variants collapse to the max score.
    """
    alias = alias or {}
    best: dict[tuple[str, str], tuple[float, str]] = {}
    archive = zipfile.ZipFile(io.BytesIO(raw))
    names = set(archive.namelist())
    for fname, (display, unit, score_col) in _BENCHMARKS.items():
        if fname not in names:
            continue
        with archive.open(fname) as fh:
            reader = csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8", errors="replace"))
            for row in reader:
                vkey = normalize_key(row.get("Model version") or "")
                nkey = alias.get(vkey, vkey)
                if not nkey or nkey not in known_keys:
                    continue
                try:
                    value = float((row.get(score_col) or "").strip())
                except ValueError:
                    continue
                key = (nkey, display)
                if key not in best or value > best[key][0]:
                    best[key] = (value, unit)
    return best


def build_alias_index(models: list[tuple[str, str]]) -> dict[str, str]:
    """From (model_id, name) rows → {alias_lower: model_id} for news matching."""
    aliases: dict[str, str] = {}
    for model_id, name in models:
        low = (name or "").strip().lower()
        if len(low) >= 4:
            aliases.setdefault(low, model_id)
    return aliases


def match_models(text: str, aliases: dict[str, str]) -> list[str]:
    """Return model_ids whose name appears in `text` (deterministic, no LLM)."""
    low = " ".join(text.lower().split())
    collapsed = re.sub(r"[^a-z0-9]", "", text.lower())
    found: dict[str, bool] = {}
    for alias, model_id in aliases.items():
        alias_collapsed = re.sub(r"[^a-z0-9]", "", alias)
        if alias in low or (len(alias_collapsed) >= 5 and alias_collapsed in collapsed):
            found[model_id] = True
    return list(found)


# ── Network fetch (fault-isolated) ─────────────────────────────────────────────

def _fetch(url: str, *, as_bytes: bool, headers: dict | None = None):
    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT, follow_redirects=True) as client:
            resp = client.get(url, headers=headers or {})
            resp.raise_for_status()
            return resp.content if as_bytes else resp.text
    except Exception as exc:
        log.warning("epoch.fetch_failed", url=url, error=str(exc))
        return None


# ── Pipeline steps ─────────────────────────────────────────────────────────────

def sync_models(conn: psycopg.Connection) -> int:
    """Upsert the last year's models into `models`.

    Roster = notable_ai_models.csv UNION the ECI-scored models missing from it
    (the notable list lags the benchmark hub; without the union, major models like
    Gemini 3.5 Flash / Claude Opus 4.8 never appear). Notable rows win on a name
    clash (richer metadata: parameters, source link).
    """
    text = _fetch(settings.epoch_models_url, as_bytes=False)
    if text is None:
        return 0

    rows = parse_models_csv(text, settings.model_roster_days)

    # Supplement with ECI-scored models not already present (keyed by clean name).
    zip_bytes = _fetch(settings.epoch_benchmark_url, as_bytes=True)
    if zip_bytes is not None:
        try:
            eci_rows = parse_eci_roster(zip_bytes, settings.model_roster_days)
        except Exception as exc:
            log.warning("models.eci_roster_failed", error=str(exc))
            eci_rows = []
        seen_names = {normalize_key(r["name"]) for r in rows}
        for er in eci_rows:
            key = normalize_key(er["name"])
            if key and key not in seen_names:
                seen_names.add(key)
                rows.append(er)

    if not rows:
        log.warning("models.sync_empty")
        return 0

    # De-duplicate slugs across the merged roster (notable + ECI may collide).
    seen_slugs: dict[str, int] = {}
    for r in rows:
        slug = r["slug"]
        if slug in seen_slugs:
            seen_slugs[slug] += 1
            r["slug"] = f"{slug}-{seen_slugs[slug]}"
        else:
            seen_slugs[slug] = 1

    count = 0
    for r in rows:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO models
                        (slug, epoch_key, name, vendor, family, released_at,
                         parameters, accessibility, is_open_weight, description, primary_url)
                    VALUES (%(slug)s, %(epoch_key)s, %(name)s, %(vendor)s, %(family)s, %(released_at)s,
                            %(parameters)s, %(accessibility)s, %(is_open_weight)s, %(description)s,
                            %(primary_url)s)
                    ON CONFLICT (epoch_key) DO UPDATE SET
                        name           = EXCLUDED.name,
                        vendor         = COALESCE(EXCLUDED.vendor, models.vendor),
                        family         = COALESCE(EXCLUDED.family, models.family),
                        released_at    = EXCLUDED.released_at,
                        parameters     = COALESCE(EXCLUDED.parameters, models.parameters),
                        accessibility  = COALESCE(EXCLUDED.accessibility, models.accessibility),
                        is_open_weight = COALESCE(EXCLUDED.is_open_weight, models.is_open_weight),
                        description    = COALESCE(EXCLUDED.description, models.description),
                        primary_url    = COALESCE(EXCLUDED.primary_url, models.primary_url),
                        updated_at     = NOW()
                    """,
                    r,
                )
            conn.commit()
            count += 1
        except psycopg.errors.UniqueViolation:
            conn.rollback()
            # The slug is taken. If it's an auto-created OpenRouter row (no
            # epoch_key yet), adopt it into Epoch — set the key + authoritative
            # metadata so future benchmark syncs attach. Otherwise it's a genuine
            # slug clash between two Epoch models; skip as before.
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE models SET
                            epoch_key      = %(epoch_key)s,
                            name           = %(name)s,
                            vendor         = COALESCE(%(vendor)s, vendor),
                            family         = COALESCE(%(family)s, family),
                            released_at    = %(released_at)s,
                            parameters     = COALESCE(%(parameters)s, parameters),
                            accessibility  = COALESCE(%(accessibility)s, accessibility),
                            is_open_weight = COALESCE(%(is_open_weight)s, is_open_weight),
                            description    = COALESCE(%(description)s, description),
                            primary_url    = COALESCE(%(primary_url)s, primary_url),
                            updated_at     = NOW()
                        WHERE slug = %(slug)s AND epoch_key IS NULL
                        """,
                        r,
                    )
                    adopted = cur.rowcount
                conn.commit()
                if adopted:
                    count += 1
                    log.info("models.adopted", slug=r["slug"], name=r["name"])
                else:
                    log.warning("models.slug_collision", slug=r["slug"], name=r["name"])
            except Exception as exc:
                conn.rollback()
                log.warning("models.adopt_failed", slug=r["slug"], error=str(exc))
        except Exception as exc:
            conn.rollback()
            log.warning("models.upsert_failed", name=r["name"], error=str(exc))

    log.info("models.synced", count=count)
    return count


def create_missing_models(conn: psycopg.Connection) -> int:
    """Seed registry rows for fresh OpenRouter models Epoch hasn't scored yet, so
    a release like Claude Sonnet 5 appears the day it ships. Epoch adopts the row
    (attaches its key + scores) once it publishes; AA fills benchmarks meanwhile."""
    raw = _fetch(settings.openrouter_models_url, as_bytes=False)
    if raw is None:
        return 0
    try:
        catalog = parse_openrouter_models(json.loads(raw).get("data", []))
    except Exception as exc:
        log.warning("models.create_parse_failed", error=str(exc))
        return 0
    if not catalog:
        return 0

    with conn.cursor() as cur:
        cur.execute("SELECT epoch_key, name, slug FROM models")
        existing = cur.fetchall()
    existing_keys = {normalize_key(k or n) for (k, n, _s) in existing}
    existing_slugs = {s for (_k, _n, s) in existing}

    rows = openrouter_new_model_rows(catalog, existing_keys, settings.openrouter_new_model_days)
    count = 0
    for r in rows:
        if r["slug"] in existing_slugs:
            continue
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO models
                        (slug, name, vendor, family, released_at, openrouter_id,
                         price_in, price_out, context_window, input_modalities,
                         output_modalities, description)
                    VALUES (%(slug)s, %(name)s, %(vendor)s, %(family)s, %(released_at)s,
                            %(openrouter_id)s, %(price_in)s, %(price_out)s, %(context_window)s,
                            %(input_modalities)s, %(output_modalities)s, %(description)s)
                    ON CONFLICT (slug) DO NOTHING
                    """,
                    r,
                )
            conn.commit()
            count += 1
        except Exception as exc:
            conn.rollback()
            log.warning("models.create_failed", slug=r.get("slug"), error=str(exc))
    log.info("models.created", count=count)
    return count


def sync_benchmarks(conn: psycopg.Connection) -> int:
    """Attach Epoch benchmark scores (ECI + core benchmarks) to registry models."""
    raw = _fetch(settings.epoch_benchmark_url, as_bytes=True)
    if raw is None:
        return 0

    with conn.cursor() as cur:
        cur.execute("SELECT id, epoch_key FROM models WHERE epoch_key IS NOT NULL")
        key_to_id = {normalize_key(k): mid for (mid, k) in cur.fetchall()}
    if not key_to_id:
        return 0

    try:
        alias = build_version_alias(raw)
        scores = parse_benchmark_zip(raw, set(key_to_id), alias)
    except Exception as exc:
        log.warning("benchmarks.parse_failed", error=str(exc))
        return 0

    count = 0
    for (nkey, benchmark), (score, unit) in scores.items():
        model_id = key_to_id.get(nkey)
        if model_id is None:
            continue
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO model_benchmarks (model_id, benchmark, score, unit, source)
                    VALUES (%s, %s, %s, %s, 'epoch')
                    ON CONFLICT (model_id, benchmark) DO UPDATE SET
                        score = EXCLUDED.score, unit = EXCLUDED.unit, source = 'epoch'
                    """,
                    (model_id, benchmark, score, unit),
                )
            conn.commit()
            count += 1
        except Exception as exc:
            conn.rollback()
            log.warning("benchmarks.upsert_failed", error=str(exc))

    log.info("benchmarks.synced", count=count)
    return count


def sync_pricing(conn: psycopg.Connection) -> int:
    """Attach pricing + specs from OpenRouter's public catalog to registry models."""
    raw = _fetch(settings.openrouter_models_url, as_bytes=False)
    if raw is None:
        return 0
    try:
        catalog = parse_openrouter_models(json.loads(raw).get("data", []))
    except Exception as exc:
        log.warning("pricing.parse_failed", error=str(exc))
        return 0
    if not catalog:
        return 0

    with conn.cursor() as cur:
        cur.execute("SELECT id, epoch_key, name FROM models")
        rows = cur.fetchall()

    count = 0
    for model_id, epoch_key, name in rows:
        rec = catalog.get(normalize_key(epoch_key or name))
        if rec is None:
            continue
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE models SET
                        openrouter_id     = %(openrouter_id)s,
                        price_in          = %(price_in)s,
                        price_out         = %(price_out)s,
                        context_window    = %(context_window)s,
                        input_modalities  = %(input_modalities)s,
                        output_modalities = %(output_modalities)s,
                        description       = COALESCE(%(description)s, models.description),
                        updated_at        = NOW()
                    WHERE id = %(id)s
                    """,
                    {**rec, "id": model_id},
                )
            conn.commit()
            count += 1
        except Exception as exc:
            conn.rollback()
            log.warning("pricing.update_failed", name=name, error=str(exc))

    log.info("pricing.synced", count=count)
    return count


def sync_aa_benchmarks(conn: psycopg.Connection) -> int:
    """Fill benchmark scores from Artificial Analysis's free API for models Epoch
    hasn't scored yet, plus the AA-owned benchmarks (τ²-bench, LiveCodeBench,
    SciCode, MMLU-Pro). Epoch stays authoritative: the source guard never lets AA
    overwrite an 'epoch' row. Skipped when no key is configured."""
    if not settings.aa_api_key:
        return 0
    raw = _fetch(settings.aa_api_url, as_bytes=False, headers={"x-api-key": settings.aa_api_key})
    if raw is None:
        return 0
    try:
        catalog = parse_aa_models(json.loads(raw).get("data", []))
    except Exception as exc:
        log.warning("aa.parse_failed", error=str(exc))
        return 0
    if not catalog:
        return 0

    with conn.cursor() as cur:
        cur.execute("SELECT id, epoch_key, name FROM models")
        rows = cur.fetchall()

    count = 0
    for model_id, epoch_key, name in rows:
        scores = catalog.get(normalize_key(epoch_key or name))
        if not scores:
            continue
        for benchmark, (score, unit) in scores.items():
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO model_benchmarks (model_id, benchmark, score, unit, source)
                        VALUES (%s, %s, %s, %s, 'aa')
                        ON CONFLICT (model_id, benchmark) DO UPDATE SET
                            score = EXCLUDED.score, unit = EXCLUDED.unit, source = 'aa'
                        WHERE model_benchmarks.source <> 'epoch'
                        """,
                        (model_id, benchmark, score, unit),
                    )
                conn.commit()
                count += 1
            except Exception as exc:
                conn.rollback()
                log.warning("aa.upsert_failed", error=str(exc))

    log.info("aa.synced", count=count)
    return count


def link_model_coverage(conn: psycopg.Connection) -> int:
    """Link recent model-releases clusters to a registry model by name match."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, name FROM models")
        aliases = build_alias_index([(str(mid), name) for (mid, name) in cur.fetchall()])
    if not aliases:
        return 0

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.headline, c.significance_score
            FROM clusters c
            WHERE c.category = 'model-releases'
              AND c.first_published_at >= now() - make_interval(days => %s)
              AND NOT EXISTS (SELECT 1 FROM model_clusters mc WHERE mc.cluster_id = c.id)
            """,
            (settings.model_roster_days,),
        )
        clusters = cur.fetchall()

    linked = 0
    for cluster_id, headline, significance in clusters:
        for model_id in match_models(headline or "", aliases):
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO model_clusters (model_id, cluster_id) VALUES (%s, %s) "
                    "ON CONFLICT DO NOTHING",
                    (model_id, cluster_id),
                )
                cur.execute(
                    "UPDATE models SET significance = GREATEST(significance, %s) WHERE id = %s",
                    (significance or 0, model_id),
                )
            linked += 1
        conn.commit()

    log.info("models.linked", links=linked)
    return linked
