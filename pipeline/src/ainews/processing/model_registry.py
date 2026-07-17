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
import time
import zipfile
from datetime import datetime, timedelta, timezone

import httpx
import psycopg
import structlog
from psycopg.types.json import Json

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


# Price moves under 5% are provider jitter (variant churn, rounding), not news.
_PRICE_EVENT_MIN_REL = 0.05


def pricing_change_events(name: str, old: dict, new: dict) -> list[dict]:
    """Diff a model's stored pricing/specs against fresh OpenRouter data into
    model_events rows (sans model_id). First-time attachment (stored value is
    None) is not a change. Pure and unit-testable."""
    events: list[dict] = []
    for field, label in (("price_in", "Input price"), ("price_out", "Output price")):
        o, n = old.get(field), new.get(field)
        if o is None or n is None or o <= 0:
            continue
        rel = (n - o) / o
        if abs(rel) < _PRICE_EVENT_MIN_REL:
            continue
        verb = "cut" if n < o else "raised"
        events.append({
            "event_type": "price",
            "summary": f"{name}: {label.lower()} {verb} from ${o:g} to ${n:g} per 1M tokens ({rel:+.0%})",
            "old_value": f"{o:g}",
            "new_value": f"{n:g}",
        })
    o, n = old.get("context_window"), new.get("context_window")
    if o and n and o != n:
        events.append({
            "event_type": "context",
            "summary": f"{name}: context window changed from {o:,} to {n:,} tokens",
            "old_value": str(o),
            "new_value": str(n),
        })
    return events


# ── Price tracking v2 (Phase U): per-provider endpoint data ────────────────────
#
# The model-level OpenRouter price is a blend of the third-party provider spread,
# so it swings with provider/quant/promo churn and produced a misleading digest
# line (GLM-5.2, 2026-07-09). /endpoints gives per-provider rows; from them we
# track two honest prices: the first-party vendor's list price (real news when it
# moves) and the cheapest CREDIBLE provider (the floor). See roadmap Phase U.

# Quants below 8-bit (fp4, int4, ...) are a different product at a different
# price; they must not set the floor. fp8/int8/fp16/bf16 and unlabeled rows pass.
_LOW_QUANT_RE = re.compile(r"^(?:fp|int)[1-7]$", re.IGNORECASE)

# Service-tier endpoints (seen live: tags `openai/flex`, `openai/priority`) are
# the same model at off-list prices for a different latency contract. They are
# neither the list price nor a comparable floor, so they are dropped entirely.
# Quant tag suffixes (`novita/fp8`) don't match this.
_SERVICE_TIER_RE = re.compile(r"/(?:flex|priority|batch|off-?peak|turbo)$", re.IGNORECASE)

# First-party brands whose OpenRouter author slug differs from the provider's
# company name ('qwen/...' models are served first-party by 'Alibaba').
_VENDOR_ALIASES = {"qwen": "alibaba"}

# An endpoint's context must be at least this fraction of the model's largest
# offered context to set the floor (the raw cheapest GLM-5.2 provider serves
# 101K of a 1M-token model — cheaper, but not the same product).
_FLOOR_MIN_CONTEXT_FRACTION = 0.5


