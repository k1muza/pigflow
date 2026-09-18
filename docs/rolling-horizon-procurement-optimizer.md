# Rolling 90-Day Procurement Planner

Status: proposed engineering specification  
Target: PigFlow 2.0 engine  
Initial scope: feed, gas and bedding procurement

## 1. Purpose

Add an optional operating policy that forecasts expected consumption from the farm visible today and buys supplies to a common 90-day coverage date.

The planner recalculates every day. When actual consumption, births, growth or services cause a store to run down earlier than expected, it brings the next delivery forward and produces a fresh 90-day plan before dispatching the truck.

This is a rolling replenishment planner, not a perfect-foresight simulation and not a Monte Carlo optimiser. It does not try different biological futures. It calculates one transparent expected-demand curve from configured production rates and the farm's currently observable state.

## 2. Operating rule

The default target is:

> On every normal delivery, buy enough of each compatible supply so its working stock reaches the safety floor on the same date, 90 days after that delivery arrives, subject to storage, pack-size and vehicle constraints.

Examples of granularity:

- feed is rounded up to whole 50 kg bags when `feedBagKg` is 50;
- gas is rounded up to whole 48 kg canister fillings when `gasCanisterKg` is 48;
- bedding is rounded up to whole configured bedding loads;
- loose feed, represented by `feedBagKg === 0`, may be ordered by kilogram.

Feed and gas may share the supplies truck. Bedding remains a separate load under the current transport model.

The common date is a target, not a promise. A store may receive less coverage when:

- it cannot physically hold 90 days of stock;
- the required goods do not fit on the available vehicle trips;
- whole-package rounding changes the exact depletion date;
- existing stock or pending orders already carry it beyond the target;
- forecast demand is zero;
- an emergency delivery has different lead-time constraints.

When exact equality is impossible, allocate available capacity to make projected coverage dates as equal as possible, while serving the store that would run out first before less urgent stores.

## 3. Why this is useful

For fixed rations and prices, most goods cost is driven by what the herd consumes. Procurement savings therefore come primarily from:

- combining near-due goods on the same truck;
- avoiding emergency premiums;
- avoiding half-empty journeys;
- preventing shortages that reduce growth;
- not buying stock that will not be consumed;
- respecting storage so deliveries are usable;
- exposing the working capital tied up by a 90-day policy.

The policy is not guaranteed to minimise every definition of cost. Ninety days of cover can tie up more cash than a shorter cycle. PigFlow must report inventory value, payables and funding alongside delivery savings rather than describing every reduction in trips as net savings.

## 4. Product behaviour

Keep the existing procurement modes and add an operational policy:

| UI choice | Stored configuration | Meaning |
| --- | --- | --- |
| Perfect-foresight benchmark | `procurementMode: "foresight"` | Existing best-case logistics benchmark. |
| Reorder-point | `procurementMode: "operational"`, `operationalPolicy: "reorder-point"` | Existing operational behaviour. |
| Rolling 90-day plan | `procurementMode: "operational"`, `operationalPolicy: "rolling-cover"` | The policy defined here. |

Existing plans default to `reorder-point`, preserving their current results. `rolling-cover` is available only on engine 2.0.

## 5. Daily process

Every simulated morning, before new orders are placed:

1. Observe the current animals, stores, pending orders and known farm calendar.
2. Forecast expected daily consumption for the next 90 days plus normal delivery lead time.
3. Project each store's quantity and exhaustion date using confirmed pending deliveries.
4. Decide whether a delivery must be dispatched earlier than currently planned.
5. If no store is at risk, place no order.
6. If a delivery is required, set its arrival date from the applicable lead time.
7. Reforecast from today and calculate each store's quantity to a common target date 90 days after arrival.
8. Round quantities to purchase units and constrain them by storage and vehicles.
9. Book only today's order.
10. Repeat the entire calculation tomorrow from observed reality.

No unplaced future order is committed. The forecast may display future expected deliveries, but tomorrow's calculation may move or resize them.

## 6. Dispatch trigger

Let:

```text
risk date = earliest projected day a required store falls below its safety stock
normal arrival = today + normal delivery lead days
```

Place a normal order today when:

```text
risk date <= normal arrival
```

Also dispatch today when:

- an already projected delivery is no longer early enough because consumption increased;
- a newly known farrowing, weaning or batch transition changes demand materially;
- a pending delivery is delayed;
- a store has already run short.

If a store cannot be protected by a normal delivery, use the existing emergency lead time and premium. Recalculate the whole compatible load before dispatching it; an emergency truck should not leave partially empty while another store will need stock shortly.

The daily check should prevent most unexpected demand increases from becoming stockouts. It must not wait for the physical store to reach zero before reacting.

