from dataclasses import dataclass
from typing import Literal


SourceType = Literal["rss", "hn", "github"]


@dataclass
class Source:
    name: str
    organization: str
    feed_url: str
    type: SourceType
    authority: int
    default_category: str
    ai_filter: bool = False


RSS_SOURCES: list[Source] = [
    # Tier 1 — AI lab primary blogs (authority 10)
    Source("OpenAI Blog", "OpenAI", "https://openai.com/news/rss.xml", "rss", 10, "model-releases"),
    Source(
        "Anthropic News", "Anthropic",
        "https://news.google.com/rss/search?q=site:anthropic.com/news+OR+site:anthropic.com/research&hl=en-US&gl=US&ceid=US:en",
        "rss", 10, "model-releases", ai_filter=True,
    ),
    Source("Google DeepMind Blog", "Google", "https://deepmind.google/blog/rss.xml", "rss", 10, "research-papers"),
    Source("Google AI Blog", "Google", "https://blog.google/technology/ai/rss/", "rss", 10, "product-launches"),
    Source(
        "Meta AI Blog", "Meta", "https://engineering.fb.com/feed/",
        "rss", 10, "research-papers", ai_filter=True,
    ),
    Source("Microsoft AI Blog", "Microsoft", "https://blogs.microsoft.com/ai/feed/", "rss", 10, "product-launches"),
    Source(
        "Mistral AI News", "Mistral",
        "https://news.google.com/rss/search?q=mistral+AI&hl=en-US&gl=US&ceid=US:en",
        "rss", 5, "model-releases", ai_filter=True,
    ),
    # Tier 2 — Major AI-specific media (authority 7)
    Source("NVIDIA AI Blog", "NVIDIA", "https://blogs.nvidia.com/feed/", "rss", 7, "hardware-infrastructure"),
    Source("Hugging Face Blog", "Hugging Face", "https://huggingface.co/blog/feed.xml", "rss", 7, "open-source"),
    Source("Apple Machine Learning Blog", "Apple", "https://machinelearning.apple.com/rss.xml", "rss", 7, "research-papers"),
    # Tier 3 — Tech press & research (authority 5)
    Source("arXiv CS.AI", "arXiv", "https://rss.arxiv.org/rss/cs.AI+cs.CL+cs.LG+cs.CV", "rss", 5, "research-papers"),
    Source("TechCrunch AI", "TechCrunch", "https://techcrunch.com/category/artificial-intelligence/feed/", "rss", 5, "company-news"),
    Source(
        "The Verge", "The Verge", "https://www.theverge.com/rss/index.xml",
        "rss", 5, "company-news", ai_filter=True,
    ),
    Source("VentureBeat AI", "VentureBeat", "https://venturebeat.com/category/ai/feed/", "rss", 5, "company-news"),
    # Tier 4 — Aggregators (authority 3)
    Source(
        "Google News: AI", "Google News",
        "https://news.google.com/rss/search?q=artificial+intelligence+AI&hl=en-US&gl=US&ceid=US:en",
        "rss", 3, "company-news",
    ),
    # International AI Labs
    Source(
        "DeepSeek News", "DeepSeek",
        "https://news.google.com/rss/search?q=DeepSeek+AI+model&hl=en-US&gl=US&ceid=US:en",
        "rss", 10, "model-releases", ai_filter=True,
    ),
    Source(
        "Qwen News", "Alibaba",
        "https://news.google.com/rss/search?q=Qwen+AI+OR+Alibaba+Qwen+model&hl=en-US&gl=US&ceid=US:en",
        "rss", 10, "model-releases", ai_filter=True,
    ),
    Source(
        "Zhipu AI News", "Zhipu AI",
        "https://news.google.com/rss/search?q=Zhipu+AI+GLM+OR+ChatGLM&hl=en-US&gl=US&ceid=US:en",
        "rss", 7, "model-releases", ai_filter=True,
    ),
    Source(
        "Moonshot AI News", "Moonshot AI",
        "https://news.google.com/rss/search?q=Moonshot+AI+Kimi&hl=en-US&gl=US&ceid=US:en",
        "rss", 7, "model-releases", ai_filter=True,
    ),
    Source(
        "Cohere News", "Cohere",
        "https://news.google.com/rss/search?q=Cohere+AI+Command&hl=en-US&gl=US&ceid=US:en",
        "rss", 7, "model-releases", ai_filter=True,
    ),
    Source(
        "Stability AI News", "Stability AI",
        "https://news.google.com/rss/search?q=Stability+AI+Stable+Diffusion&hl=en-US&gl=US&ceid=US:en",
        "rss", 7, "model-releases", ai_filter=True,
    ),
    Source(
        "Sakana AI News", "Sakana AI",
        "https://news.google.com/rss/search?q=Sakana+AI&hl=en-US&gl=US&ceid=US:en",
        "rss", 7, "research-papers", ai_filter=True,
    ),
    Source(
        "TII Falcon News", "TII",
        "https://news.google.com/rss/search?q=Technology+Innovation+Institute+Falcon+AI&hl=en-US&gl=US&ceid=US:en",
        "rss", 7, "model-releases", ai_filter=True,
    ),
    Source(
        "Reka AI News", "Reka AI",
        "https://news.google.com/rss/search?q=Reka+AI+model&hl=en-US&gl=US&ceid=US:en",
        "rss", 7, "model-releases", ai_filter=True,
    ),
    Source(
        "AI21 Labs News", "AI21 Labs",
        "https://news.google.com/rss/search?q=AI21+Labs+Jamba&hl=en-US&gl=US&ceid=US:en",
        "rss", 7, "model-releases", ai_filter=True,
    ),
    Source(
        "Sarvam AI News", "Sarvam AI",
        "https://news.google.com/rss/search?q=Sarvam+AI&hl=en-US&gl=US&ceid=US:en",
        "rss", 7, "model-releases", ai_filter=True,
    ),
    # AI Publications
    Source("The Decoder", "The Decoder", "https://the-decoder.com/feed/", "rss", 7, "company-news"),
    Source("Synced Review", "Synced Review", "https://syncedreview.com/feed/", "rss", 5, "research-papers"),
    Source(
        "MIT Technology Review", "MIT Technology Review",
        "https://www.technologyreview.com/feed/",
        "rss", 7, "research-papers", ai_filter=True,
    ),
    Source(
        "Ars Technica", "Ars Technica",
        "https://feeds.arstechnica.com/arstechnica/index",
        "rss", 5, "company-news", ai_filter=True,
    ),
    Source("Wired AI", "Wired", "https://www.wired.com/feed/tag/ai/latest/rss", "rss", 5, "company-news"),
    Source("IEEE Spectrum AI", "IEEE Spectrum", "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss", "rss", 5, "research-papers"),
    Source("The Register AI", "The Register", "https://www.theregister.com/software/ai_ml/headlines.atom", "rss", 5, "company-news"),
    Source(
        "Rest of World", "Rest of World",
        "https://restofworld.org/feed/latest",
        "rss", 5, "company-news", ai_filter=True,
    ),
    Source("MarkTechPost", "MarkTechPost", "https://www.marktechpost.com/feed", "rss", 5, "research-papers"),
    Source("InfoQ AI", "InfoQ", "https://feed.infoq.com/ai-ml-data-eng/", "rss", 5, "research-papers"),
    Source("Last Week in AI", "Last Week in AI", "https://lastweekin.ai/feed", "rss", 5, "company-news"),
    Source(
        "Bloomberg Technology", "Bloomberg",
        "https://feeds.bloomberg.com/technology/news.rss",
        "rss", 7, "company-news", ai_filter=True,
    ),
]

