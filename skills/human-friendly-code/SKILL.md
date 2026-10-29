---
name: human-friendly-code
description: Use when a human says they do not understand the code, find it difficult to read, or struggle to follow its logic.
---

# Human-Friendly Code

Code is understandable when a person can build a mental model progressively along the reading path—not merely when its logic is internally consistent. Two principles matter: **understanding has an order, and terminology has continuity.**

## Guiding Principles

> Should readers really have to understand the entire system before they can understand the code in front of them, only to rely on that same code to understand the system?

> If people need to move from an overall direction into specific mechanisms, shouldn't the code first establish what this part does, then unfold why it works this way in a coherent order?

> If existing terminology carries a person's understanding, how can we justify casually renaming it or introducing a new concept without explaining, at its first appearance, where it comes from and how it relates to existing mechanisms?

These three questions are checks the agent applies to its own code. They are not requests for the user to explain the whole system, nor questions to ask the user in every reply.

## When to Use

Use this skill when a human says they do not understand the code or find it difficult to read—for example, “I can't understand this,” “This is hard to read,” or “This logic is difficult to follow.” No prior diagnosis of tangled responsibilities, terminology changes, or system-wide dependencies is required.

## Reading Path: Establish the Map, Then Unfold the Mechanisms

1. **Map the existing code first.** Read entry points, callers, major states, and tests. Identify the user's existing terminology and the normal business flow. Distinguish facts in the code from your own assumptions.
2. **Check for a circular understanding dependency.** For confusing code, identify the facts readers must already know. If those facts can only be learned from later code, readers are trapped in a “know the whole before understanding the part” loop.
3. **Establish responsibilities before details.** The entry point should show the main stages and their relationships; specific rules belong near the stage that owns them. Organize the reading path around the business sequence rather than dropping a concrete, late-stage mechanism into an early step without context.
4. **Separate mechanisms by responsibility and preconditions.** Make each step's inputs, outputs, and guarantees clear; downstream steps should use established preconditions. Splitting a long method into vaguely named helpers is not an improvement if readers still have to guess across files.

Giving an overall direction first does not mean dumping every system detail up front. Making code locally understandable does not mean copying all background information into every function.

### Example: Reading Should Not Silently Interpret History

This short fragment requires readers to understand version history, a business flag, policy construction, and deferred persistence at once:

```python
body = normalize_workflow_run(body)
body.setdefault('record_criteria', False)
body.setdefault('judgment_policy', new_judgment_policy(body['record_criteria']))
```

It appears to load data, but it also decides what missing fields mean and constructs business state. The guarantee of `normalize` is unclear too: if the data is already normalized, why must the caller keep filling it in?

A clearer responsibility boundary is:

```text
Legacy data → Explicit compatibility/migration boundary → Data satisfying the current contract → Normal reading and use
```

Keep the rationale for legacy values at the compatibility boundary; let the normal path rely on an explicit current contract. Whether this requires a one-time migration or a boundary adapter depends on the project's compatibility requirements. This skill does not authorize changes to persistence timing, interfaces, or missing-field semantics. Legitimately optional values may have defaults; the problem is a default that silently takes on another mechanism's responsibilities.

## Terminology Continuity: Connect New Understanding to Existing Understanding

- Preserve the object names, domain terms, and meanings already adopted by the user and the project. Refactoring responsibilities is not the same as renaming concepts.
- When renaming is necessary, make the old-to-new mapping and the reason explicit. Obtain agreement first if the rename affects a public contract or exceeds the task's scope.
- When introducing a concept, explain at its first definition or the reader's first encounter: what it is, why it is needed, how it derives from or differs from an existing concept, and who establishes and maintains its validity.
- Give comments enough space to close real understanding gaps. Do not leave all explanation of a new concept in chat, external documentation, or a distant implementation.
- Express structure through responsibilities, names, and contracts first. Use comments for background, constraints, and relationships the code cannot express. More comments cannot repair tangled responsibilities.

## Review Scope and Delivery Checks

When the user specifies an entire class or module, the example lines are an entry point: follow the normal flow and inspect similar problems throughout that scope, rather than merely moving those lines elsewhere. Let the request determine the scope. Do not expand it into a repository-wide rewrite or invent Services, Managers, or extra layers in the name of clarity.

| Check | Acceptable outcome |
| --- | --- |
| Reading entry point | Readers see the responsibility and main stages before specific rules. |
| Local preconditions | Value origins, default rationales, and state guarantees are identifiable without guessing about distant flows. |
| Responsibility boundaries | Legacy compatibility and normal business behavior have an explicit boundary; step names match their actual guarantees. |
| Terminology continuity | Existing terms are not replaced without reason; new concepts explain their relationships at first appearance. |
| Change cost | Conceptual load and navigation decrease—not merely line count or method size. |
| Behavioral evidence | Tests check interfaces, states, exceptions, and persistence behavior; intentional semantic changes are stated separately. |

At completion, briefly explain in chat which understanding burden was removed, the scope of the changes, verification results, and remaining limitations. Do not make reading separate assistant-written documentation a prerequisite for the user to understand the changes.