## 7. Expected-demand forecast

Create a side-effect-free forecaster that returns kilograms required per store per day:

```ts
export type DemandForecast = Readonly<Record<StoreId, readonly number[]>>;

export type DemandForecastResult = {
  fromDay: number;
  throughDay: number;
  demandKg: DemandForecast;
  explanation: readonly DemandForecastLine[];
};
```

The forecast uses expected values. It does not create or mutate authoritative animals.

### 7.1 Growing pigs

For each current batch or stage group:

1. Begin with current head count, average weight, stage and destination.
2. Advance weight using configured expected daily gain and the currently observable housing effect.
3. Move expected demand to the next ration when the group reaches its next stage threshold.
4. Apply expected survival through the stage mortality rate.
5. Stop market-pig demand at the expected eligible sale date.
6. Continue replacement-gilt demand through the configured breeding path.

The demand forecast may carry fractional expected head. The authoritative engine must continue to contain whole animals.

### 7.2 Breeding herd

Forecast sow and boar feed from animals currently standing on the farm, their states and known scheduled events.

Known pregnant sows use their known due dates. Lactating sows use known weaning dates. Open females use their next observable service opportunity.

### 7.3 Services and future litters

Services due within the forecast affect expected future demand:

```text
expected conceptions = services due × conception rate
expected litters = expected conceptions that reach a due date inside the horizon
expected live births = expected litters × born alive per litter
expected survivors = expected live births × stage survival
```

These expected piglets contribute creep, weaner and later ration demand when their expected ages enter those periods.

Missed-heat and heat-detection rates must shift expected service timing rather than being ignored. Artificial insemination and boar capacity affect whether a service can reasonably be expected to occur.

### 7.4 Gas and bedding

Gas demand follows expected animals within the configured heated age and the existing consumption rule.

Bedding demand follows expected animals actually housed, using the existing per-head rule and expected housing path.

### 7.5 Information boundary

The forecaster may read current animals and batches, observed weights and stages, detected reproductive states, known due/weaning/service dates, configured expected rates, current housing, stores and pending deliveries.

It must not read scheduled future deaths, future random draws, future engine records, a completed probe run, or any state obtained by advancing the authoritative world beyond today.

Enforce this boundary by passing an immutable forecast context, never `World` or `Engine`.

## 8. Coverage calculation

For store `s`, an order placed on day `d` has arrival day and target day:

```text
A = d + leadDays
T = A + targetCoverDays
```

Use half-open day ranges because the engine receives a delivery before feeding on its arrival day. Project stock immediately after deliveries arrive on `A`, but before that day's consumption:

```text
stockAtArrival(s) =
  heldToday(s)
  + confirmedDeliveriesArrivingOnOrBeforeA(s)
  - forecastDemand[s, d, A)
```

Calculate the unrounded order requirement:

```text
requiredKg(s) =
  forecastDemand[s, A, T)
  + safetyStockAtT(s)
  - max(stockAtArrival(s), 0)
  - confirmedDeliveries[s, (A, T)]
```

Then clamp at zero, round up to the store's purchase unit, cap at projected free storage on arrival, and pass the resulting claims to load planning.

Safety stock is expected demand over `safetyCoverDays`. It is explicit and reported separately from the 90-day working stock: on the common target date each store should have reached its safety floor, not physical zero.

Coverage is measured using the forecast curve, not `quantity / today's rate`. This matters when a farrowing batch, weaning or stage transition changes consumption inside the 90 days.

## 9. Equalising cover under constraints

If all requested goods fit, order them as calculated.

If they do not fit:

1. Protect every store through its lead time plus safety period.
2. Rank stores by earliest projected exhaustion date.
3. Allocate the next purchase unit to the store with the earliest coverage date.
4. Recalculate that store's coverage date.
5. Continue until vehicle or store capacity is exhausted.

This max-min coverage rule raises the least-covered store first. It naturally accounts for 50 kg bags and 48 kg canisters because allocation happens in purchase units.

Vehicle capacity is a per-trip limit, not a limit on the complete 90-day order. Continue into another trip until the targets are met, the day's trip allowance is exhausted, or storage prevents further delivery. Count and cost every trip separately.

When the order requires more trips than may arrive in one day:

1. Fill today's permitted trips using the same earliest-exhaustion rule.
2. Schedule the remaining trips on the next supplier delivery day or days.
3. Recalculate storage space and forecast consumption at each later arrival rather than assuming all goods can be unloaded immediately.
4. Reject a schedule that lets a protected store cross its safety floor before its allocated trip arrives.
5. Use the emergency path if the daily delivery limit makes a normal schedule infeasible.

