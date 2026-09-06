# Session handover

One compressed transcript, of the session being handed over. Nothing else.

`plans/sessions/` was tracked once as a 40 MB zip of 68 sessions from three
unrelated projects, and EI-017 removed it for that reason - not because a
handover is unwelcome. `.gitignore` now allows exactly `README.md` and
`*.jsonl.gz` here, so the raw seven-megabyte `.jsonl` cannot be committed by
accident.

## What is here

| file | session | covers |
|---|---|---|
| `session-d1284b0b.jsonl.gz` | `d1284b0b-3d81-48b1-b37b-a6587b2f4ba1` | the stabilization audit through to the EI-010 design brief, 2026-09-06 |

Two further transcripts exist locally from the same day and are deliberately not
here: they are the two Fable 5.1 runs that produced `EI-010-DESIGN.md` and
`EI-010-MYSLENKA.md`. Their output is already committed as those documents.

**The transcript is a snapshot taken while the session was still running**, so it
stops a few turns before the session actually ended. The committed documents are
the authority on what was decided; the transcript is there for the reasoning
behind it.

## Restoring it on another machine

```bash
mkdir -p ~/.claude/projects/-home-box-git-github-escape-game-engine
gunzip -c plans/sessions/session-d1284b0b.jsonl.gz \
  > ~/.claude/projects/-home-box-git-github-escape-game-engine/d1284b0b-3d81-48b1-b37b-a6587b2f4ba1.jsonl
```

Then `claude --resume` in this directory and pick it from the list. The filename
must keep the session id, or it will not appear.

If the checkout is not at `/home/box/git/github/escape-game-engine`, the project
directory name changes: it is the absolute path with `/` replaced by `-`.

## Where to pick the work up

`plans/HANDOVER.md` is kept current and is the right first read;
`plans/OPEN-ITEMS.md` is the registry. As of this handover two items are open:

- **EI-030**, P1 and independent of everything else: one dropped `puzzles.json`
  request is cached as an empty map that satisfies the loader's own guard, so
  every puzzle in the game becomes unopenable until a reload. Unfixed, no test.
- **EI-010**, the system state for the teacher dashboard. The design exists and
  is unimplemented: `EI-010-EVIDENCE.md` is the measured ground,
  `EI-010-DESIGN.md` is Fable 5.1's design, and `EI-010-MYSLENKA.md` is the same
  thing written for the owner in Czech. It is waiting on seven decisions listed
  at the end of that last file.
