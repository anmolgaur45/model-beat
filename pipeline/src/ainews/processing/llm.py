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


def gemini_text(prompt: str) -> str | None:
    """One Vertex Gemini completion; None when unconfigured or on any error."""
    global _client
    if not settings.vertex_project:
        return None
    try:
        if _client is None:
            # Imported lazily so the package imports cleanly where google-genai
            # isn't installed (mirrors summarize.py).
            from google import genai

            _client = genai.Client(
                vertexai=True,
                project=settings.vertex_project,
                location=settings.vertex_location,
            )
        response = _client.models.generate_content(
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
