# Claude Code Sessions Archive

## Archive contents

`claude-sessions-all.zip` contains all conversation transcripts (JSONL format) organized by project:

| Project | Sessions | Description |
|---|---|---|
| `escape-game-engine/` | 1 | Heat-escape game + Content Panel engine feature |
| `somewm/` | 52 | SomeWM window manager development |
| `synapse/` | 15 | Synapse project development |

## How to restore sessions

### 1. Extract the archive

```bash
cd plans/sessions
unzip claude-sessions-all.zip
```

### 2. Copy transcripts to Claude's project directory

```bash
# Escape-game-engine sessions
mkdir -p ~/.claude/projects/-home-box-git-github-escape-game-engine
cp escape-game-engine/*.jsonl ~/.claude/projects/-home-box-git-github-escape-game-engine/

# SomeWM sessions
mkdir -p ~/.claude/projects/-home-box-git-github-somewm
cp somewm/*.jsonl ~/.claude/projects/-home-box-git-github-somewm/

# Synapse sessions
mkdir -p ~/.claude/projects/-home-box-git-github-synapse
cp synapse/*.jsonl ~/.claude/projects/-home-box-git-github-synapse/
```

### 3. Resume a session

In Claude Code, use `/resume` to pick from previous conversations, or start a new session in the project directory — Claude automatically has access to past session context.

## Key session IDs

### escape-game-engine
- `5783898d-b37b-487b-93cd-84c349befec2` (2026-02-22) — heat-escape game creation, Content Panel engine feature, bug fixes

## Plan files for context

- `plans/heat-escape.md` — full heat-escape game specification
- `plans/engine-content-panels.md` — Content Panel feature design
