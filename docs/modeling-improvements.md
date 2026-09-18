# PigFlow Modeling Improvements

## Purpose

PigFlow already has a strong simulation foundation: individual animals, deterministic replay, daily state changes, lineage, stage-specific costs, cohort sales, mortality timing, and an auditable ledger.

The main opportunity is to evolve it from a detailed biological and financial calculator into a farm simulation engine. In an engine-style model, resources are finite, operational decisions alter the world, and constraints create downstream consequences rather than only appearing as warnings or dashboard metrics.

The central design principle should be:

> Every important input should either change a state transition, constrain an action, modify a probability, or alter a financial transaction.

## Existing strengths

- Every pig is represented individually, with sex, age, weight, ancestry, stage, destination, and accumulated cost.
- Reproduction, growth, feeding, mortality, treatment, sale, and cash activity advance daily.
- Simulation runs are deterministic for a given plan and seed.
- Settled mode provides stable planning comparisons.
- Chance mode provides reproducible scenario variation.
- Costs are attributed to animals and production stages.
- Mortality timing is more realistic than applying a flat daily rate.
- Market pigs are sold in cohorts and incur real trip counts.
- The farm maintains an event log and daily ledger.
- The test suite provides broad coverage of the documented rules.

## Priority summary

| Priority | Current behaviour | Why it matters | Recommended model |
| --- | --- | --- | --- |
| P0 | Growing-house capacity is informational only | Pen counts do not change production | Make space a finite resource that can block movements |
| P0 | Feed deliveries are planned with full future knowledge | Inventory never runs out and purchasing is unrealistically perfect | Add reorder policies, lead times, bin capacity, and shortages |
| P0 | Missed services are retried every following day | A sow can be served outside her heat | Model explicit estrus windows and missed cycles |
| P0 | Feed is paid for as consumed rather than when purchased | Cashflow and inventory value are distorted | Separate purchasing, inventory, consumption, and accounts payable |
| P1 | Growth and mortality barely respond to farm conditions | Overcrowding, weather, disease, labour, and shortages have no biological consequences | Add condition-driven modifiers and common shocks |
| P1 | One global random stream drives most chance events | Small rule changes can reshuffle unrelated outcomes | Use deterministic keyed random draws |
| P1 | Five seeds produce the comparison risk bands | Five observations cannot describe tail risk reliably | Support 100–1,000 simulations for decision analysis |
| P2 | Asset and herd valuation are simplistic | Net worth and cost per kilogram can be misleading | Add inventory accounting, depreciation, and stage-adjusted valuation |

## 1. Make housing part of the simulated world

The configuration includes farrowing, weaner, grower, and finisher places. At present, these values are used to calculate displayed occupancy, but they do not constrain animal movements.

Reducing every growing-house capacity to one place currently leaves births, deaths, sales, revenue, cost, peak head count, and funding need unchanged. This means housing is being reported rather than simulated.

### Recommended state

Represent housing as explicit resources:

- Building or room identifier.
- Permitted animal stages.
- Number of places.
- Current occupants.
- Entry and planned exit dates.
- Cleaning and empty-period requirements.
- Environmental properties such as temperature, ventilation, and bedding system.
- Whether overflow is allowed.

### Recommended movement rules

When a batch becomes eligible to move:

1. Request space in the destination room.
2. Move if sufficient compatible space is available.
3. Otherwise create a `MovementBlocked` event.
4. Apply the configured management response:
   - Hold the batch in its current room.
   - Use overflow accommodation.
   - Sell early.
   - Reduce the next intake.
   - Rent temporary accommodation.
5. Apply consequences for delayed movement or overcrowding.

### Possible consequences

- Reduced daily gain.
- Worse feed conversion.
- Increased disease pressure and mortality risk.
- Additional bedding, cleaning, and labour.
- Delayed sale dates.
- Lower sale weights or price penalties.
- Forced early weaning or delayed farrowing intake.

The resulting feedback chain should be capable of emerging naturally:

```text
Full finisher pens
  -> growers cannot move
  -> grower pens fill
  -> weaners cannot move
  -> farrowing and nursery pressure rises
  -> biological output and cashflow change
```

