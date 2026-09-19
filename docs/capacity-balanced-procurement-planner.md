# Capacity-Balanced Rolling Procurement Planner

**Status:** proposed engineering specification  
**Target:** PigFlow 2.0 engine  
**Initial scope:** feed, gas and bedding procurement

---

## 1. Purpose

Add an optional operational procurement policy that forecasts expected farm consumption and uses **vehicle capacity as the primary replenishment constraint**.

The planner recalculates every day.

Its operating principle is:

> When a normal supply trip becomes necessary, fill the available vehicle as close to capacity as practical with compatible supplies, allocating the load so that the covered stores are projected to reach their next safety-stock point at approximately the same time.

The common future coverage date is therefore **not configured in advance**. It emerges from:

- current stock;
- pending deliveries;
- forecast demand;
- storage capacity;
- package sizes;
- vehicle capacity;
- safety stock;
- delivery lead time.

This is a rolling replenishment planner, not a perfect-foresight simulation and not a Monte Carlo optimiser. It calculates one transparent expected-demand curve from the farm's currently observable state.

---

## 2. Core operating rule

For each compatible delivery class:

1. Forecast expected daily demand for each store.
2. Project each store's stock and safety-stock breach date.
3. Do nothing while every store can safely last until a normal delivery ordered later could arrive.
4. When a store becomes due, schedule a normal supply trip using the configured delivery lead time.
5. Protect all urgent stores through the arrival date and safety period.
6. Fill the remaining vehicle capacity by repeatedly allocating the next purchase unit to the store with the **earliest projected next safety-stock date**.
7. Stop when:
   - the vehicle is full;
   - all compatible stores are constrained by storage;
   - no compatible store has positive forecast demand worth bringing forward;
   - or package-size rounding prevents further loading.
8. The earliest projected safety-stock date after allocation becomes the expected next replenishment point.
9. Recalculate again tomorrow from actual observed state.

The planner therefore solves:

> **Given this truck's available payload, how should it be distributed so the stores run down together as closely as possible?**

It does **not** solve:

> "How much must be purchased to reach a fixed number of days of cover?"

---

## 3. Why this policy exists

For fixed feed rates and prices, most goods cost is driven by consumption. Procurement savings therefore come mainly from:

- avoiding emergency premiums;
- avoiding half-empty journeys;
- combining near-due compatible goods;
- reducing unnecessary early stock purchases;
- preventing stockouts that reduce growth;
- respecting physical storage;
- improving working-capital timing.

The policy is not guaranteed to minimise every cost measure. A fuller truck can bring some products forward earlier than strictly necessary and therefore increase inventory value temporarily.

PigFlow must report:

- goods committed;
- delivery cost;
- inventory value;
- payables;
- minimum cash;
- additional funding requirement;
- emergency orders;
- stockouts;
- trip utilisation.

No reduction in trip count should automatically be described as a net saving without also showing the working-capital effect.

---

## 4. Product behaviour

Keep the existing procurement modes and add the new operational policy.

| UI choice | Stored configuration | Meaning |
| --- | --- | --- |
| Perfect-foresight benchmark | `procurementMode: "foresight"` | Existing best-case logistics benchmark. |
| Reorder-point | `procurementMode: "operational"`, `operationalPolicy: "reorder-point"` | Existing operational behaviour. |
| Capacity-balanced rolling plan | `procurementMode: "operational"`, `operationalPolicy: "balanced-load"` | Policy defined in this specification. |

Existing plans default to `reorder-point`, preserving current results.

`balanced-load` is available only on engine 2.0.

---

## 5. Supply compatibility

Feed and gas may share the supplies vehicle.

Bedding remains a separate trip kind under the current transport model.

A compatible store may ride on a truck that was triggered by another store, but only when:

- it has positive forecast demand;
- bringing stock forward is operationally sensible;
- storage capacity allows it;
- and the allocation improves vehicle utilisation without endangering a more urgent store.

A zero-demand store must never receive stock merely to fill the vehicle.

---

## 6. Daily process