def _norm_org(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def provider_matches_author(provider: str | None, author: str | None) -> bool:
    """True when an endpoint's provider is the model's first-party vendor.

    Compares alnum-collapsed forms with a prefix allowance so 'Z.AI' matches
    author slug 'z-ai' and 'Mistral' matches 'mistralai'. Min length 3 keeps
    junk prefixes from matching.
    """
    p, a = _norm_org(provider), _norm_org(author)
    a = _VENDOR_ALIASES.get(a, a)
    if len(p) < 3 or len(a) < 3:
        return False
    return p == a or p.startswith(a) or a.startswith(p)


def parse_endpoints(data: dict, author: str) -> dict:
    """OpenRouter `/models/{author}/{slug}/endpoints` payload → vendor + floor prices.

    Service-tier rows (tag suffix flex/priority/batch/...) are dropped first:
    same model, different latency contract, not the list price and not a
    comparable floor. Vendor = the first-party provider's endpoint (matched via
    `provider_matches_author`, brand aliases included); None when the vendor
    doesn't serve on OpenRouter (common for open-weight models). Status is
    ignored for the vendor (a temporarily deranked vendor endpoint still states
    the list price; requiring health made it flap) and the max-priced remaining
    vendor row wins as belt-and-braces against unlabeled discount tiers.
    Floor = min input price over the CREDIBLE set: healthy
    (`status >= 0`), undiscounted (`pricing.discount == 0`), quant >= 8-bit, and
    context >= 50% of the model's largest offered context. Explicit fast-variant
    exclusion is unnecessary: fast endpoints are the expensive duplicates, min
    never picks them. Pure and unit-testable.
    """
    rows = []
    for e in data.get("endpoints") or []:
        if _SERVICE_TIER_RE.search(e.get("tag") or ""):
            continue
        pricing = e.get("pricing") or {}
        price_in = _price_per_million(pricing.get("prompt"))
        if price_in is None:
            continue
        status = e.get("status")
        rows.append({
            "provider": e.get("provider_name"),
            "price_in": price_in,
            "price_out": _price_per_million(pricing.get("completion")),
            "discount": pricing.get("discount") or 0,
            "quant": (e.get("quantization") or "").strip() or None,
            "context": e.get("context_length") or None,
            "healthy": not isinstance(status, (int, float)) or status >= 0,
        })

    out = {
        "vendor_price_in": None, "vendor_price_out": None,
        "floor_price_in": None, "floor_price_out": None,
        "floor_provider": None, "floor_quant": None, "floor_context": None,
    }
    if not rows:
        return out

    vendor_rows = [r for r in rows if provider_matches_author(r["provider"], author)]
    if vendor_rows:
        v = max(vendor_rows, key=lambda r: r["price_in"])
        out["vendor_price_in"], out["vendor_price_out"] = v["price_in"], v["price_out"]

    native_context = max((r["context"] for r in rows if r["context"]), default=None)
    credible = [
        r for r in rows
        if r["healthy"]
        and not r["discount"]
        and not (r["quant"] and _LOW_QUANT_RE.match(r["quant"]))
        and not (native_context and r["context"]
                 and r["context"] < native_context * _FLOOR_MIN_CONTEXT_FRACTION)
    ]
    if credible:
        f = min(credible, key=lambda r: (r["price_in"], r["price_out"] or 0))
        out.update({
            "floor_price_in": f["price_in"], "floor_price_out": f["price_out"],
            "floor_provider": f["provider"], "floor_quant": f["quant"],
            "floor_context": f["context"],
        })
    return out


# field → (price_scope, token direction, exact compare). Vendor list prices are
# exact numbers, any move is real; the floor keeps the 5% jitter threshold.
_ENDPOINT_PRICE_FIELDS: dict[str, tuple[str, str, bool]] = {
    "vendor_price_in":  ("vendor", "input", True),
    "vendor_price_out": ("vendor", "output", True),
    "floor_price_in":   ("floor", "input", False),
    "floor_price_out":  ("floor", "output", False),
}


def _price_changed(old: float | None, new: float | None, exact: bool) -> bool:
    if old is None and new is None:
        return False
    if old is None or new is None:
        return True
    if exact:
        return abs(new - old) > 1e-9
    return old > 0 and abs((new - old) / old) >= _PRICE_EVENT_MIN_REL


def endpoint_change_events(
    name: str, stored: dict, fresh: dict, pending: dict
) -> tuple[list[dict], dict, dict]:
    """Debounced diff of stored vendor/floor prices against a fresh endpoint sample.

    A change (including a value appearing or disappearing) is written only when
    the SAME candidate value survives two consecutive samples; the first sighting
    just lands in the pending buffer. Events fire only for numeric→numeric moves
    (a provider delisting is not a reprice). Returns (model_events rows,
    confirmed column updates, new pending buffer). Pure and unit-testable.
    """
    events: list[dict] = []
    updates: dict = {}
    new_pending = dict(pending)
    floor_confirmed = False

    for field, (scope, direction, exact) in _ENDPOINT_PRICE_FIELDS.items():
        o, n = stored.get(field), fresh.get(field)
        if scope == "floor" and n is None and o is not None:
            # The credible set went empty (every row discounted/degraded), not a
            # price move. price_in/out doubles as the display price, so keep the
            # last-known value rather than blanking the model.
            new_pending.pop(field, None)
            continue
        if not _price_changed(o, n, exact):
            new_pending.pop(field, None)
            continue
        if field not in new_pending or new_pending[field] != n:
            # First sighting of this candidate (or the candidate moved again):
            # buffer it, change nothing. A single 3h/daily blip never fires.
            new_pending[field] = n
            continue
        # Second consecutive sample with the same value: confirmed.
        new_pending.pop(field)
        updates[field] = n
        if scope == "floor":
            floor_confirmed = True
        if o is None or n is None:
            continue
        rel = (n - o) / o
        if scope == "vendor":
            verb = "cut" if n < o else "raised"
            summary = (f"{name}: vendor list price {verb} from ${o:g} to ${n:g} "
                       f"per 1M {direction} tokens ({rel:+.0%})")
        else:
            via = f" via {fresh.get('floor_provider')}" if fresh.get("floor_provider") else ""
            summary = (f"{name}: cheapest credible provider{via} now ${n:g} "
                       f"per 1M {direction} tokens (was ${o:g}, {rel:+.0%})")
        events.append({
            "event_type": "price",
            "price_scope": scope,
            "summary": summary,
            "old_value": f"{o:g}",
            "new_value": f"{n:g}",
        })

    if floor_confirmed:
        # Keep the floor metadata in step with the confirmed floor price; between
        # confirmations it describes the last confirmed floor, not the pending one.
        updates["floor_provider"] = fresh.get("floor_provider")
        updates["floor_quant"] = fresh.get("floor_quant")
        updates["floor_context"] = fresh.get("floor_context")

    return events, updates, new_pending


# ── Benchmark history (Phase V) ────────────────────────────────────────────────
#
# sync_benchmarks used to overwrite scores with no diffing, the same original sin
# sync_pricing had before Phase U. Movement over time is only chartable if capture
# starts now; history cannot be backfilled. Same 5% relative threshold as prices.

def _fmt_score(value: float, unit: str) -> str:
    if unit == "%":
        return f"{value * 100:.1f}%"
    return f"{value:g}"


def _fmt_context(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}".rstrip("0").rstrip(".") + "M"
    if n >= 1_000:
        return f"{round(n / 1_000)}K"
    return str(n)


def benchmark_change_event(
    name: str, benchmark: str, old, new: float, unit: str, old_source: str, new_source: str
) -> dict | None:
    """One model_events row (sans model_id) for a meaningful benchmark move, else None.

    First attachment is not a change. A source change (aa -> epoch adoption) is a
    methodology change, not the model moving, so it never fires. Pure and testable.
    """
    if old is None or old <= 0 or (old_source or "epoch") != (new_source or "epoch"):
        return None
    rel = (new - old) / old
    if abs(rel) < _PRICE_EVENT_MIN_REL:
        return None
    verb = "improved" if new > old else "dropped"
    return {
        "event_type": "benchmark",
        "summary": (f"{name}: {benchmark} {verb} from {_fmt_score(old, unit)} "
                    f"to {_fmt_score(new, unit)} ({rel:+.0%})"),
        "old_value": f"{old:g}",
        "new_value": f"{new:g}",
    }


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


def parse_aa_speed(data: list[dict]) -> dict[str, tuple[float | None, float | None]]:
    """AA `/data/llms/models` → {base_key: (median tokens/sec, median TTFT s)}.

    Same strongest-variant collapse as parse_aa_models, so the speed row
    describes the same representative the benchmark scores do. A strongest
    variant reporting neither metric removes the key (the representative has
    no speed data; a weaker variant's numbers would misattribute). Pure and
    unit-testable.
    """
    best_ii: dict[str, float] = {}
    out: dict[str, tuple[float | None, float | None]] = {}
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
        tps = m.get("median_output_tokens_per_second")
        ttft = m.get("median_time_to_first_token_seconds")
        tps_f = float(tps) if isinstance(tps, (int, float)) else None
        ttft_f = float(ttft) if isinstance(ttft, (int, float)) else None
        if tps_f is None and ttft_f is None:
            out.pop(key, None)
            continue
        out[key] = (tps_f, ttft_f)
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


# Brand umbrellas the press routinely drops: "Claude Fable 5" is reported as
# "Fable 5". Gemini/GPT names carry no such redundant prefix (the first word IS
# the identity), so only these are stripped.
_ALIAS_UMBRELLA_PREFIXES = ("claude ",)


def build_alias_index(models: list[tuple[str, str]]) -> dict[str, str]:
    """From (model_id, name) rows → {alias_lower: model_id} for news matching.

    Registers the full name plus the umbrella-stripped short name news actually
    uses ("Claude Fable 5" → "Fable 5"). The short form is kept only when it is
    still specific — at least 4 chars and carrying a version digit — so bare
    family words ("Haiku", "Opus") can't match unrelated prose.
    """
    aliases: dict[str, str] = {}
    for model_id, name in models:
        low = (name or "").strip().lower()
        if len(low) >= 4:
            aliases.setdefault(low, model_id)
        for prefix in _ALIAS_UMBRELLA_PREFIXES:
            if low.startswith(prefix):
                short = low[len(prefix):].strip()
                if len(short) >= 4 and any(ch.isdigit() for ch in short):
                    aliases.setdefault(short, model_id)
    return aliases


def match_models(text: str, aliases: dict[str, str]) -> list[str]:
    """Return model_ids whose name appears in `text` (deterministic, no LLM).

    Matches require a version boundary: "GPT-5" must NOT match inside
    "GPT-5.6 Sol" and "Kimi K2" must not match "Kimi K2.5" — a bare substring
    check tagged every newer version's story with its ancestor (2026-07-17).
    """
    low = " ".join(text.lower().split())
    collapsed = re.sub(r"[^a-z0-9]", "", text.lower())
    found: dict[str, bool] = {}
    for alias, model_id in aliases.items():
        alias_collapsed = re.sub(r"[^a-z0-9]", "", alias)
        word_hit = re.search(
            r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9.\-])", low
        )
        collapsed_hit = len(alias_collapsed) >= 5 and re.search(
            re.escape(alias_collapsed) + r"(?![0-9])", collapsed
        )
        if word_hit or collapsed_hit:
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
                    RETURNING id
                    """,
                    r,
                )
                inserted = cur.fetchone()
                if inserted:
                    # Phase V: new-model tracking is itself feed-worthy (the digest's
                    # "New:" items and /models/changes read events uniformly).
                    lead = r["name"] + (f" ({r['vendor']})" if r.get("vendor") else "")
                    facts = []
                    if r.get("price_in") is not None and r.get("price_out") is not None:
                        facts.append(f"${r['price_in']:g}/${r['price_out']:g} per 1M")
                    if r.get("context_window"):
                        facts.append(f"{_fmt_context(r['context_window'])} context")
                    summary = f"{lead} added to the tracker" + (
                        f": {', '.join(facts)}." if facts else "."
                    )
                    cur.execute(
                        """
                        INSERT INTO model_events (model_id, event_type, summary, source_url)
                        VALUES (%s, 'catalog', %s, %s)
                        """,
                        (inserted[0], summary,
                         f"https://openrouter.ai/{r.get('openrouter_id') or ''}"),
                    )
            conn.commit()
            count += 1
        except Exception as exc:
            conn.rollback()
            log.warning("models.create_failed", slug=r.get("slug"), error=str(exc))
    log.info("models.created", count=count)
    return count


def _existing_benchmarks(conn: psycopg.Connection) -> dict[tuple, tuple]:
    """(model_id, benchmark) → (score, source) for the diff-before-overwrite pass."""
    with conn.cursor() as cur:
        cur.execute("SELECT model_id, benchmark, score, source FROM model_benchmarks")
        return {(str(mid), b): (s, src) for (mid, b, s, src) in cur.fetchall()}


def sync_benchmarks(conn: psycopg.Connection) -> int:
    """Attach Epoch benchmark scores (ECI + core benchmarks) to registry models.

    Phase V: diffs before overwriting and records meaningful score moves as
    model_events (the benchmark history capture; see benchmark_change_event).
    """
    raw = _fetch(settings.epoch_benchmark_url, as_bytes=True)
    if raw is None:
        return 0

    with conn.cursor() as cur:
        cur.execute("SELECT id, epoch_key, name FROM models WHERE epoch_key IS NOT NULL")
        rows = cur.fetchall()
    key_to_id = {normalize_key(k): str(mid) for (mid, k, _n) in rows}
    id_to_name = {str(mid): n for (mid, _k, n) in rows}
    if not key_to_id:
        return 0

    try:
        alias = build_version_alias(raw)
        scores = parse_benchmark_zip(raw, set(key_to_id), alias)
    except Exception as exc:
        log.warning("benchmarks.parse_failed", error=str(exc))
        return 0

    existing = _existing_benchmarks(conn)
    count = 0
    event_count = 0
    for (nkey, benchmark), (score, unit) in scores.items():
        model_id = key_to_id.get(nkey)
        if model_id is None:
            continue
        old_score, old_source = existing.get((model_id, benchmark), (None, "epoch"))
        event = benchmark_change_event(
            id_to_name.get(model_id, ""), benchmark, old_score, score, unit, old_source, "epoch"
        )
        try:
            with conn.cursor() as cur:
                if event:
                    cur.execute(
                        """
                        INSERT INTO model_events (model_id, event_type, summary,
                                                  old_value, new_value, source_url)
                        VALUES (%(model_id)s, %(event_type)s, %(summary)s,
                                %(old_value)s, %(new_value)s, 'https://epoch.ai/benchmarks')
                        """,
                        {**event, "model_id": model_id},
                    )
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
            event_count += 1 if event else 0
        except Exception as exc:
            conn.rollback()
            log.warning("benchmarks.upsert_failed", error=str(exc))

    log.info("benchmarks.synced", count=count, events=event_count)
    return count


def sync_pricing(conn: psycopg.Connection) -> int:
    """Attach specs + day-one pricing from OpenRouter's public catalog.

    Phase U single-writer rule: the catalog's model-level price is a noisy blend
    of the provider spread, so once a model has endpoint-derived prices
    (pending_prices IS NOT NULL, set by sync_endpoint_prices) this step stops
    writing its price columns — two writers on one column is exactly the
    oscillation bug this replaced. Price events now come ONLY from the endpoint
    sweep (debounced, vendor/floor scoped); this step still owns specs
    (context/modalities/description) and context-change events, and gives brand
    new models a base price until their first endpoint sweep.
    """
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
        cur.execute(
            """
            SELECT id, epoch_key, name, price_in, price_out, context_window,
                   (pending_prices IS NOT NULL) AS endpoint_managed
            FROM models
            """
        )
        rows = cur.fetchall()

    count = 0
    event_count = 0
    for model_id, epoch_key, name, old_in, old_out, old_ctx, endpoint_managed in rows:
        rec = catalog.get(normalize_key(epoch_key or name))
        if rec is None:
            continue
        events = [
            ev for ev in pricing_change_events(
                name, {"price_in": old_in, "price_out": old_out, "context_window": old_ctx}, rec
            )
            if ev["event_type"] != "price"
        ]
        try:
            with conn.cursor() as cur:
                # Diff before overwrite: the change record IS the product
                # (digest "model moves", model-page changelog), so it lands in
                # the same transaction as the update that would erase it.
                for ev in events:
                    cur.execute(
                        """
                        INSERT INTO model_events (model_id, event_type, summary,
                                                  old_value, new_value, source_url)
                        VALUES (%(model_id)s, %(event_type)s, %(summary)s,
                                %(old_value)s, %(new_value)s, %(source_url)s)
                        """,
                        {**ev, "model_id": model_id,
                         "source_url": f"https://openrouter.ai/{rec['openrouter_id']}"},
                    )
                price_sql = "" if endpoint_managed else """
                        price_in          = %(price_in)s,
                        price_out         = %(price_out)s,"""
                cur.execute(
                    f"""
                    UPDATE models SET
                        openrouter_id     = %(openrouter_id)s,{price_sql}
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
            event_count += len(events)
        except Exception as exc:
            conn.rollback()
            log.warning("pricing.update_failed", name=name, error=str(exc))

    log.info("pricing.synced", count=count, events=event_count)
    return count