### Reporting additions

- Daily and peak occupancy, not only month-end occupancy.
- Time-weighted average utilization.
- Number of animal-days over capacity.
- Number and duration of blocked movements.
- Lost gain and added cost attributed to housing pressure.
- Projected date when each facility first becomes limiting.

## 2. Model reproductive opportunities as event windows

An open sow currently remains due for service on every day after her scheduled service date. If boar capacity is unavailable, she can therefore be served several days later without missing her heat.

A more realistic model should treat estrus as a limited opportunity.

### Recommended events

- `EstrusExpected`
- `EstrusDetected`
- `EstrusMissed`
- `ServiceAttempted`
- `ServiceCompleted`
- `ServiceOpportunityMissed`
- `ReturnToEstrus`
- `PregnancyScanned`
- `PregnancyLost`
- `FarrowingStarted`
- `FarrowingCompleted`

### Recommended rules

- Give each estrus a service window, such as two or three days.
- If no boar, semen, technician, or labour is available inside the window, schedule the next cycle approximately 21 days later.
- Model heat-detection probability separately from conception probability.
- Allow boar presence, staff skill, workload, and observation frequency to affect heat detection.
- Distinguish failure to conceive from early pregnancy loss.
- Track abortion, stillbirths, and mummified piglets separately from born alive.
- Let parity, body condition, season, prior litter performance, health, and service method modify outcomes.

This makes labour and boar capacity genuine reproductive constraints rather than short service delays.

## 3. Replace perfect-foresight haulage with operational procurement

The current feed plan simulates future consumption first and then constructs the deliveries required to satisfy it. This is useful as an optimized planning benchmark, but it prevents stockouts, ordering mistakes, supplier delays, and excess inventory.

### Retain two procurement modes

#### Perfect-foresight mode

Keep the current approach as a best-case logistics benchmark. Label it clearly as an optimized plan rather than an operational simulation.

#### Operational mode

Orders should be created from the state known on the day:

- Current inventory.
- Recent consumption.
- Forecast consumption over a limited planning window.
- Reorder point.
- Target days of cover.
- Supplier lead time.
- Minimum order quantity.
- Truck and bin capacity.
- Available cash or supplier credit.

### Inventory features

- Separate bins or stores for each ration.
- Maximum storage capacity.
- Batch age and expiry.
- Spoilage and shrinkage.
- Delivery delays.
- Rejected or short deliveries.
- Emergency purchases at a premium.
- Feed substitution rules.
- Supplier payment terms.

### Shortage consequences

A shortage should create an explicit event and affect production:

- Restricted intake.
- Substitute ration use.
- Reduced gain.
- Sow condition loss.
- Reduced milk production.
- Increased mortality or disease susceptibility.
- Delayed sales.
- Emergency delivery expense.

## 4. Separate purchasing, inventory, cost, and cash

Feed currently affects cash as it is consumed, while the value of unused feed is added to farm value. A more realistic model needs separate physical and financial transactions.

### Recommended transaction flow

```text
Purchase order placed
  -> goods delivered
  -> inventory increases
  -> supplier invoice recognized
  -> supplier paid according to terms
  -> feed consumed
  -> inventory decreases
  -> production cost is attributed to animals
```

### Financial statements

Maintain three related but distinct views:

- **Cashflow:** when money actually enters or leaves the bank.
- **Profit and loss:** revenue and expenses attributed to the relevant period.
- **Balance sheet:** cash, inventory, livestock, fixed assets, receivables, and liabilities.

### Additional concepts

- Accounts payable and supplier credit.
- Accounts receivable where buyers pay after delivery.
- Inventory write-offs.
- Sales tax or VAT where applicable.
- Loan principal and interest.
- Owner contributions and withdrawals outside operating profit.
- Fixed-asset acquisition, depreciation, maintenance, useful life, and residual value.

## 5. Make animal performance condition-dependent

Current daily gain is largely determined by stage, sex, and permanent thriftiness. This is a good representation of potential performance, but achieved performance should also respond to the farm.

