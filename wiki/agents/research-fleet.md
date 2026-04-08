# Research Fleet — Scheduled Agent Directions

## Philosophy

Each research agent is pointed at a direction where returned knowledge directly benefits:

- **Product decisions** (what to build, what to fork, how to price)
- **Technical capability** (better extraction, new integrations, new export targets)
- **Market intelligence** (who's buying what, what problems remain unsolved)
- **Distribution** (where users are, how they discover tools)

---

## Agent 1: Market Scanner

**Schedule:** Daily (6 AM PT)
**Direction:** Who is paying for structured knowledge extraction, domain modeling, compliance tooling, or AI-agent context systems?
**Query targets:** ProductHunt launches, HackerNews front page, GitHub trending, IndieHackers, Twitter/X AI dev discourse
**Output:** `wiki/research/market/YYYY-MM-DD.md`
**Value:** Identifies verticals where SWM forks would have immediate buyers. Spots competitors early. Tracks pricing signals.

### Prompt

```
Search for recent launches, discussions, and products related to:
- Structured knowledge extraction from documents/code
- Domain modeling tools and platforms
- AI agent context/memory systems
- Compliance and audit automation tools
- Requirements traceability software
- World model / ontology builders

For each finding, report: product name, what it does, pricing model, target audience, and how SWM's capabilities compare or could serve the same need.

Save findings to wiki/research/market/ with today's date.
```

---

## Agent 2: Technical Frontier

**Schedule:** Every 3 days (2 AM PT)
**Direction:** What advances in extraction, structuring, or LLM-powered analysis could make SWM more powerful?
**Query targets:** arXiv (NLP, knowledge graphs, information extraction), Anthropic docs, OpenAI cookbook, LangChain/LlamaIndex releases, MCP ecosystem
**Output:** `wiki/research/technical/YYYY-MM-DD.md`
**Value:** Keeps extraction quality improving. Identifies new source types to support. Spots MCP ecosystem opportunities.

### Prompt

```
Research recent advances (last 2 weeks) in:
- Information extraction from unstructured text (entity/relation/process extraction)
- Knowledge graph construction from documents
- LLM-powered structured output and schema validation
- MCP (Model Context Protocol) ecosystem: new servers, tools, patterns
- Claude API updates, new model capabilities, prompt engineering techniques
- Zod / schema validation advances in TypeScript

For each finding: what it is, why it matters for a world-model extraction system, and whether it suggests a concrete improvement. Be specific about applicability.

Save to wiki/research/technical/ with today's date.
```

---

## Agent 3: Use Case Excavator

**Schedule:** Every 2 days (8 AM PT)
**Direction:** What specific, painful problems do people have that SWM already solves or could solve with a thin fork?
**Query targets:** Reddit (r/devops, r/programming, r/startups, r/consulting), StackOverflow, HackerNews Ask, Discord communities
**Output:** `wiki/research/use-cases/YYYY-MM-DD.md`
**Value:** Discovers concrete product opportunities with real demand signals. Each use case is a potential fork.

### Prompt

```
Search for people expressing frustration or asking for help with:
- Understanding large codebases or complex documentation
- Onboarding to new projects or domains
- Compliance auditing and traceability
- Keeping documentation in sync with reality
- Giving AI agents context about their domain
- Merging or comparing specifications/requirements
- Tracking how systems evolve over time

For each finding: the exact pain point, who has it (role, industry), how they're currently solving it (or failing to), and how SWM could address it. Include the source URL.

Save to wiki/research/use-cases/ with today's date.
```

---

## Agent 4: Distribution & Packaging Scout

**Schedule:** Weekly (Monday 7 AM PT)
**Direction:** How do similar tools get distributed? What packaging/pricing models work?
**Query targets:** npm trends, VS Code marketplace, CLI tool distribution patterns, SaaS pricing pages, developer tool GTM strategies
**Output:** `wiki/research/distribution/YYYY-MM-DD.md`
**Value:** Informs how SWM forks should be packaged, priced, and distributed for maximum ROI.

### Prompt

```
Research distribution and monetization patterns for developer/AI tools:
- How are CLI tools monetized? (freemium, usage-based, enterprise licenses)
- What VS Code extensions or IDE integrations are gaining traction in the knowledge/documentation space?
- What MCP servers are being published and how are they distributed?
- What's the current state of developer tool pricing? What price points work?
- Any new distribution channels emerging for AI-powered dev tools?

For each finding: the pattern, who's doing it successfully, revenue signals if available, and applicability to SWM product forks.

Save to wiki/research/distribution/ with today's date.
```

---

## Agent 5: Self-Improvement Auditor

**Schedule:** Weekly (Wednesday 3 AM PT)
**Direction:** What's weak in SWM itself? Where does extraction fail? What do users need that doesn't exist yet?
**Query targets:** SWM's own test results, self-model outputs, extraction quality on diverse inputs, GitHub issues if public
**Output:** `wiki/research/self-audit/YYYY-MM-DD.md`
**Value:** Continuous quality improvement of the core engine. Better engine = better forks = more revenue.

### Prompt

```
Analyze the current state of the structured-world-model codebase:
- Run pnpm test and report any failures or warnings
- Review the self-model JSON files for quality (score, entity coverage, extraction notes)
- Identify the weakest areas: which entity types get extracted poorly? Which relation types are underused?
- Check for TODO/FIXME/HACK comments in the codebase
- Review the validation agent's 21 issue codes — are any triggered disproportionately?
- Suggest the single highest-impact improvement to extraction quality

Save analysis to wiki/research/self-audit/ with today's date.
```

---

## Research Output Format (Standard)

Every research output should follow:

```markdown
# [Direction] Research — YYYY-MM-DD

## Key Findings

1. [Most actionable finding]
2. [Second most actionable]
3. ...

## Detailed Findings

### [Finding Title]

- **Source:** [URL or reference]
- **What:** [Description]
- **Relevance:** [How this connects to SWM]
- **Action:** [Specific next step, or "Monitor"]

## Signals

- **Strong signals:** [Patterns seen multiple times]
- **Weak signals:** [Early indicators worth watching]

## Recommended Actions

- [ ] [Concrete action item]
- [ ] [Concrete action item]
```
