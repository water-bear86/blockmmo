# Grid Assignment Field Mapping

Grid assignment JSON files are planning specs for RUNECHAIN's work grid. They are not passed directly to the current `molt` CLI as a file. The real on-disk API splits objective data from job routing data.

## Real `molt` CLI Shape

```sh
molt objective create "<title>"
molt job create --objective <id> --type <type> --capability <cap> "<title>"
```

There is no `-f` flag in the current CLI. Objectives also do not carry `objective_type` or `capability`; those fields belong to the grid assignment spec and are mapped into job creation.

## Storage API Shape

`molt-dispatch/packages/broker/logic.js` exposes:

```js
createObjective(title, prompt)
createJob(objectiveId, type, title, prompt, capabilityRequired)
```

Objectives are stored as `{ title, prompt }`. Jobs carry the routing fields: `type` and `capability_required`.

## Spec-To-Dispatch Mapping

| Spec field | Dispatch/API field | Notes |
| --- | --- | --- |
| `type` | `createJob(..., type, ...)` and `molt job create --type <type>` | The RUNECHAIN assignment type, such as `runechain-propose-region`. |
| `objective_type` | Validator-only/spec classification | Must be `inference` for these specs; it is not written onto the objective row. |
| `capability` | `createJob(..., capabilityRequired)` and `molt job create --capability <cap>` | Used by the broker scheduler to match workers. |
| `planner` | Spec metadata | Describes the planner family expected to execute the work. |
| `description` | Objective/job title source | A concise human-readable summary that can be used for titles or dashboards. |
| `prompt_template` | `createObjective(title, prompt)` and `createJob(..., prompt, ...)` | The self-contained work prompt. The current CLI uses the final title argument as both title and prompt, so a fuller adapter should pass this prompt through the broker API. |
| `gold_reward` | Spec metadata/reward policy | Positive numeric reward for successful completion; not currently a `molt` CLI argument. |
| `output_schema` | Spec metadata/validator contract | Describes the expected worker result shape; not currently a `molt` CLI argument. |

For direct broker integration, create the objective from a title plus `prompt_template`, then create a job with `type`, a display title, the same `prompt_template`, and `capability`.