Every simulated morning, before new orders are placed:

1. Observe current animals, batches, stores, pending orders and known farm calendar.
2. Forecast expected daily consumption through a sufficiently long rolling horizon.
3. Project stock and safety-stock dates for every store using confirmed pending deliveries.
4. Determine the earliest date each store would need a new normal delivery.
5. If no store requires an order today, place no order.
6. If a normal trip is required:
   - calculate arrival day from normal lead time;
   - calculate the load using the capacity-balancing algorithm;
   - book only today's confirmed order.
7. If a store cannot survive until normal arrival:
   - invoke the emergency path;
   - protect the urgent store first;
   - then use spare vehicle capacity for compatible near-due goods.
8. Repeat the entire calculation the next morning from observed reality.

Unplaced future deliveries are forecasts only. They are never committed.

---

## 7. Dispatch trigger

Let:

```text
risk date = earliest projected day a required store falls below safety stock
normal arrival = today + normal delivery lead days
```

Place a normal order today when:

```text
risk date <= normal arrival
```

Also re-evaluate immediately when:

- actual consumption exceeds forecast;
- a farrowing, weaning or stage transition changes expected demand materially;
- a known service or pregnancy state changes;
- a pending delivery is delayed;
- a store runs short;
- storage availability changes materially.

The planner must not wait for physical stock to reach zero before reacting.

### 7.1 Emergency trigger

Use an emergency delivery only when a required store is projected to become physically empty before a normal delivery could arrive.

Dipping into safety stock alone does not justify an emergency premium.

---

## 8. Expected-demand forecast

Create a side-effect-free forecaster returning kilograms required per store per day:

```ts
export type DemandForecast = Readonly<Record<StoreId, readonly number[]>>;

export type DemandForecastResult = {
  fromDay: number;
  throughDay: number;
  demandKg: DemandForecast;
  explanation: readonly DemandForecastLine[];
};
```

The forecast uses expected values and must not create or mutate authoritative animals.

### 8.1 Growing pigs

For each current batch or stage group:

1. Begin with current head count, average weight, stage and destination.
2. Advance expected weight using configured daily gain and observable housing effects.
3. Move expected demand to the next ration when stage thresholds are reached.
4. Apply expected survival using configured stage mortality.
5. Stop market-pig demand at the expected sale date.
6. Continue replacement-gilt demand through the breeding path.

Fractional expected head counts may exist in the forecast only. Authoritative engine animals remain whole.

### 8.2 Breeding herd

Forecast sow and boar feed from animals currently standing on the farm.

Known pregnant sows use known due dates.

Lactating sows use known weaning dates.

Open females use their next observable service opportunity.

### 8.3 Services and future litters

Services due within the forecast influence expected future demand:

```text
expected conceptions = services due × conception rate
expected litters = expected conceptions reaching due date in horizon
expected live births = expected litters × born alive per litter
expected survivors = expected live births × stage survival
```

Expected offspring contribute to creep, weaner, grower and finisher demand when their expected ages enter those stages.

Missed heats, heat-detection probability, AI availability and boar capacity must shift expected timing rather than being ignored.

### 8.4 Gas

Gas demand follows expected heated piglets under the configured heating-age and consumption rules.

Gas is treated as a normal compatible supplies store.

It may trigger a supply trip when it cannot safely last until a normal delivery would arrive.

Its storage capacity is authoritative.

If small gas storage repeatedly determines supply-trip spacing, that is a legitimate operational result and should be visible in reporting.

### 8.5 Bedding

Bedding demand follows expected animals actually housed, using the existing per-head rule and expected housing path.

Bedding uses a separate delivery kind.

### 8.6 Information boundary

The forecaster may read:

- current animals and batches;
- observed weights and stages;
- detected reproductive states;
- known due, weaning and service dates;
- configured expected biological rates;
- current housing;
- stores;
- confirmed pending deliveries.

It must not read:

- future random draws;
- scheduled future deaths not yet observable;
- future authoritative engine records;
- completed probe runs;
- state obtained by advancing the authoritative world beyond today.

