-- ════════════════════════════════════════════════════════════════════════════
-- Reference data: intelligence categories (with keyword hints used for fast
-- rule-based categorisation) and the built-in source catalogue.
-- Built-in sources can be muted per user (user_preferences.muted_source_ids)
-- and new private sources can be added from Settings → Integrations.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.intelligence_categories (slug, name, description, keywords, sort_order) values
  ('llm', 'Large Language Models', 'Foundation and chat models, reasoning models, model releases.',
    array['llm', 'large language model', 'language model', 'gpt', 'claude', 'gemini', 'llama', 'qwen', 'mistral',
          'deepseek', 'phi-', 'gemma', 'reasoning model', 'context window', 'tokens', 'instruction-tuned', 'fine-tun'], 1),
  ('ai-agents', 'AI Agents', 'Agentic systems, tool use, computer use and orchestration.',
    array['agent', 'agents', 'agentic', 'multi-agent', 'tool use', 'tool calling', 'function calling', 'computer use',
          'browser use', 'langgraph', 'crewai', 'autogen', 'autonomous'], 2),
  ('mcp', 'MCP', 'Model Context Protocol servers, clients and specification updates.',
    array['mcp', 'model context protocol', 'mcp server', 'mcp client'], 3),
  ('open-source-ai', 'Open-source AI', 'Open-weight models, local inference and open tooling.',
    array['open source', 'open-source', 'open weights', 'open-weight', 'apache 2.0', 'mit license', 'gguf', 'ollama',
          'llama.cpp', 'vllm', 'hugging face', 'huggingface', 'local inference', 'mlx'], 4),
  ('image-video', 'Image & Video', 'Image, video and 3D generation.',
    array['image generation', 'video generation', 'text-to-image', 'text-to-video', 'diffusion', 'stable diffusion',
          'flux', 'sora', 'veo', 'midjourney', 'image editing', '3d generation'], 5),
  ('speech-audio', 'Speech & Audio', 'Speech recognition, text-to-speech, voice and music AI.',
    array['speech', 'text-to-speech', 'tts', 'asr', 'speech recognition', 'whisper', 'voice', 'audio', 'music generation'], 6),
  ('ai-research', 'AI Research', 'Papers, benchmarks, datasets and research results.',
    array['paper', 'arxiv', 'research', 'benchmark', 'dataset', 'we propose', 'state-of-the-art', 'sota', 'ablation'], 7),
  ('ai-dev-tools', 'AI Developer Tools', 'SDKs, frameworks, coding assistants and developer platforms.',
    array['sdk', 'framework', 'library', 'cli', 'ide', 'coding assistant', 'code generation', 'copilot', 'devtools',
          'developer', 'api', 'release'], 8),
  ('ai-startups', 'AI Startups & Products', 'Launches, funding, acquisitions and new AI products.',
    array['startup', 'funding', 'raises', 'series a', 'series b', 'seed round', 'acquires', 'acquisition', 'valuation',
          'launches', 'product hunt'], 9)
on conflict (slug) do nothing;

