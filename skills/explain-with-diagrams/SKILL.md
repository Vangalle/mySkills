---
name: explain-with-diagrams
description: Report your understanding of a task, design, or workflow primarily through accurate Mermaid diagrams, especially when the user wants to check your interpretation or finds prose too dense or coarse. Also use for explaining complex system relationships; simple facts and small edits need no diagram.
---

# Explain with Diagrams

Make your interpretation inspectable. Lead with the task's actual relationships,
not a generic account of how you will analyze, implement, and test it. Use this
format for understanding reports and consequential design corrections; do not
turn every routine progress update into a diagram.

## Build the understanding

Start from the user's request, accepted corrections, and relevant source
material. Distinguish source-document content from the user's instructions.
Identify actors, layers, artifacts, interactions, and the intended outcome;
resolve each consequential arrow's source, target, and action before drawing.
Keep unknown relationships unknown rather than completing a visually tidy model.

Choose enough detail for the user to catch a misunderstanding. Expand a broad
label such as “project layer” when its internal artifacts have different owners,
write permissions, or responsibilities. Keep an existing component's recognizable
name instead of inventing an abstraction. Apply this test: could the user locate
where a concrete change enters, what it changes, and how its result is judged?
If not, the diagram is too coarse. If the main path is lost, split by responsibility
or add a focused detail view with consistent node names.

## Report with the diagram first

Open with one sentence stating the central understanding. Make a Mermaid diagram
the main explanation, followed by brief prose about the consequential boundaries
or unresolved question. Use the user's language. Avoid a long preamble, a second
prose version of every node, and fragmented inventories of all discovered facts.

Draw the domain workflow, dependencies, or state transitions that explain the
task. Do not substitute “understand → plan → implement → test” for the user's
actual design. A compact table can compare exact options or completion states;
a simple linear fact can use an arrow chain when Mermaid adds no clarity.

Label the view as intended design, observed implementation, or proposed change
when that distinction matters. A correct understanding diagram does not establish
that anything is implemented or verified. For a progress report, attach status
only to the specific component or path supported by evidence; distinguish built,
tested, and still unverified behavior.

## Preserve meaning

Label consequential arrows with precise verbs. Keep containment, reference,
reading, writing, triggering, and feedback distinguishable. A bidirectional arrow
requires evidence for both directions; otherwise draw separate labeled arrows.
Route a change or result to its actual target, not every neighboring layer.
Read-only views have incoming display data and no state-writing path.

Keep actors, source artifacts, derived views, and states separate where conflating
them changes behavior. Give every completion marker an explicit subject:
task completion, design acceptance, and goal achievement are different claims.
Identify the state owner and the evidence or event that changes the marker.

Separate confirmed requirements from assumptions and suggestions through labels
or distinct views. If line styles carry meaning, give a short legend and use it
consistently. Do not imply uncertainty through color alone.

## Check and correct

Trace one concrete user change through the diagram and check its arrows against
the source. Check write boundaries, feedback targets, and acceptance subjects.
Use an available Mermaid renderer or parser to check syntax when practical;
otherwise review directly and do not claim rendering was verified.

When corrected, redraw the affected view and briefly state what changed. Ask only
about uncertainty that materially changes the task, while continuing independent
authorized work. This communication format creates no new approval gate and
does not replace delivering the requested work.