Pass an immutable forecast context, never `World` or `Engine`.

---

## 9. Stock projection

For store `s`, projected stock at future day `i` is:

```text
stock(s, i)
=
heldToday(s)
+ confirmedDeliveriesThrough(i)
- forecastDemand[today, i)
```

Safety stock on day `i` is:

```text
safetyStock(s, i)
=
forecastDemand[i, i + safetyCoverDays)
```

A store's risk date is the first day where:

```text
stock(s, i) < safetyStock(s, i)
```

A store's empty date is the first day where:

```text
stock(s, i) < 0
```

Coverage must be measured using the forecast demand curve, not:

```text
quantity / today's consumption rate
```

because consumption changes with farrowing, weaning, growth and stage transitions.

---

## 10. Load allocation objective

When a trip is required, vehicle capacity is fixed:

```text
available payload = truckCapacityKg
```

The planner allocates that capacity across compatible stores.

The primary objective is:

> Maximise the earliest projected next safety-stock date across the compatible stores.

Equivalent operational interpretation:

> Give the next purchase unit to whichever store would otherwise need replenishment first.

This is a max-min coverage rule.

### 10.1 Allocation sequence

For each trip:

1. Protect stores that would become unsafe before or shortly after arrival.
2. Allocate mandatory quantities required to prevent stockout.
3. With remaining payload:
   - calculate each store's projected next safety-stock date;
   - identify the store with the earliest date;
   - allocate one purchase unit to that store;
   - recalculate its projected date;
   - repeat.
4. Continue until the vehicle is full or no further sensible allocation is possible.

### 10.2 Purchase units

Examples:

- feed: whole 50 kg bags when `feedBagKg = 50`;
- gas: whole 48 kg canister fills when `gasCanisterKg = 48`;
- loose feed: kilogram or configured allocation increment;
- bedding: configured bedding load unit.

A minimum order quantity applies only when a store has a **positive calculated requirement**.

It must never turn a zero requirement into a positive order.

---

## 11. Full-truck principle

A normal supply trip should arrive as close to configured vehicle capacity as practical.

A materially under-filled normal trip is acceptable only when one or more of the following is true:

- compatible stores lack sufficient forecast demand;
- storage cannot accept more;
- package-size rounding prevents additional loading;
- adding more stock would be economically or operationally nonsensical;
- simulation end prevents meaningful consumption;
- the trip is an emergency and waiting would create a stockout.

The planner should report vehicle utilisation:

```text
utilisationPct = payloadKg / truckCapacityKg × 100
```

Low-utilisation normal trips should be visible in diagnostics.

---

## 12. The next-trip date is an output

After the truck is allocated, calculate every compatible store's new risk date.

The expected next supply requirement is:

```text
next risk date = minimum(projected risk date of compatible stores)
```

The expected order date is approximately:

```text
next dispatch day = next risk date - normal delivery lead days
```

This date is advisory only.

Tomorrow's calculation may move it earlier or later as observed reality changes.

There is no fixed 90-day replenishment target.

---

## 13. Storage-constrained stores

Storage capacity is authoritative.

A store stops receiving allocation when its projected physical capacity would be exceeded.

If one store repeatedly reaches capacity yet still becomes the earliest-risk store, PigFlow should expose this as an operational constraint.

Example:

> Gas storage reaches capacity at 192 kg and is still projected to become the next limiting supply in 18 days.

The optimizer must not compensate by creating fictitious capacity or by silently forcing another store's policy onto it.

This allows the model to reveal when additional bins, silos or gas canisters could economically increase delivery spacing.

---

## 14. Multiple trips

Vehicle capacity is a per-trip limit.

The policy should **not** automatically create enough consecutive trips to satisfy an arbitrary long coverage horizon.

A second normal trip is justified only when:

- one full trip cannot protect required stores until another normal trip could subsequently arrive; or
- current demand is so large that multiple trips are already operationally required to avoid shortage.

Where multiple trips are required:

1. fully allocate the first trip;
2. recalculate store positions after that committed load;
3. decide whether another trip is genuinely required;
4. repeat.

`maxSupplyTripsPerDay` limits supplier/farm unloading throughput.

Each trip is counted and costed separately.

---

## 15. Emergency behaviour

If a store cannot survive until normal arrival:

1. use emergency lead time and premium;
2. calculate the minimum quantity required to protect the urgent store;
3. use remaining vehicle capacity for compatible stores with positive forecast demand, applying the same earliest-risk allocation rule;
4. do not leave avoidable empty payload while another compatible store will predictably need stock soon;
5. do not buy dormant or zero-demand products merely to fill the truck.

Emergency orders should remain exceptional.

---

## 16. Proposed types

Create or update:

`src/lib/engine/planning/procurement.ts`

```ts
export type OperationalProcurementPolicy =
  | "reorder-point"
  | "balanced-load";

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
  projectedRiskDayBefore: number | null;
  projectedRiskDayAfter: number | null;
};

export type ProcurementDecision = {
  day: number;
  policy: OperationalProcurementPolicy;
  dispatch: "none" | "normal" | "emergency";
  arrivesDay: number | null;
  lines: readonly PlannedOrderLine[];
  trips: readonly Trip[];
  expectedGoodsCost: number;
  expectedDeliveryCost: number;
  projectedInventoryValue: number;
  projectedMinimumCash: number;
  constrainedStores: readonly StoreId[];
  nextDispatchDay: number | null;
  vehicleUtilisationPct: number | null;
  reason: string;
};

export interface ProcurementPolicy {
  decide(context: ProcurementPlanningContext): ProcurementDecision;
}
```

A fixed `targetDay` is no longer required for the balanced-load policy.

If retained for shared UI compatibility, it should mean:

> the common coverage date approximately achieved by the final allocation

rather than a configured target.

---

## 17. Configuration

Suggested configuration:

```ts
operationalPolicy: z
  .enum(["reorder-point", "balanced-load"])
  .default("reorder-point"),

safetyCoverDays: z.number().int().min(0).max(30).default(3),

maxSupplyTripsPerDay: z.number().int().min(1).max(100).default(3),

normalTripMinimumUtilisationPct: z
  .number()
  .min(0)
  .max(100)
  .default(90),
```

Existing:

- package sizes;
- capacities;
- minimum orders;
- lead times;
- prices;
- supplier terms;
- trip costs

remain authoritative.

`normalTripMinimumUtilisationPct` is a reporting/diagnostic target, not permission to delay a trip that is required to prevent shortage.

Remove `rollingTargetCoverDays` from this policy.

It may remain for backward compatibility if an earlier `rolling-cover` policy is retained separately.

---

## 18. Engine integration

Refactor decision-making away from mutation:

```ts
supplies.snapshot(day): ProcurementSnapshot
forecastDemand(context, throughDay): DemandForecastResult
policy.decide(context): ProcurementDecision
supplies.place(day, decision): SupplyOrder[]
```

`runProcurement(world)` should:

1. receive or expose all opening inventory due today;
2. build an immutable current-state context;
3. select the configured procurement policy;
4. request a decision;
5. book confirmed orders;
6. emit decision events;
7. receive deliveries and settle invoices under existing accounting rules.

Opening inventory must be visible before the first procurement decision.

The planner must not compensate for initialization sequencing defects.

---

## 19. Startup inventory rule

Before the first procurement decision:

- all opening inventory must already be present in `held`; or
- a seeded delivery must exist as a confirmed pending delivery visible to the planner.

The planner must never make a day-0 purchase decision against an artificially empty store snapshot when opening stock is about to be injected later in the same simulation day.

---

## 20. Minimum-order rule

Minimum order quantities apply only after a positive need has been established.

Required invariant:

```text
calculated requirement = 0
=> ordered quantity = 0
```

Not:

```text
calculated requirement = 0
minimum order = 500 kg
=> ordered quantity = 500 kg
```

Similarly:

```text
forecast demand = 0
and current consumption = 0
=> store is not due
```