For example, an 8,000 kg requirement with a 2,800 kg vehicle becomes three separately costed trips: 2,800 kg, 2,800 kg and 2,400 kg. If `maxSupplyTripsPerDay` is two, the third trip is scheduled on the next available delivery day and its quantities are recalculated for that arrival.

Until supplier operating calendars are modelled, “next available delivery day” means the next calendar day. A later supplier-calendar feature may exclude weekends or closed days without changing the allocation rule.

Bedding uses the same coverage algorithm but its separate trip kind.

## 10. Proposed types

Create `src/lib/engine/planning/procurement.ts`:

```ts
export type OperationalProcurementPolicy = "reorder-point" | "rolling-cover";

export type ProcurementSnapshot = {
  day: number;
  held: StoreQuantities;
  onOrder: StoreQuantities;
  capacities: StoreQuantities;
  unitKg: StoreQuantities;
  listPrices: StoreQuantities;
  pendingOrders: readonly PendingOrderView[];
  duePayments: readonly PendingPaymentView[];
  cash: number;
  workingCapitalTarget: number;
};

export type ProcurementPlanningContext = {
  config: Readonly<PlannerConfig>;
  stores: ProcurementSnapshot;
  farm: ExpectedFarmState;
};

export type PlannedOrderLine = {
  store: StoreId;
  kg: number;
  units: number;
  projectedExhaustionDayBefore: number | null;
  projectedExhaustionDayAfter: number | null;
};

export type ProcurementDecision = {
  day: number;
  policy: OperationalProcurementPolicy;
  dispatch: "none" | "normal" | "emergency";
  arrivesDay: number | null;
  targetDay: number | null;
  lines: readonly PlannedOrderLine[];
  trips: readonly Trip[];
  expectedGoodsCost: number;
  expectedDeliveryCost: number;
  projectedInventoryValue: number;
  projectedMinimumCash: number;
  constrainedStores: readonly StoreId[];
  reason: string;
};

export interface ProcurementPolicy {
  decide(context: ProcurementPlanningContext): ProcurementDecision;
}
```

## 11. Configuration

Extend `feed` with:

```ts
operationalPolicy: z
  .enum(["reorder-point", "rolling-cover"])
  .default("reorder-point"),
rollingTargetCoverDays: z.number().int().min(14).max(180).default(90),
safetyCoverDays: z.number().int().min(0).max(30).default(3),
maxSupplyTripsPerDay: z.number().int().min(1).max(100).default(3),
```

Use a separate `rollingTargetCoverDays` field because the existing `targetCoverDays` belongs to the reorder-point policy. This preserves old plans and keeps the two policies independently understandable.

Existing package sizes, capacities, minimum orders, lead times, costs and supplier terms remain authoritative. `maxSupplyTripsPerDay` represents supplier or farm unloading throughput; vehicle capacity continues to represent one journey.

## 12. Engine integration

Refactor decision-making away from mutation:

```ts
supplies.snapshot(day): ProcurementSnapshot
forecastDemand(context, throughDay): DemandForecastResult
policy.decide(context): ProcurementDecision
supplies.place(day, decision): SupplyOrder[]
```

Implement the current behaviour as `ReorderPointProcurementPolicy` first. A parity test must prove that extracting it does not change current operational results.

`runProcurement(world)` builds an immutable context, selects the configured policy, requests a decision, books it, emits one decision event, then receives deliveries and settles invoices as it does now.

The forecaster and policy must not mutate `World`, `Supplies`, `Ledger`, batches, animals or event logs.

## 13. Cost and cash reporting

Every decision must calculate goods committed, delivery cost, emergency premium, inventory value after delivery, payables created, projected lowest cash balance, and additional funding required to preserve working capital.

Supplier terms must not make an order appear free because payment falls beyond the forecast. Report committed cost when ordered and cash movement when paid.

Do not post a fictional saving to the ledger. Savings are comparison read-outs only.

## 14. Events and explanations

Add event types:

```ts
| "ProcurementPlanRecalculated"
| "ProcurementDispatchAdvanced"
| "ProcurementPlanConstrained"
```

Emit a summary only when the calculated order or expected next dispatch materially changes. Avoid an identical “no order” event every day.

Include the reason, arrival and target dates, package quantities, coverage by store, trips, cost, inventory value, constraints, and whether dispatch moved earlier.

Example:

> Weaner feed is projected to reach safety stock four days early. The supplies truck was brought forward to 18 May and replanned through 16 August: 42 bags of feed and two gas canisters, in one trip.

## 15. UI requirements

Under procurement settings show the policy, target and safety cover, package sizes, store and vehicle capacities, maximum supply trips per day, and normal/emergency lead times.

Results should show:

- expected next dispatch and arrival;
- common target coverage date;
- projected exhaustion date for every store;
- ordered packages and kilograms;
- stores unable to reach 90 days and why;
- trip count and cost;
- average and peak inventory value;
- payables and required working capital;
- emergency orders and realised shortages.

The UI must say that 90 days is a planning target, not a guarantee.

## 16. Determinism

For the same configuration and observable starting state, the planner must produce the same forecast and order.

Use no random draws, keep stable `STORE_IDS` ordering, make package rounding deterministic, tie-break by earliest exhaustion then store order, use no wall-clock time, and document floating-point tolerances.

Changing logging, presentation or hidden future draws must not change today's decision.

## 17. Acceptance tests

### Forecasting

- A known farrowing increases sow, creep and later weaner demand on the correct dates.
- Services due contribute expected pregnancies using the configured conception rate.
- Stage transitions move consumption to the correct ration.
- Expected mortality reduces later demand without creating fractional authoritative animals.
- Hidden future random draws do not change the forecast.
- An observable service or due-date change can change it.

### Coverage and granularity

- With sufficient capacity, compatible stores finish on the same target date within one purchase unit.
- Feed orders respect the configured bag size.
- Gas orders respect the configured canister size.
- Loose feed may be ordered by kilogram.
- Zero-demand stores are not ordered merely to balance a load.
- Existing and pending stock are deducted exactly once.

### Constraints

- No delivery exceeds projected free storage on arrival.
- No trip exceeds vehicle capacity.
- The number of supply trips arriving on one day never exceeds `maxSupplyTripsPerDay`.
- Excess trips spill onto later delivery days and recalculate available storage at each arrival.
- An order requiring 8,000 kg with a 2,800 kg vehicle produces three separately charged trips.
- Bedding is not loaded on the supplies trip.
- Multiple trips are counted and costed separately.
- Capacity-constrained stores are filled as far as possible and reported.
- Lead-time demand is protected before stock is allocated to the 90-day target.

### Rolling behaviour

- Higher-than-forecast consumption moves dispatch earlier.
- Lower-than-forecast consumption delays or reduces the order.
- A material herd event triggers recalculation.
- Recalculation changes only uncommitted expectations, never confirmed orders.
- Once a truck is required, all compatible stores are recalculated to the common date.

### Emergency and compatibility

- A store unable to last until normal arrival triggers the emergency path.
- The emergency truck carries near-due compatible goods when possible.
- Emergency premiums remain correct.
- Old configs retain reorder-point golden results.
- Foresight results remain unchanged.
- Order, delivery, invoice, consumption and payment remain separate.

## 18. Performance

This design does not enumerate biological outcomes or hundreds of candidates. Its cost is approximately:

```text
forecast days × animal groups + stores × purchase units allocated
```

Forecast batches and stage groups rather than cloning individual pigs where equivalent. Cache the forecast and invalidate it when observable inputs change, but always run the cheap daily risk check.

Add a non-blocking benchmark for a 500-sow farm forecasting 90 days.

## 19. Evaluation gate

Compare rolling cover with the existing reorder-point policy across different herd sizes, storage limits, delivery costs, lead times, demand patterns and cash positions.

Measure goods committed and consumed, trips, emergency premium, shortages, restricted-animal days, inventory value, unused closing stock, payables, minimum cash, funding required, pigs sold and sale timing.

The policy succeeds when it reduces avoidable journeys and emergencies without increasing shortages or reducing output. Higher inventory and working-capital requirements must remain visible.

## 20. Rollout

1. Build and reconcile the expected-demand forecaster.
2. Extract the existing reorder rule behind the policy interface and lock parity.
3. Run rolling cover in shadow mode without applying its orders.
4. Compare forecast error, orders and cash requirements.
5. Add the opt-in setting and explanations.
6. Consider defaults only after the evaluation gate passes.

## 21. Prerequisites

Before treating projected savings as trustworthy:

- every V2 product read model must use the same engine result;
- growing pigs must follow sequential housing flow;
- growth must remain biologically bounded during queues;
- V1 seeded compatibility must be preserved or versioned;
- store, invoice and cash reconciliation tests must remain green.

The planner must not compensate for a known modelling defect.

## 22. Definition of done

The feature is complete when:

- a V2 plan can select `rolling-cover`;
- expected consumption includes growth, stage changes and services due;
- normal deliveries target a common date 90 days after arrival;
- package, storage, lead-time and vehicle constraints are enforced;
- unexpectedly fast consumption advances and replans dispatch;
- no hidden future outcome informs today's decision;
- decisions are deterministic and explainable;
- projections and exports expose delivery savings and working-capital cost;
- V1, foresight and reorder-point golden results remain unchanged.