HN_SOURCE = Source(
    "Hacker News", "Hacker News",
    "https://hacker-news.firebaseio.com/v0",
    "hn", 3, "company-news",
)

# Only repos that actually cut GitHub releases; each of these shipped within the
# past week. A lab that publishes on Hugging Face instead is polled for nothing
# every run, which is why Qwen (Qwen3, Qwen2.5-VL and Qwen3-Coder have zero
# releases between them), deepseek-ai/DeepSeek-V3 (1 release, Jun 2025) and
# cohere-ai/cohere-toolkit (last Feb 2025) were dropped on 2026-09-11. Check the
# releases endpoint before adding one, and prefer the tool repo over the lab's.
GITHUB_REPOS: list[tuple[str, str]] = [
    ("huggingface", "transformers"),
    ("langchain-ai", "langchain"),
    ("vllm-project", "vllm"),
    ("ollama", "ollama"),
    ("ggml-org", "llama.cpp"),
]

GITHUB_SOURCE = Source(
    "GitHub Releases", "GitHub",
    "https://api.github.com",
    "github", 3, "open-source",
)

# Map source_name → organization for significance scoring
SOURCE_ORG_MAP: dict[str, str] = {
    s.name: s.organization for s in [*RSS_SOURCES, HN_SOURCE, GITHUB_SOURCE]
}


def get_organization(source_name: str) -> str:
    return SOURCE_ORG_MAP.get(source_name, source_name)
