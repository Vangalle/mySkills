---
name: writing-code-comments
description: Use when adding, reviewing, or revising code comments, docstrings, or inline explanations, or when code seems to need a comment to be understood.
---

# Writing Code Comments

## Core rule

A comment is justified only by information the code cannot carry. Before writing
one, answer:

> What does this tell a future reader that the code itself doesn't?

If the answer only restates what the code does, delete the comment and change the
code instead: rename the variable, extract a function, or express the constraint
in a type. The reader needs the missing fact, not a narration of the implementation.

## Three questions

1. **Can the reader recover this from the code, names, and types?** Then don't
   comment; improve the code.
2. **Does it explain why this way, why not the obvious alternative, or what
   external condition forces it?** Keep it.
3. **Is it a contract the signature cannot express — units, range, ordering,
   errors, side effects, ownership, thread-safety?** Keep it, or encode it in the
   type when the language allows.

A fact that would be repeated at every call site belongs once, in the declaration's
doc comment.

## What earns a comment

- **Reason or rejected alternative.** Why this order, workaround, or apparent
  inefficiency, rather than the simpler version.
- **External facts.** A vendor limit, undocumented API behavior, platform bug,
  protocol quirk, or business rule — with its source.
- **Contracts.** Preconditions, units, ranges, errors, side effects, ordering,
  ownership, thread-safety.
- **Hazards.** A known trap, deliberate violation, or "do not change this without
  also changing X", linked to an issue where possible.
- **The idea of a non-obvious algorithm.** The approach, not a line-by-line
  translation.

```ts
// The provider may deliver the same webhook more than once and retries for
// up to 72 hours. Deduplicating by event id is what keeps refunds idempotent;
// without it, customers are refunded twice (INC-4412).
if (processedEventIds.has(event.id)) return;
```

The signature shows parameter types. It cannot show duration, idempotency, or
failure behavior — that is the information worth writing:

```ts
/**
 * Reserves `quantity` units for 15 minutes.
 *
 * Not idempotent: each call creates a new reservation. Throws
 * InsufficientStock without reserving anything.
 */
function reserve(sku: string, quantity: number): Reservation;
```

## What does not earn a comment

| Comment | Problem | Do instead |
| --- | --- | --- |
| `// increment retry count` | narrates the next line | delete |
| `// loop over active users` | narrates the loop | name the collection `activeUsers` |
| `// returns the user's email` on `getEmail()` | repeats the signature | delete, or document errors and side effects |
| `// check if the user is an admin` | restates the condition | `const isAdmin = user.role === 'admin'` |
| `// TODO: clean this up` | no owner, trigger, or removal condition | file an issue, link it, state what unblocks it |
| `// 2024-03-02: added retry — Caleb` | history | `git log` / `git blame` |
| commented-out code | dead weight; git already keeps it | delete |
| `// ===== HELPERS =====` in a short file | section noise | extract a function or module |

If the comment is only needed because a name is vague, the name is the bug. A
well-chosen name is a comment the compiler checks, the debugger shows, and nobody
has to keep up to date.

## Workflow: change the code first

1. Draft the comment the line seems to need.
2. Apply the core question. If it restates the code, do not polish it — remove it.
3. Make the code carry the meaning instead: rename after the concept
   (`check()` → `isPastDue()`), extract a function whose name states the intent,
   name a magic value, or return a richer type.
4. Comment only what remains external or contractual: why, source, consequence,
   hazard.
5. Put it next to the constraint it protects, and update or delete it in the same
   change that touches the code.

Extraction has a cost: only extract when the name expresses a concept the reader
needs. A one-line function created solely to host a comment adds indirection
without meaning.

## Doc comments

A public API reader may have no body to inspect, so the contract is genuine
missing information. Document purpose, preconditions, errors, side effects, units,
and thread-safety. Do not repeat parameter types, return types, or the function
name; a docstring that only restates the signature fails the same test.

## Keep comments honest

- State the constraint and its consequence: "must run before X because Y", not
  "runs before X".
- Name the source of an external fact: issue, incident, RFC, vendor documentation.
- Keep one fact per comment; put long rationale in the commit message or a linked
  document.
- A stale comment is worse than no comment. Change or remove it with the code.

## Red flags

- The comment can be derived by reading the next three lines.
- It is longer than the code it explains.
- It compensates for a vague name, a boolean parameter, or a function doing
  several things.
- `// safe`, `// hack`, or `// workaround` with no reason or link.
- Step-by-step narration inside a short function.

When reviewing, apply the same test to every comment the change touches:
restatement → delete; outdated → fix or delete; missing reason → ask for it. Leave
unrelated comments alone rather than expanding the diff.