A useful model is:

```text
achieved gain
  = potential gain
  x nutrition factor
  x health factor
  x thermal comfort factor
  x stocking-density factor
  x management factor
```

### Suggested animal state

- Potential growth factor.
- Body condition or energy reserve.
- Recent feed intake.
- Health state.
- Immune or vaccination state.
- Thermal stress.
- Stocking stress.
- Recovery debt after weaning or illness.
- Treatment history.

### Sow-specific dynamics

Sows require additional state because one reproductive cycle affects the next:

- Body condition score.
- Weight and condition loss during lactation.
- Milk demand driven by litter size.
- Lactation feed intake.
- Recovery after weaning.
- Parity-specific litter potential.
- Repeat-service history.
- Previous litter size and weaning performance.
- Lameness or reproductive failure.

These states should affect wean-to-service interval, conception, litter size, culling risk, and longevity.

## 6. Add correlated farm-level shocks

Settled mortality is useful because it returns approximately the configured rate. Chance mode, however, should expose the variability and correlation that make real farms risky.

### Two-layer risk model

#### Background risk

- Individual frailty.
- Stage-specific mortality hazard.
- Minor disease and injury.
- Ordinary conception and growth variation.

#### Common shocks

- Disease outbreak.
- Heat wave or cold period.
- Ventilation failure.
- Water interruption.
- Electricity or heating failure.
- Feed contamination.
- Labour absence.
- Supplier failure.
- Transport interruption.
- Abattoir closure.
- Market-price fall.

Common shocks should affect several systems together. For example, a respiratory outbreak might reduce intake and gain, increase treatment cost and mortality, delay sales, overcrowd finishing rooms, and worsen cashflow.

The existing carried-debt mortality system can remain available for settled mode. Chance mode should use stochastic hazards and shared farm or cohort conditions.

## 7. Use keyed deterministic randomness

Most chance events currently consume one shared random stream. Adding or removing a random draw in one subsystem can therefore change unrelated outcomes later in the simulation.

Replace sequential random consumption with keyed draws:

```text
random(seed, system, entityId, eventId, attemptNumber)
```

Examples:

```text
conception / SOW-014 / service-3
litter-size / SOW-014 / parity-4
growth-potential / PIG-00241
delivery-delay / order-19
outbreak-entry / farm / 2028-Q2
```

Benefits:

- Stable counterfactual comparisons.
- Reordering one system does not change unrelated outcomes.
- Events can be replayed and debugged independently.
- Adding a new randomized feature does not invalidate every existing scenario.
- Tests can target one draw without depending on the whole random sequence.

## 8. Expand market modelling

The current market pays one fixed price per deadweight kilogram. Operational and price uncertainty should become part of the model.

### Suggested features

- Time-varying market-price schedules.
- Seasonal or stochastic price movement.
- Contracts versus spot sales.
- Buyer capacity and available collection dates.
- Weight bands and overweight or underweight penalties.
- Grading and carcass-quality variation.
- Condemnation risk.
- Payment delays and buyer default risk.
- Minimum viable load and shared transport options.
- Strategic sale rules based on weight, price, space pressure, and feed cost.

This creates a real management decision: continue feeding for more weight, sell early to release space, or wait for a better market date.

## 9. Turn labour into a task-capacity system

Labour currently scales financially with head count, but workers do not constrain what can be completed.

### Represent farm work as tasks

Each task should have:

- Due date and service window.
- Required worker-hours.
- Required skill.
- Required equipment or facility.
- Priority.
- Consequence of delay or omission.

Example tasks:

- Heat detection.
- Service or insemination.
- Pregnancy scanning.
- Farrowing supervision.
- Piglet processing.
- Vaccination.
- Pen cleaning.
- Batch movement.
- Feed ordering.
- Loading and sale preparation.
- Repairs.

Workers and equipment provide finite capacity. When demand exceeds capacity, the farm should prioritize tasks and allow lower-priority work to be delayed or missed.

This links staffing decisions to conception, mortality, biosecurity, maintenance, and sales rather than only payroll.

## 10. Improve genetics and replacement selection

