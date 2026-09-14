# Evaluation

The assignment asks for a small set of test scenarios and an explanation of how agent
decisions are judged — explicitly *not* a scoring framework. This is that: four real,
unedited runs (raw tool traces, not paraphrased) plus a walkthrough of each against the
assignment's six evaluation questions.

Every log in [runs/](runs/) is the actual stdout of `yarn smoke:scenario` against a live
model — nothing here is fabricated or hand-written. Reproduce any of them:

```bash
cd agent
yarn smoke:scenario s1-recommendation-review                              # runs/s1-clean-modify.log
yarn smoke:scenario s2-supplier-shortfall                                 # runs/s2-natural-partial-topup.log
yarn smoke:scenario s2-supplier-shortfall --force-pause --approve         # runs/s2-gate-pause-approve.log
yarn smoke:scenario s2-supplier-shortfall --force-pause --reject          # runs/s2-gate-pause-reject.log
```

Re-running will produce different PO ids and slightly different prose (it's a live LLM
call) but the same decisions, since the numbers that drive them are fixed by the seed
data and the deterministic validator — that determinism is exactly what's being
evaluated below.

## The four runs

| Run | Scenario | Path exercised |
|---|---|---|
| [s1-clean-modify.log](runs/s1-clean-modify.log) | S1 | Agent investigates unprompted, rejects the 800-unit recommendation on its own, lands on a validated 120-unit order. No gate hit — the plan it chooses passes cleanly. |
| [s2-natural-partial-topup.log](runs/s2-natural-partial-topup.log) | S2 | Agent investigates unprompted, tries `validate_plan` at a few quantities, finds a budget-safe 50-unit top-up before ever attempting a write. Gate never triggers because the agent self-corrects first. |
| [s2-gate-pause-approve.log](runs/s2-gate-pause-approve.log) | S2 | Buyer instruction forces the agent to attempt the full 250-unit top-up, which fails `BUDGET_AVAILABLE`. Gate pauses the run (`AWAITING_APPROVAL`); a human approves; the write executes on resume; the agent reports the real outcome and flags the budget overage. |
| [s2-gate-pause-reject.log](runs/s2-gate-pause-reject.log) | S2 | Same forced 250-unit attempt, gate pauses, human rejects. No PO is created. The resumed agent reacts to the rejection with a coherent recommendation instead of repeating stale pre-rejection text. |

The last two exist because the well-behaved agent rarely proposes a plan the gate has
to block on its own (see the natural run) — `--force-pause` is the mechanism to
exercise the gate and both human decisions on demand. See the root
[README](../README.md#human-approval-gate-and-escalation) for how the gate works.

## Against the assignment's six questions

### Was the decision correct?

- **Deterministic half** (must be right regardless of what the LLM says): `erp`'s unit
  tests and `agent/src/__tests__/purchasing-tools.test.ts` assert `validate_plan`
  results and `createPurchaseOrder`'s confirmed-quantity math against hand-computed
  numbers for the seeded scenarios — no LLM involved.
- **S1**: 800 fails `STORAGE_CAPACITY` and `CASE_PACK_MULTIPLE` by the seed's own
  numbers (480 used + 400 incoming + 800 = 1680 vs. 1000 capacity). The agent's chosen
  120 is verified in the log as the largest case-pack multiple that fits.
- **S2 natural**: the agent's 50-unit top-up is arithmetically justified in the log —
  demand gap is only 40 units, but supplier MOQ is 50, so 50 is the correct floor.
- **S2 forced**: 250 units at ₹610 costs ₹152,500 against ₹45,000 available — the
  budget failure is a fact about the seed data, not the model's opinion. Both the
  approve and reject logs show the same correct pre-flight failure; they differ only
  in the human's downstream call, which the assignment says is exactly where judgment
  should sit.

### Did the agent obtain the necessary information?

Every run's log shows read tools called before any write is attempted — `s1-clean-modify.log`
lines 6–13 call all eight read tools before a single `validate_plan`. The system prompt
requires this ordering; the trace is how a reviewer checks it actually happened rather
than trusting the prose.

### Did it respect constraints?

Checked mechanically, not by re-reading prose: every `validate_plan` call and its full
per-rule result list is a `tool_result` line in the log. In `s2-gate-pause-approve.log`,
the pre-flight failure (`BUDGET_AVAILABLE`) is visible before the gate blocks the call —
so the failure is confirmed independently of what the agent says about it afterward.

### Did it take the appropriate action?

`create_purchase_order`'s result (`po`, `adjustments`, `diverged`) is a `tool_result`
line in every run that writes. `s2-gate-pause-reject.log` shows the appropriate action
was *no write* — the "Open POs after run" section confirms only the original `PO-9001`
exists, nothing new.

### Did it validate the result?

Every successful write is followed by a second `validate_plan` call with `quantity: 0`
(closing the loop on confirmed state, not requested state) — visible as the last
`tool_call`/`tool_result` pair before the final assistant message in
`s1-clean-modify.log`, `s2-natural-partial-topup.log`, and `s2-gate-pause-approve.log`.

### What happens when the initial action doesn't work?

Two distinct failure modes, both exercised:

- **Supplier shortfall** (a write that partially succeeds): `PO-9001` in every S2 run
  confirms only 250 of 500 requested. The agent treats this as a real constraint to
  react to, not a partial success to ignore — see the "why 250 isn't enough" reasoning
  in `s2-natural-partial-topup.log`.
- **Gate rejection** (a write that's blocked before it happens):
  `s2-gate-pause-reject.log` shows the agent's response *after* being told no —
  a fresh recommendation reflecting the rejection, not a repeat of what it said before
  being blocked. This was a real bug during development (the frontend showed stale
  pre-rejection text as the "final decision"); the fix and this log are why it's
  called out explicitly here rather than assumed to work.

## What this deliberately doesn't do

No aggregate pass rate, no scoring rubric, no dozens of scripted cases. At four
scenarios, a human reading the raw trace end-to-end is more informative than a number —
and the assignment says as much. The unit tests carry the part that must never depend
on how the model happens to word things; the logs carry the part that's actually being
evaluated (did the agent investigate, decide, act, and recover appropriately).
