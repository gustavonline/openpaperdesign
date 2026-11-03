# Choose the view that answers the question

| Question | Useful view | What to preserve/check |
|---|---|---|
| Who uses a system and what surrounds it? | C4 context | Named system, users, external systems, boundary and meaningful interactions |
| What runs or stores data, and how do those units interact? | C4 container | Runnable units, responsibilities, known technology/protocol; avoid mixing classes into the same level |
| What is inside one runnable unit? | Component/UML-style structure | One selected scope, interfaces/dependencies and source-backed names |
| What order do messages occur in? | Sequence view in the project's native format | Time order, participants, sync/async/return distinctions; Paper Library has no formal sequence engine |
| Who does what, including branches/handoffs? | BPMN-style process or flowchart | Start/end, tasks, event/decision meaning, conditions, ownership/lanes; common shapes do not execute BPMN |
| What data is related? | ER | Actual entities/tables, keys and known cardinality; textual edge labels are supported, crow-foot syntax is not automatic |
| How are code types related? | UML-style class/package view | Correct class/interface/association meaning, purposeful fields/methods and scope; formal UML interchange needs its native tooling |
| What is deployed in a cluster? | Kubernetes/topology | Actual workload/controller/service/ingress roles and relationships; icons do not imply a running cluster |

The terms **C4 container**, **Docker container** and **Kubernetes Pod** are different concepts. Use a C4 container for a runnable application/data store at that abstraction level; add deployment detail in a separate view when needed. Do not silently infer that every icon is one process or machine.

Keep source IDs in a code/native-model handoff when present. Note the source and its date/revision when they matter. The Paper's own stable layer IDs maintain editing relationships; they are not a replacement for domain identity or evidence.

For dense layouts, preserve manual placements and split the view before introducing a new layout engine. Check geometric bounds, label space and line paths in the actual render. A line passing through an unrelated service/table is a readability defect even when both endpoint IDs are valid.

References: [C4 notation](https://c4model.com/diagrams/notation), [C4 containers](https://c4model.com/diagrams/container), and the inspected [architecture/layout methods](../../osm-paper/references/methods.md).