Current lineage tracking prevents selected paternal-line matings, but replacement decisions can become more meaningful.

### Suggested improvements

- Track both paternal and maternal ancestry to configurable depth.
- Detect common ancestors and calculate an approximate inbreeding coefficient.
- Track breed or genetic line.
- Give animals heritable production traits.
- Apply genetic merit to growth, litter size, robustness, and feed efficiency.
- Add a gilt-selection rate rather than retaining the first eligible females.
- Use selection criteria such as growth, soundness, teat count, dam history, and relatedness.
- Model boar fertility, semen quality, libido, illness, and rest requirements.

## 11. Improve valuation and cost-of-production boundaries

All growing pigs are currently valued as if their liveweight can immediately be converted to sale-value deadweight. Piglets and young growers should not have the same per-kilogram value as finished pigs.

### Livestock valuation options

- Accumulated cost to date.
- Stage-specific standard value.
- Net realizable value: expected future sale value less remaining cost and risk.
- Local replacement or market value.

Use different valuation rules for:

- Suckling piglets.
- Weaners.
- Growers.
- Finishers.
- Replacement gilts.
- Productive sows.
- Cull sows.
- Boars.

### Horizon-boundary treatment

Cost of production should account for work in progress at the beginning and end of the plan. Otherwise, a short plan can contain costs for unsold pigs without matching sales, and capital costs can be spread over an arbitrary number of pigs.

Possible approaches:

- Opening and closing work-in-progress valuation.
- Cohort-based profitability.
- Equivalent finished units.
- Steady-state reporting after a warm-up period.
- Separation of startup economics from mature-farm economics.

## 12. Improve risk analysis

Five matched seeds are useful for fast comparisons but insufficient for reliable P10 and P90 estimates.

### Recommended simulation levels

- **Preview:** 5–10 runs for interactive feedback.
- **Decision analysis:** at least 100 runs.
- **Tail-risk analysis:** 500–1,000 runs.

### Recommended risk metrics

- Probability of negative cash.
- Probability of breaching the working-capital target.
- Funding need at P50, P90, and P95.
- Probability of exceeding each housing capacity.
- Sale-weight and sale-date distributions.
- Annual pigs sold distribution.
- Probability of missing debt repayments.
- Expected loss from outbreaks or equipment failures.
- Value at risk and expected shortfall where useful.

### Sensitivity tools

- One-variable sensitivity charts.
- Tornado analysis.
- Scenario comparison using common keyed randomness.
- Break-even feed price.
- Break-even sale price.
- Marginal value of one additional pen, worker, boar, or tonne of storage.

## 13. Add calibration and backtesting

A simulator becomes credible when it can be compared with observed farm data.

### Data that could be imported

- Exact animal or batch roster.
- Sow parity and reproductive state.
- Historical services, farrowings, and weanings.
- Weekly feed deliveries and usage.
- Death and treatment records.
- Sale weights and prices.
- Labour hours.
- Temperature or environmental observations.
- Actual invoices and payments.

### Calibration workflow

1. Initialize the simulation from a historical date.
2. Run it over a period with known results.
3. Compare weekly predicted and actual values.
4. Show error by subsystem.
5. Fit or recommend changes to uncertain parameters.
6. Preserve calibrated farm profiles separately from scenario decisions.

Useful validation metrics include:

- Born alive per litter.
- Pre-weaning mortality.
- Wean-to-service interval.
- Farrowing rate.
- Average daily gain.
- Feed conversion.
- Days to sale.
- Mortality by stage.
- Feed used per pig sold.
- Cash timing error.

## Recommended engine architecture

The simulation should gradually move away from one large daily procedure toward explicit engine concepts.

### World state

The mutable state of the farm:

- Animals and cohorts.
- Pens, rooms, and buildings.
- Feed, medicine, gas, and bedding inventory.
- Workers and equipment.
- Cash, receivables, payables, loans, and assets.
- Weather and farm health pressure.
- Supplier and buyer state.

### Definitions

Mostly immutable data:

- Breed definitions.
- Ration specifications.
- Disease definitions.
- Building types.
- Treatment protocols.
- Supplier terms.
- Market contracts.
- Price schedules.

### Policies

Player or planner decisions:

- Breeding policy.
- Gilt-selection policy.
- Culling policy.
- Feeding policy.
- Procurement policy.
- Housing and overflow policy.
- Treatment policy.
- Labour priority policy.
- Sale policy.

### Systems

Independent systems operating on world state:

- Calendar and environment.
- Housing and movement.
- Reproduction.
- Nutrition and growth.
- Health and disease.
- Mortality.
- Labour and task scheduling.
- Inventory and procurement.
- Market and sales.
- Accounting and financing.

### Domain events

Every material occurrence should be recorded as an immutable event containing:

- Event type.
- Simulation time.
- Entities involved.
- Cause.
- Inputs or decision that produced it.
- State changes.
- Financial postings.
- Human-readable explanation.

Events make the simulation replayable, testable, and explainable. A user should be able to inspect a delayed sale and trace it back through slower gain, a feed shortage, a delayed delivery, and the ordering policy that created it.

### Commands and decisions

Separate an intention from its outcome:

```text
Command: Move batch A to grower room 2
Outcome: Movement blocked because only 18 of 24 places are free
Event: Batch A remains in the weaner room
Consequences: overcrowding, additional feed days, and delayed downstream movement
```

This distinction is essential for both game-like interaction and realistic operational planning.

## Suggested daily execution phases

The order of systems should be explicit and tested because it can change outcomes.

1. Advance calendar and environment.
2. Complete scheduled arrivals and external events.
3. Update inventory and available resources.
4. Generate due tasks and reproductive opportunities.
5. Allocate labour, equipment, boars, rooms, and supplies.
6. Execute completed care, treatment, breeding, and movement actions.
7. Calculate intake, growth, condition, and production.
8. Update disease and health state.
9. Resolve mortality and removals.
10. Evaluate sale and culling policies.
11. Post purchasing, operating, sales, and financing transactions.
12. Emit daily metrics, warnings, and domain events.

## Suggested implementation roadmap

### Phase 1: Make existing inputs causal

1. Enforce housing capacities.
2. Add blocked movement and overflow events.
3. Replace continuous service eligibility with estrus windows.
4. Add daily and peak capacity reporting.
5. Add regression tests proving that capacity changes outcomes.

### Phase 2: Introduce real inventories

1. Add ration-specific on-hand inventory.
2. Add bin capacities.
3. Add purchase orders and supplier lead times.
4. Add reorder policies.
5. Add stockouts and emergency orders.
6. Separate delivery payment from feed consumption cost.

### Phase 3: Stabilize simulation randomness

1. Introduce a keyed random service.
2. Migrate conception, litter, sex, growth, and timing draws.
3. Preserve existing seeded reproducibility where practical.
4. Add counterfactual-stability tests.

### Phase 4: Add operational feedback

1. Add achieved-growth modifiers.
2. Add sow body condition.
3. Add environmental stress.
4. Add farm and cohort health pressure.
5. Add labour tasks and finite worker capacity.

### Phase 5: Improve financial realism

1. Add inventory assets and accounts payable.
2. Add payment terms.
3. Add fixed assets and depreciation.
4. Add loans and debt service.
5. Add work-in-progress and stage-adjusted livestock values.
6. Separate cashflow, profit and loss, and balance sheet reporting.

### Phase 6: Decision and risk tools

1. Expand Monte Carlo run counts.
2. Add insolvency and capacity-breach probabilities.
3. Add sensitivity analysis.
4. Add calibration and historical backtesting.
5. Add exact farm-state imports.

## Recommended first milestone

The first milestone should focus on four changes:

1. Enforce pen capacity.
2. Correct service opportunity windows.
3. Introduce ration inventory with non-clairvoyant ordering.
4. Post feed purchasing and consumption separately.

Together, these changes create the first major engine-like feedback loops. Adding a pen, changing an order policy, missing a heat, carrying more working capital, or suffering a delivery delay will then alter biological output, scheduling, and cashflow through the same simulated world.