insert into public.news_sources (kind, name, url, feed, default_category_id, config, fetch_interval_minutes, weight)
select s.kind, s.name, s.url, s.feed, c.id, s.config::jsonb, s.interval_min::integer, s.weight::real
  from (values
  -- AI news & announcements (RSS)
  ('rss', 'OpenAI News', 'https://openai.com/news/rss.xml', 'ai_news', 'llm', '{}', 60, 1.3),
  ('rss', 'Google DeepMind Blog', 'https://deepmind.google/blog/rss.xml', 'ai_news', 'ai-research', '{}', 120, 1.25),
  ('rss', 'Google AI Blog', 'https://blog.google/technology/ai/rss/', 'ai_news', 'llm', '{}', 120, 1.15),
  ('rss', 'Hugging Face Blog', 'https://huggingface.co/blog/feed.xml', 'ai_news', 'open-source-ai', '{}', 120, 1.2),
  ('rss', 'Microsoft Research Blog', 'https://www.microsoft.com/en-us/research/feed/', 'ai_news', 'ai-research', '{}', 180, 1.0),
  ('rss', 'AWS Machine Learning Blog', 'https://aws.amazon.com/blogs/machine-learning/feed/', 'ai_news', 'ai-dev-tools', '{}', 180, 0.9),
  ('rss', 'TechCrunch AI', 'https://techcrunch.com/category/artificial-intelligence/feed/', 'ai_news', 'ai-startups', '{}', 60, 1.0),
  ('rss', 'The Verge AI', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 'ai_news', null, '{}', 60, 0.95),
  ('rss', 'MIT Technology Review AI', 'https://www.technologyreview.com/topic/artificial-intelligence/feed', 'ai_news', null, '{}', 180, 1.0),
  ('rss', 'Simon Willison''s Weblog', 'https://simonwillison.net/atom/everything/', 'ai_news', 'llm', '{}', 120, 1.15),
  ('rss', 'Hacker News: AI (100+ points)', 'https://hnrss.org/newest?q=AI+OR+LLM+OR+GPT+OR+agents&points=100', 'ai_news', null, '{}', 60, 1.0),
  -- Developer ecosystem (RSS)
  ('rss', 'React Blog', 'https://react.dev/rss.xml', 'developer', 'ai-dev-tools', '{}', 360, 1.1),
  ('rss', 'Next.js Blog', 'https://nextjs.org/feed.xml', 'developer', 'ai-dev-tools', '{}', 360, 1.1),
  ('rss', 'Node.js Blog', 'https://nodejs.org/en/feed/blog.xml', 'developer', 'ai-dev-tools', '{}', 360, 1.0),
  ('rss', 'Supabase Blog', 'https://supabase.com/rss.xml', 'developer', 'ai-dev-tools', '{}', 360, 1.0),
  ('rss', 'PostgreSQL News', 'https://www.postgresql.org/news.rss', 'developer', 'ai-dev-tools', '{}', 720, 0.9),
  ('rss', 'AWS What''s New', 'https://aws.amazon.com/about-aws/whats-new/recent/feed/', 'developer', 'ai-dev-tools', '{}', 180, 0.8),
  ('rss', 'GitHub Changelog', 'https://github.blog/changelog/feed/', 'developer', 'ai-dev-tools', '{}', 180, 0.95),
  ('rss', 'Python Insider', 'https://blog.python.org/feeds/posts/default?alt=rss', 'developer', 'ai-dev-tools', '{}', 720, 1.0),
  -- Repository releases (GitHub API)
  ('github_releases', 'React releases', null, 'developer', 'ai-dev-tools', '{"repo": "facebook/react"}', 360, 1.2),
  ('github_releases', 'Next.js releases', null, 'developer', 'ai-dev-tools', '{"repo": "vercel/next.js", "skip_prereleases": true}', 360, 1.2),
  ('github_releases', 'Node.js releases', null, 'developer', 'ai-dev-tools', '{"repo": "nodejs/node"}', 360, 1.1),
  ('github_releases', 'Express releases', null, 'developer', 'ai-dev-tools', '{"repo": "expressjs/express"}', 720, 1.0),
  ('github_releases', 'FastAPI releases', null, 'developer', 'ai-dev-tools', '{"repo": "fastapi/fastapi"}', 720, 1.0),
  ('github_releases', 'Supabase JS releases', null, 'developer', 'ai-dev-tools', '{"repo": "supabase/supabase-js"}', 720, 0.9),
  ('github_releases', 'pgvector releases', null, 'developer', 'open-source-ai', '{"repo": "pgvector/pgvector"}', 1440, 1.0),
  ('github_releases', 'Ollama releases', null, 'developer', 'open-source-ai', '{"repo": "ollama/ollama"}', 360, 1.25),
  ('github_releases', 'llama.cpp releases', null, 'developer', 'open-source-ai', '{"repo": "ggml-org/llama.cpp", "max_per_fetch": 2}', 720, 0.9),
  ('github_releases', 'vLLM releases', null, 'developer', 'open-source-ai', '{"repo": "vllm-project/vllm"}', 720, 1.0),
  ('github_releases', 'Vercel AI SDK releases', null, 'developer', 'ai-dev-tools', '{"repo": "vercel/ai", "max_per_fetch": 3}', 720, 1.0),
  ('github_releases', 'LangGraph releases', null, 'developer', 'ai-agents', '{"repo": "langchain-ai/langgraph", "max_per_fetch": 3}', 720, 1.0),
  ('github_releases', 'LlamaIndex releases', null, 'developer', 'ai-dev-tools', '{"repo": "run-llama/llama_index", "max_per_fetch": 3}', 720, 0.9),
  ('github_releases', 'Pydantic AI releases', null, 'developer', 'ai-agents', '{"repo": "pydantic/pydantic-ai", "max_per_fetch": 3}', 720, 1.0),
  ('github_releases', 'OpenAI Agents SDK releases', null, 'developer', 'ai-agents', '{"repo": "openai/openai-agents-python"}', 720, 1.0),
  ('github_releases', 'CrewAI releases', null, 'developer', 'ai-agents', '{"repo": "crewAIInc/crewAI"}', 720, 0.9),
  ('github_releases', 'MCP TypeScript SDK releases', null, 'developer', 'mcp', '{"repo": "modelcontextprotocol/typescript-sdk"}', 720, 1.2),
  ('github_releases', 'MCP Python SDK releases', null, 'developer', 'mcp', '{"repo": "modelcontextprotocol/python-sdk"}', 720, 1.2),
  -- GitHub trending (HTML, github.com/trending)
  ('github_trending', 'GitHub Trending (all languages)', 'https://github.com/trending', 'github_trending', null, '{"since": "daily"}', 180, 1.0),
  ('github_trending', 'GitHub Trending (Python)', 'https://github.com/trending/python', 'github_trending', null, '{"since": "daily", "language": "python"}', 360, 1.0),
  ('github_trending', 'GitHub Trending (TypeScript)', 'https://github.com/trending/typescript', 'github_trending', null, '{"since": "daily", "language": "typescript"}', 360, 1.0),
  -- Hugging Face
  ('huggingface_models', 'Hugging Face trending models', 'https://huggingface.co/models?sort=trending', 'models', 'open-source-ai', '{"limit": 30}', 360, 1.1),
  ('huggingface_papers', 'Hugging Face Daily Papers', 'https://huggingface.co/papers', 'research', 'ai-research', '{}', 180, 1.2),
  -- arXiv
  ('arxiv', 'arXiv: cs.CL / cs.AI / cs.LG', 'https://arxiv.org', 'research', 'ai-research',
    '{"query": "cat:cs.CL OR cat:cs.AI OR cat:cs.LG", "max_results": 40}', 720, 0.8),
  -- Product Hunt (requires PRODUCT_HUNT_TOKEN on the API)
  ('product_hunt', 'Product Hunt: Artificial Intelligence', 'https://www.producthunt.com/topics/artificial-intelligence', 'products', 'ai-startups',
    '{"topic": "artificial-intelligence", "limit": 20}', 360, 0.9)
  ) as s (kind, name, url, feed, category, config, interval_min, weight)
  left join public.intelligence_categories c on c.slug = s.category
on conflict do nothing;
