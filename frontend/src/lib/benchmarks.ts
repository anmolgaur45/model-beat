// One-time reference metadata for the benchmarks Epoch AI tracks. Most readers
// don't know what each eval measures, so every benchmark carries a short `blurb`
// (the one-line label on a card) and a longer `desc` (the hover tooltip), plus
// who runs it, its domain, and a source link. Keys must match the `benchmark`
// display names stored in model_benchmarks (see pipeline `_BENCHMARKS`).

export type BenchGroup = 'overall' | 'coding' | 'math' | 'reasoning' | 'agentic'

export interface BenchmarkMeta {
  group: BenchGroup
  blurb: string // short one-liner shown on the card
  desc: string // full description shown in the tooltip
  evaluator?: string
  domain?: string
  url?: string
}

export const GROUP_LABELS: Record<Exclude<BenchGroup, 'overall'>, string> = {
  reasoning: 'Reasoning',
  coding: 'Coding',
  math: 'Math',
  agentic: 'Agentic & Tools',
}

// Order the benchmark groups render in.
export const GROUP_ORDER: Exclude<BenchGroup, 'overall'>[] = ['reasoning', 'coding', 'math', 'agentic']

export const BENCHMARK_META: Record<string, BenchmarkMeta> = {
  'Epoch Capabilities Index': {
    group: 'overall',
    blurb: 'Composite intelligence score',
    desc: "Epoch AI's composite intelligence score, aggregating a model's performance across many benchmarks onto a single comparable scale.",
    evaluator: 'Epoch AI',
    domain: 'Composite intelligence',
    url: 'https://epoch.ai/data/ai-models',
  },
  'GPQA Diamond': {
    group: 'reasoning',
    blurb: 'Graduate-level scientific reasoning',
    desc: 'Graduate-level multiple-choice questions in biology, physics, and chemistry, written by domain experts to be hard to answer even with web search.',
    evaluator: 'NYU & collaborators',
    domain: 'Scientific Reasoning',
    url: 'https://arxiv.org/abs/2311.12022',
  },
  "Humanity's Last Exam": {
    group: 'reasoning',
    blurb: 'Frontier of human expert knowledge',
    desc: 'A broad, deliberately brutal exam of expert-level questions spanning many subjects, built to resist saturation by frontier models.',
    evaluator: 'CAIS & Scale AI',
    domain: 'General Knowledge',
    url: 'https://lastexam.ai',
  },
  'SimpleQA Verified': {
    group: 'reasoning',
    blurb: 'Factual accuracy & hallucination',
    desc: 'Short, fact-seeking questions with a single correct answer — measures factual accuracy and how often a model hallucinates.',
    evaluator: 'OpenAI',
    domain: 'Factual Accuracy',
    url: 'https://openai.com/index/introducing-simpleqa/',
  },
  'SimpleBench': {
    group: 'reasoning',
    blurb: 'Common-sense trick questions',
    desc: 'Everyday reasoning and common-sense "trick" questions where ordinary humans reliably outperform most language models.',
    evaluator: 'AI Explained',
    domain: 'Common-sense Reasoning',
    url: 'https://simple-bench.com',
  },
  'ARC-AGI': {
    group: 'reasoning',
    blurb: 'Abstract visual reasoning',
    desc: 'Abstract visual puzzles that test fluid intelligence — inferring a rule from a few examples and generalizing to new grids.',
    evaluator: 'ARC Prize Foundation',
    domain: 'Abstract Reasoning',
    url: 'https://arcprize.org',
  },
  'ARC-AGI-2': {
    group: 'reasoning',
    blurb: 'Harder abstract reasoning',
    desc: 'The harder second generation of ARC-AGI, designed to resist brute-force search and memorization while staying easy for humans.',
    evaluator: 'ARC Prize Foundation',
    domain: 'Abstract Reasoning',
    url: 'https://arcprize.org/arc-agi/2/',
  },
  'WeirdML': {
    group: 'reasoning',
    blurb: 'Novel ML problem-solving',
    desc: 'Unusual, novel machine-learning tasks that reward genuine problem-solving rather than patterns memorized from training data.',
    domain: 'ML Problem-solving',
    url: 'https://weirdml.com',
  },
  'SWE-bench Verified': {
    group: 'coding',
    blurb: 'Real GitHub issue resolution',
    desc: 'Real GitHub issues from popular Python projects that the model must fix with a working code patch — a human-validated subset of SWE-bench.',
    evaluator: 'Princeton & OpenAI',
    domain: 'Software Engineering',
    url: 'https://www.swebench.com',
  },
  'LiveCodeBench': {
    group: 'coding',
    blurb: 'Contamination-free coding',
    desc: 'Competitive-programming problems collected continuously after models are trained, so scores resist contamination from memorized training data.',
    evaluator: 'LiveCodeBench',
    domain: 'Competitive Programming',
    url: 'https://livecodebench.github.io',
  },
  'SciCode': {
    group: 'coding',
    blurb: 'Scientific research coding',
    desc: 'Python programming problems drawn from real scientific research, curated by scientists across physics, biology, and other fields.',
    evaluator: 'Scientist collaboration',
    domain: 'Scientific Computing',
    url: 'https://scicode-bench.github.io',
  },
  'MMLU-Pro': {
    group: 'reasoning',
    blurb: 'Broad expert knowledge',
    desc: 'A harder, cleaned-up successor to MMLU with more answer choices and reasoning-heavy questions across 14 academic and professional subjects.',
    evaluator: 'TIGER-Lab',
    domain: 'General Knowledge',
    url: 'https://arxiv.org/abs/2406.01574',
  },
  'WebDev Arena': {
    group: 'coding',
    blurb: 'Human-rated web development',
    desc: 'Head-to-head human preference ratings (Elo) for web-development tasks, where people pick the better of two model-built apps.',
    evaluator: 'LMArena',
    domain: 'Web Development',
    url: 'https://lmarena.ai',
  },
  'GSO (code optimization)': {
    group: 'coding',
    blurb: 'Code performance optimization',
    desc: 'Tasks that ask the model to make existing code run faster, scored by how much real performance improvement it achieves.',
    domain: 'Code Optimization',
  },
  'MATH Level 5': {
    group: 'math',
    blurb: 'Hardest competition math',
    desc: 'The hardest tier (Level 5) of the MATH benchmark — competition-style problems requiring multi-step symbolic reasoning.',
    evaluator: 'Hendrycks et al.',
    domain: 'Mathematics',
    url: 'https://arxiv.org/abs/2103.03874',
  },
  'AIME 2024/2025': {
    group: 'math',
    blurb: 'Olympiad-qualifier math',
    desc: 'Problems from the American Invitational Mathematics Examination, a difficult qualifying contest for the USA Math Olympiad.',
    domain: 'Competition Mathematics',
    url: 'https://artofproblemsolving.com/wiki/index.php/AIME',
  },
  'FrontierMath': {
    group: 'math',
    blurb: 'Research-level math problems',
    desc: 'Original, research-level mathematics problems crafted by professional mathematicians; many are unsolved by any current model.',
    evaluator: 'Epoch AI',
    domain: 'Advanced Mathematics',
    url: 'https://epoch.ai/frontiermath',
  },
  'FrontierMath Tier 4': {
    group: 'math',
    blurb: 'Hardest research math',
    desc: 'The most difficult tier of FrontierMath — problems pitched at the level of working research mathematics.',
    evaluator: 'Epoch AI',
    domain: 'Research Mathematics',
    url: 'https://epoch.ai/frontiermath',
  },
  'Terminal-Bench': {
    group: 'agentic',
    blurb: 'Command-line agentic tasks',
    desc: 'End-to-end tasks the model must complete by operating a real command-line terminal — testing tool use and multi-step execution.',
    evaluator: 'Stanford & Laude Institute',
    domain: 'Agentic / Tool Use',
    url: 'https://www.tbench.ai',
  },
  'τ²-bench': {
    group: 'agentic',
    blurb: 'Tool-agent-user reliability',
    desc: 'Dual-control customer-service scenarios where the agent and a simulated user both act; measures multi-turn tool use, policy compliance, and doing the task right consistently.',
    evaluator: 'Sierra & Princeton',
    domain: 'Agentic / Tool Use',
    url: 'https://github.com/sierra-research/tau2-bench',
  },
  'APEX': {
    group: 'agentic',
    blurb: 'Multi-step agentic tasks',
    desc: 'Multi-step, tool-using agent scenarios scored on whether the model completes the task correctly on its first attempt (pass@1).',
    domain: 'Agentic Problem-solving',
  },
  'GDPval (win/tie rate)': {
    group: 'agentic',
    blurb: 'Economically valuable work',
    desc: 'Economically valuable, real-world professional tasks where the model’s work is judged against human experts (rate of wins plus ties).',
    evaluator: 'OpenAI',
    domain: 'Real-world Economic Tasks',
    url: 'https://openai.com/index/gdpval/',
  },
  'METR task horizon': {
    group: 'agentic',
    blurb: 'Autonomous task length',
    desc: 'The length of task (in human work-time) a model can complete reliably — a measure of how long an agent can stay on track autonomously.',
    evaluator: 'METR',
    domain: 'Agentic Autonomy',
    url: 'https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/',
  },
}

export function benchmarkMeta(name: string): BenchmarkMeta | null {
  return BENCHMARK_META[name] ?? null
}