An empty dormant store is not automatically a required store.

---

## 21. Cost and cash reporting

Every procurement decision must calculate:

- goods committed;
- delivery cost;
- emergency premium;
- projected inventory value;
- supplier payables;
- projected minimum cash;
- additional working capital required;
- trip utilisation;
- forecast next dispatch.

Supplier terms must not make an order appear free merely because payment falls outside the immediate cash horizon.

Report committed cost when ordered and cash movement when paid.

Do not post fictional procurement "savings" to the ledger.

Savings are comparison read-outs only.

---

## 22. Events and explanations

Suggested event types:

```ts
| "ProcurementPlanRecalculated"
| "ProcurementDispatchAdvanced"
| "ProcurementPlanConstrained"
| "ProcurementLowUtilisation"
```

Emit a summary only when:

- an order is placed;
- expected next dispatch changes materially;
- a constraint becomes active;
- a normal trip is materially under-utilised.

Example:

> Sow feed is projected to reach safety stock first. A supply truck will arrive on 18 May. The 2,900 kg payload was balanced across sow, weaner, grower, finisher feed and gas. After delivery, the next projected supply risk is 11 July, driven by gas.

Another example:

> Gas storage reached its 192 kg capacity. Although the feed stores would last longer, gas is projected to determine the next supply trip in 18 days.

---

## 23. UI requirements

Under procurement settings show:

- operational policy;
- safety-cover days;
- package sizes;
- store capacities;
- vehicle capacity;
- maximum trips per day;
- normal and emergency lead times;
- trip costs.

Results should show:

- next expected dispatch;
- next expected arrival;
- projected risk date for every store;
- ordered packages and kilograms;
- vehicle payload and utilisation percentage;
- constrained stores and reason;
- trip count and cost;
- average and peak inventory value;
- payables;
- required working capital;
- emergency orders;
- realised shortages;
- which store is currently expected to trigger the next trip.

The UI must not describe a fixed coverage period because the balanced-load policy does not have one.

---

## 24. Determinism

For the same configuration and observable starting state, the planner must produce the same forecast and order.

Use:

- no random draws;
- stable store ordering;
- deterministic package rounding;
- deterministic tie-breaking;
- no wall-clock time;
- documented floating-point tolerances.

Where stores have the same projected risk date, tie-break by stable `STORE_IDS` order.

Changing logging, presentation or hidden future draws must not alter today's decision.

---

## 25. Acceptance tests

### Forecasting

- Known farrowing increases sow, creep and later weaner demand on the correct dates.
- Services due contribute expected pregnancies using configured conception rate.
- Stage transitions move demand to the correct ration.
- Expected mortality reduces later demand without creating fractional authoritative animals.
- Hidden future random draws do not alter the forecast.
- Observable reproductive changes may alter the forecast.

### Dormant stores

- Zero-demand stores are not ordered merely to fill a truck.
- An empty zero-demand store is not marked due.
- Minimum-order rules do not turn a zero need into an order.
- Feed for a future stage outside the economically relevant forecast window is not purchased without reason.

### Startup

- Opening stock is visible before the first procurement decision.
- Seeded day-0 deliveries are included exactly once.
- A farm opening with adequate sow feed does not immediately order duplicate sow feed.

### Dispatch

- No order is placed while every store can safely wait.
- A store reaching safety stock before normal arrival triggers a normal order.
- A store becoming physically empty before normal arrival triggers emergency procurement.
- Higher-than-forecast consumption can advance dispatch.
- Lower-than-forecast consumption can delay dispatch.

### Full-truck behaviour

- A normal trip with enough compatible demand is filled to vehicle capacity within one purchase unit.
- Remaining capacity goes to the store with the earliest projected risk date.
- Allocation raises the earliest risk date before extending better-covered stores.
- Package sizes are respected.
- Storage capacities are respected.
- Vehicle capacity is never exceeded.
- Normal low-utilisation trips are reported.

### Equal-exhaustion behaviour

Given sufficient compatible demand and storage:

- projected post-delivery risk dates converge as closely as package granularity permits;
- the earliest post-delivery risk date is maximised;
- the resulting next-trip date is derived from those risk dates, not from a fixed cover setting.

### Capacity constraints

- A full gas store receives no more gas.
- Remaining truck capacity is reassigned to other compatible stores.
- A storage-constrained store may still become the next trip trigger.
- The decision reports the constraint.

### Multiple trips

- One trip does not automatically create a second trip merely to extend coverage.
- A second trip is created only if one load cannot protect required stores until another normal trip could later arrive.
- Each trip is separately costed.
- `maxSupplyTripsPerDay` is respected.

### Emergency

- Emergency trips protect the urgent store first.
- Spare emergency payload carries compatible near-due goods where sensible.
- Emergency premiums remain correct.
- Zero-demand goods are not loaded merely to fill the emergency truck.

### Compatibility

- Feed and gas may share supply trips.
- Bedding uses a separate trip kind.
- Existing reorder-point golden results remain unchanged.
- Perfect-foresight results remain unchanged.
- Order, delivery, invoice, consumption and payment remain separate events.

---

## 26. Performance

This design does not enumerate biological futures.

Approximate cost:

```text
forecast days × animal groups
+
stores × purchase units allocated
```

Forecast batches and stage groups rather than cloning equivalent individual pigs.

Cache forecasts where safe, but always run the cheap daily risk check.

Add a non-blocking benchmark for a 500-sow farm.

---

## 27. Evaluation gate

Compare `balanced-load` against:

- existing reorder-point;
- perfect-foresight benchmark;
- any retained fixed-cover policy.

Test across:

- herd sizes;
- storage capacities;
- truck capacities;
- package sizes;
- delivery costs;
- lead times;
- demand patterns;
- supplier terms;
- cash positions.

Measure:

- goods committed;
- goods consumed;
- supply trips;
- average truck utilisation;
- low-utilisation trips;
- emergency premiums;
- shortages;
- restricted-animal days;
- inventory value;
- unused closing stock;
- payables;
- minimum cash;
- additional funding required;
- pigs sold;
- sale timing.

The policy succeeds when it reduces avoidable journeys and emergencies without increasing shortages or reducing output, while keeping working-capital effects visible.

---

## 28. Rollout

1. Build and reconcile the expected-demand forecaster.
2. Keep the existing reorder rule behind the policy interface and lock parity.
3. Implement `balanced-load` in shadow mode.
4. Compare orders, trip utilisation, forecast error and cash requirement.
5. Add explicit startup-inventory tests.
6. Add dormant-store and minimum-order regression tests.
7. Add the opt-in UI setting.
8. Compare against real event-log outputs.
9. Consider defaults only after evaluation passes.

---

## 29. Prerequisites

Before treating projected savings as trustworthy:

- every V2 product read model must use the same engine result;
- growing pigs must follow sequential housing flow;
- growth must remain biologically bounded during queues;
- store and invoice reconciliation must remain green;
- opening inventory must be visible before planning;
- pending deliveries must be deducted exactly once;
- V1 seeded compatibility must be preserved or versioned.

The planner must not compensate for known modelling defects.

---

## 30. Definition of done

The feature is complete when:

- a V2 plan can select `balanced-load`;
- expected consumption includes growth, stage changes and services due;
- normal dispatch occurs only when a store requires protection;
- each normal trip is filled as far as compatible demand, storage and package rules allow;
- load allocation equalises projected next risk dates as closely as practical;
- vehicle capacity determines the resulting replenishment interval;
- no fixed cover period drives the order quantity;
- zero-demand stores remain unordered;
- minimum-order rules never create demand;
- opening inventory is visible before the first decision;
- storage constraints are reported rather than hidden;
- unexpectedly fast consumption advances dispatch;
- no hidden future outcome informs today's decision;
- decisions are deterministic and explainable;
- projections expose delivery cost, utilisation, inventory and working-capital effects;
- reorder-point and foresight results remain unchanged.
