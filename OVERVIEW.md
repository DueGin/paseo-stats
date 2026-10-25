Usage stats shows how many tokens your Paseo agents used and what they cost in USD, broken down by provider, model and project. It also shows how agents collaborate: which agents launched child agents, how wide and deep those trees go, and how much of the spend happens in child agents.

## What you get

- A screen in the sidebar footer, also reachable from the command center, with totals for cost, tokens (input, output, cache read, cache write), requests and active agents.
- Breakdown tables by provider, model and project. Sort by cost or tokens, and tap a row to filter everything by it.
- A time range picker: last 24 hours (the default), 7, 30 or 90 days, all time, or a custom range.
- Searchable multi-select filters for providers, models and projects. Filters combine and apply to every number on the screen.
- A multi-agent section with collaboration trees, child agents, average and maximum fan-out, depth, the share of cost spent in child agents, provider pairs such as Claude to Codex, and the most expensive collaborations with their member agents. Provider-native subagents, such as Codex subthreads and Claude Code subagents, are counted separately and attributed to the Paseo agent that spawned them.
- Collaboration by model: each model's spend as an orchestrator, a child agent and a provider subagent, the share of its spend that happens in collaboration, what orchestrators mainly using it delegated (children, their spend and fan-out), and parent to child pairs by model or by provider. Tap a model to filter the screen by it.
- Topology graphs: a layered graph of which agents launched which, grouped per level by model or by provider. Line thickness shows the number of children, dashed nodes are provider subagents, and tapping a node highlights and lists its links. Each collaboration in the ranking can also switch from a list to an agent-level topology, where tapping a node opens that agent.

## How it works

Paseo does not keep a usage history, so the plugin reads the session logs that providers write on the daemon machine and links each session to its Paseo agent:

- Claude Code: `~/.claude/projects` (or `CLAUDE_CONFIG_DIR`)
- Codex: `~/.codex/sessions` and `archived_sessions` (or `CODEX_HOME`)
- Pi: `~/.pi/agent/sessions` (or `PI_CODING_AGENT_DIR`)
- Oh My Pi: `~/.omp/agent/sessions`

Usage is copied into a ledger under `~/.paseo/plugin-data/paseo-stats`, so totals survive when providers clean up old logs. The plugin syncs after agent turns end, every 10 minutes while the daemon runs, and when you open or refresh the screen. Usage from before the plugin was installed is only available while those logs still exist.

Project and parent agent information comes from Paseo. Collaboration trees follow the parent agent recorded when one agent launches another through Paseo.

## Costs

Costs are estimates. When a log records its own cost (Pi and Oh My Pi), that value is used. Otherwise the plugin applies a custom price from its settings, or a public price from the LiteLLM price list, including cache read and cache write rates. Models without a price are shown as unpriced and count as $0.

## Settings

- Fetch public prices: downloads the LiteLLM price list from GitHub at most once a day and caches it. Turn it off to stay offline. No usage data leaves the machine.
- Custom prices: USD per million tokens for input, output, cache read and cache write. Use them for relay or private model names, or to match your actual billing.
- Update automatically: checks the plugin's GitHub releases every 6 hours and installs a new version through `paseo plugin update`. The plugin reloads; the daemon keeps running. Off by default.

## Network access

The plugin makes two kinds of outbound requests from the daemon, and neither includes usage data, prompts or credentials:

- `raw.githubusercontent.com` for the LiteLLM public price list, at most once a day while public prices are on.
- `api.github.com` for this plugin's latest release, when you open the screen, every 6 hours, or when you ask it to check.

## Updates

When a newer GitHub release exists, the stats screen shows it with a link to the release notes and an update button. Applying an update runs `paseo plugin update` with the release tag; the plugin then reloads and the daemon keeps running. The plugin looks for the `paseo` command on the daemon's `PATH` and in the usual install locations, and uses `PASEO_CLI` when it is set. Updating from inside the plugin works for copies installed directly from GitHub or npm. Copies installed from a local directory show how to update by hand, and copies installed from this registry show that registry listings update through Paseo's plugin list or a new reviewed version.

## Limits

Other providers, such as Grok or Kimi Code CLI, are listed as unsupported in the data notes and are not counted. Token counts reflect what each provider logs; subscription plans are shown at API list prices.