# Confirmed endpoint_change_events updates → models columns (whitelist; the
# floor price lives in the existing price_in/out columns).
_ENDPOINT_UPDATE_COLS: dict[str, str] = {
    "vendor_price_in": "vendor_price_in",
    "vendor_price_out": "vendor_price_out",
    "floor_price_in": "price_in",
    "floor_price_out": "price_out",
    "floor_provider": "floor_provider",
    "floor_quant": "floor_quant",
    "floor_context": "floor_context",
}


def sync_endpoint_prices(conn: psycopg.Connection) -> int:
    """Phase U sweep: per-provider vendor + floor prices for a rolling subset.

    Each run takes the `endpoint_sweep_batch` oldest-synced models (NULLS FIRST,
    so new models go first) and fetches their /endpoints payload with a politeness
    delay. The cursor advances even on a failed fetch so a delisted model can't
    pin the rotation (its last-known prices are kept). First successful sync
    attaches values without events; after that, changes are debounced through
    pending_prices and fire vendor/floor-scoped model_events on confirmation.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, openrouter_id, price_in, price_out,
                   vendor_price_in, vendor_price_out, pending_prices
            FROM models
            WHERE openrouter_id IS NOT NULL
            ORDER BY endpoints_synced_at ASC NULLS FIRST
            LIMIT %s
            """,
            (settings.endpoint_sweep_batch,),
        )
        batch = cur.fetchall()

    synced = 0
    event_count = 0
    for i, (model_id, name, or_id, floor_in, floor_out, vend_in, vend_out, pending) in enumerate(batch):
        if i:
            time.sleep(settings.endpoint_sweep_delay_seconds)
        clean_id = _OR_VARIANT_RE.sub("", or_id or "")
        fresh = None
        raw = _fetch(settings.openrouter_endpoints_url.format(id=clean_id), as_bytes=False)
        if raw is not None:
            try:
                fresh = parse_endpoints(json.loads(raw).get("data") or {}, clean_id.split("/")[0])
            except Exception as exc:
                log.warning("endpoints.parse_failed", model=name, error=str(exc))
        try:
            with conn.cursor() as cur:
                if fresh is None:
                    cur.execute(
                        "UPDATE models SET endpoints_synced_at = NOW() WHERE id = %s",
                        (model_id,),
                    )
                elif pending is None:
                    # First endpoint sync: attach everything (the credible floor
                    # replaces the blended base price), no events — a first
                    # attachment is not a change. COALESCE keeps the base price
                    # when no credible floor exists yet.
                    cur.execute(
                        """
                        UPDATE models SET
                            vendor_price_in     = %(vendor_price_in)s,
                            vendor_price_out    = %(vendor_price_out)s,
                            price_in            = COALESCE(%(floor_price_in)s, price_in),
                            price_out           = COALESCE(%(floor_price_out)s, price_out),
                            floor_provider      = %(floor_provider)s,
                            floor_quant         = %(floor_quant)s,
                            floor_context       = %(floor_context)s,
                            pending_prices      = '{}'::jsonb,
                            endpoints_synced_at = NOW(),
                            updated_at          = NOW()
                        WHERE id = %(id)s
                        """,
                        {**fresh, "id": model_id},
                    )
                else:
                    stored = {
                        "vendor_price_in": vend_in, "vendor_price_out": vend_out,
                        "floor_price_in": floor_in, "floor_price_out": floor_out,
                    }
                    events, updates, new_pending = endpoint_change_events(name, stored, fresh, pending)
                    for ev in events:
                        cur.execute(
                            """
                            INSERT INTO model_events (model_id, event_type, price_scope,
                                                      summary, old_value, new_value, source_url)
                            VALUES (%(model_id)s, %(event_type)s, %(price_scope)s,
                                    %(summary)s, %(old_value)s, %(new_value)s, %(source_url)s)
                            """,
                            {**ev, "model_id": model_id,
                             "source_url": f"https://openrouter.ai/{clean_id}"},
                        )
                    set_parts = [f"{_ENDPOINT_UPDATE_COLS[k]} = %({k})s" for k in updates]
                    set_sql = ("".join(p + ", " for p in set_parts)) + (
                        "pending_prices = %(pending)s, endpoints_synced_at = NOW(), updated_at = NOW()"
                    )
                    cur.execute(
                        f"UPDATE models SET {set_sql} WHERE id = %(id)s",
                        {**updates, "pending": Json(new_pending), "id": model_id},
                    )
                    event_count += len(events)
            conn.commit()
            synced += 1
        except Exception as exc:
            conn.rollback()
            log.warning("endpoints.update_failed", model=name, error=str(exc))

    log.info("endpoints.synced", count=synced, events=event_count)
    return synced


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
        aa_data = json.loads(raw).get("data", [])
        catalog = parse_aa_models(aa_data)
        speed = parse_aa_speed(aa_data)
    except Exception as exc:
        log.warning("aa.parse_failed", error=str(exc))
        return 0
    if not catalog:
        return 0

    with conn.cursor() as cur:
        cur.execute("SELECT id, epoch_key, name FROM models")
        rows = cur.fetchall()

    existing = _existing_benchmarks(conn)
    count = 0
    event_count = 0
    for model_id, epoch_key, name in rows:
        scores = catalog.get(normalize_key(epoch_key or name))
        if not scores:
            continue
        for benchmark, (score, unit) in scores.items():
            old_score, old_source = existing.get((str(model_id), benchmark), (None, "aa"))
            # Diff only rows this upsert can actually change (the guard below
            # never overwrites an epoch row); the source-change skip inside the
            # helper covers the rest.
            event = benchmark_change_event(name, benchmark, old_score, score, unit, old_source, "aa")
            try:
                with conn.cursor() as cur:
                    if event:
                        cur.execute(
                            """
                            INSERT INTO model_events (model_id, event_type, summary,
                                                      old_value, new_value, source_url)
                            VALUES (%(model_id)s, %(event_type)s, %(summary)s,
                                    %(old_value)s, %(new_value)s,
                                    'https://artificialanalysis.ai/models')
                            """,
                            {**event, "model_id": model_id},
                        )
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
                event_count += 1 if event else 0
            except Exception as exc:
                conn.rollback()
                log.warning("aa.upsert_failed", error=str(exc))

    # Speed history: append the AA medians at most once per ~day per model
    # (recording started 2026-07-14 so "did speed shift with the price change"
    # is answerable once history accrues; AA refreshes these roughly daily,
    # so a tighter cadence would only record duplicates).
    speed_count = 0
    for model_id, epoch_key, name in rows:
        sp = speed.get(normalize_key(epoch_key or name))
        if not sp:
            continue
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO model_speed_history (model_id, tokens_per_second, ttft_seconds)
                    SELECT %(id)s, %(tps)s, %(ttft)s
                    WHERE NOT EXISTS (
                        SELECT 1 FROM model_speed_history
                        WHERE model_id = %(id)s AND captured_at > now() - interval '20 hours'
                    )
                    """,
                    {"id": model_id, "tps": sp[0], "ttft": sp[1]},
                )
                speed_count += cur.rowcount
            conn.commit()
        except Exception as exc:
            conn.rollback()
            log.warning("aa.speed_insert_failed", name=name, error=str(exc))

    log.info("aa.synced", count=count, events=event_count, speed_rows=speed_count)
    return count


def link_model_coverage(conn: psycopg.Connection) -> int:
    """Link recent clusters to a registry model by name match.

    Model-releases clusters link at any score. Other categories link only when
    significant (>= model_link_min_significance), so a tracked model's major
    non-launch news — a ban, an access or price change — reaches its page, while
    low-signal mentions and uncategorized noise stay off it. The headline
    name-match (match_models) is the precision gate in every case.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT id, name FROM models")
        aliases = build_alias_index([(str(mid), name) for (mid, name) in cur.fetchall()])
    if not aliases:
        return 0

    # Already-linked clusters are re-examined for their first 7 days: a launch
    # story breaks BEFORE the model exists in the registry (OpenRouter listing
    # lags the announcement), and the headline itself evolves as articles
    # accrete — the Kimi K3 launch cluster linked only Claude Opus 4.8 because
    # the once-only NOT EXISTS froze the link set on day one (2026-07-17).
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.id, c.headline, c.significance_score
            FROM clusters c
            WHERE c.first_published_at >= now() - make_interval(days => %s)
              AND c.category <> 'uncategorized'
              AND (c.category = 'model-releases'
                   OR c.significance_score >= %s)
              AND (c.first_published_at >= now() - interval '7 days'
                   OR NOT EXISTS (SELECT 1 FROM model_clusters mc WHERE mc.cluster_id = c.id))
            """,
            (settings.model_roster_days, settings.model_link_min_significance),
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
                if cur.rowcount:
                    cur.execute(
                        "UPDATE models SET significance = GREATEST(significance, %s) WHERE id = %s",
                        (significance or 0, model_id),
                    )
                    linked += 1
        conn.commit()

    log.info("models.linked", links=linked)
    return linked
