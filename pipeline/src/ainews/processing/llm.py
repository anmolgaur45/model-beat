"""Shared Vertex Gemini text call for the pipeline's small LLM tasks.

Impact scoring and merge adjudication ran on Claude Haiku via the Anthropic
API until 2026-07-05, when the account's credit balance silently emptied and
both features failed closed for five days. They now share the summaries'
Vertex path (Gemini on ADC, bills to GCP) so the pipeline has exactly one
LLM bill and one auth mechanism. Callers keep their fail-closed semantics:
any error here logs and returns None.
"""

import structlog

from ..config import settings

log = structlog.get_logger()

_client = None

# The global endpoint answers 429 RESOURCE_EXHAUSTED when shared capacity is
# briefly saturated (~10 a week as of 2026-09-25). With no retry, each one cost a
# summary three hours or a whole run's merge decisions, since the adjudicator
# fails closed. Transient statuses now retry with backoff (about 2s then 4s);
# rejected requests are not billed.
_RETRY = {
    "attempts": 3,
    "initial_delay": 2.0,
    "max_delay": 10.0,
    "http_status_codes": [408, 429, 500, 502, 503, 504],
}


def vertex_client():
    """The pipeline's single Vertex client (lazy, cached), with transient retry."""
    global _client
    if _client is None:
        # Imported lazily so the package imports cleanly where google-genai
        # isn't installed.
        from google import genai
        from google.genai import types

        _client = genai.Client(
            vertexai=True,
            project=settings.vertex_project,
            location=settings.vertex_location,
            http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(**_RETRY)),
        )
    return _client


def gemini_text(prompt: str) -> str | None:
    """One Vertex Gemini completion; None when unconfigured or on any error."""
    if not settings.vertex_project:
        return None
    try:
        response = vertex_client().models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
        )
        if not response.text:
            # Empty text is not an exception, so it used to vanish without a
            # trace: 58 of 65 failed scoring batches in one week had no logged
            # cause. The block reason is what named the culprit on 2026-09-25, a
            # prompt BLOCKLIST hit on one headline that emptied its whole batch.
            candidate = (response.candidates or [None])[0]
            log.warning(
                "llm.empty_response",
                block_reason=str(getattr(response.prompt_feedback, "block_reason", None)),
                finish_reason=str(getattr(candidate, "finish_reason", None)),
            )
            return None
        return response.text
    except Exception as exc:
        log.warning("llm.generate_failed", error=str(exc))
        return None
