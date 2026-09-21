# Pigflow Spec: Inventory-Adjusted Profit & Farm Valuation

## Status

**Proposed / experimental**

This feature must **not replace the existing Profit & Loss calculation**.

Pigflow should continue to calculate and display the current P&L exactly as it does today. The new accounting model should run **in parallel** so that both approaches can be compared on the same simulation.

---

## 1. Purpose

Pigflow currently calculates profit primarily from period income less period expenditure.

That calculation is useful, but during herd expansion it can make a farm appear less profitable because costs may be incurred for animals that are still on the farm at the end of the period and have not yet generated sales revenue.

The proposed model introduces:

1. **Inventory-adjusted P&L**
2. **Livestock inventory valuation**
3. **Breeding-stock valuation**
4. **Feed and supplies inventory valuation**
5. **Farm net worth / balance-sheet view**

The objective is to answer two different questions separately:

- **Current P&L:** "How much income was earned less expenditure incurred in this period?"
- **Inventory-adjusted P&L:** "How much economic profit was generated after accounting for costs retained in unsold livestock and breeding assets?"

Both should remain visible.

---

## 2. Non-goals

This proposal does **not** attempt to:

- replace the existing P&L;
- create a tax-compliant accounting system;
- create IFRS-compliant biological-asset fair-value accounting;
- value livestock using expected future selling price;
- recognize unrealised profit on animals that have not been sold;
- redesign the cashflow engine;
- change procurement behaviour;
- change biological simulation outcomes.

The new model is primarily a **management-accounting view**.

---

## 3. Core Principle

Costs should move through the farm according to what they become.

Example:

```text
Cash / Payable
    ↓
Feed Inventory
    ↓ consumed
Livestock WIP
    ↓ sold
Cost of Sales
```

For a market pig, production costs remain attached to the pig while it is alive and unsold.

The cost becomes an expense in the inventory-adjusted P&L when:

- the pig is sold;
- the pig dies;
- the pig is otherwise written off.

This prevents the model from immediately expensing production costs that have instead created livestock inventory.

---

## 4. Accounting Views

Pigflow should expose three independent financial views.

### 4.1 Existing P&L

Keep the current calculation unchanged.

Conceptually:

```text
Income
- Expenditure
= Current Profit / Loss
```

This remains the baseline implementation.

### 4.2 Inventory-Adjusted P&L

New experimental calculation.

Conceptually:

```text
Sales Revenue
- Cost of Livestock Sold
= Gross Profit

- Breeding Herd Operating Costs
- Labour
- Overheads
- Breeding Stock Depreciation
- Mortality / Write-off Losses
= Inventory-Adjusted Operating Profit
```

### 4.3 Cash Flow

No change.

```text
Cash Received
- Cash Paid
= Net Cash Flow
```

Profit and cash flow must continue to be treated as different concepts.

---

## 5. Asset Categories

At any simulation date, Pigflow should be able to calculate the farm's assets and liabilities.

### 5.1 Cash

Value:

```text
Current cash balance
```

### 5.2 Feed Inventory

Value unused feed at its inventory cost.

Preferred method:

**Weighted average cost**

Example:

```text
500 kg @ $0.50 = $250
1,000 kg @ $0.56 = $560

Total:
1,500 kg = $810

Weighted average:
$810 / 1,500 = $0.54/kg
```

If 600 kg remains:

```text
600 × $0.54 = $324 inventory value
```

### 5.3 Other Consumable Supplies

Examples:

- bedding;
- heating gas;
- vaccines where unopened inventory is explicitly modelled;
- other stored consumables.

Value at accumulated inventory cost.

### 5.4 Market Livestock WIP

Includes animals intended for eventual market sale:

- piglets;
- weaners;
- growers;
- finishers.

Each animal should carry an accumulated production cost.

Example:

```text
Piglet costs       $8
Weaner costs      $17
Grower costs      $35
Finisher costs    $55
---------------------
Book value       $115
```

Until sold, the $115 remains livestock inventory.

### 5.5 Replacement Gilt WIP

A female selected for breeding should move from market livestock WIP into replacement livestock WIP.

Her existing accumulated cost must move with her.

Additional directly attributable development costs should continue increasing her carrying value until promotion into the breeding herd.

### 5.6 Breeding Sows

When a replacement gilt enters the breeding herd, her accumulated replacement cost becomes her initial breeding-asset value.

Example:

```text
Replacement gilt carrying value at promotion: $400
Expected cull value:                         $150
Cull after parity:                               6
```

Depreciable amount:

```text
$400 - $150 = $250
```

Straight-line depreciation per parity:

```text
$250 / 6 = $41.67 per parity
```

Illustrative values:

| Status | Carrying Value |
|---|---:|
| Parity 0 | $400.00 |
| Parity 1 | $358.33 |
| Parity 2 | $316.67 |
| Parity 3 | $275.00 |
| Parity 4 | $233.33 |
| Parity 5 | $191.67 |
| Parity 6 | $150.00 |

Formula:

```text
sowCarryingValue =
    initialBreedingValue
    - depreciationPerParity × currentParity
```

Minimum carrying value:

```text
expectedCullValue
```

The sow's ordinary feed, veterinary costs, AI/semen and routine breeding costs should **not** continuously increase the sow asset value.

Those are breeding-herd operating costs.

### 5.7 Boars

Boars should be depreciated by working life rather than parity.

Example:

```text
Purchase cost:       $500
Residual value:      $140
Working life:          24 months
```

Monthly depreciation:

```text
($500 - $140) / 24 = $15/month
```

Formula:

```text
boarCarryingValue =
    purchaseCost
    - monthlyDepreciation × monthsInService
```

Minimum:

```text
boarResidualValue
```

Pigflow may require a new configuration field:

```text
boarResidualValue
```

or:

```text
boarCullSaleValue
```

---

## 6. Cost Attribution

The new model should distinguish between costs that become livestock inventory and costs that remain period expenses.

### 6.1 Costs Capitalised Into Market Pig WIP

Examples:

- feed consumed by the pig;
- pig-specific veterinary treatment;
- vaccinations;
- pig processing costs;
- heating attributable to piglets;
- bedding allocation, if the model chooses to allocate it;
- other direct animal-level production costs.

These costs should move with the animal.

### 6.2 Costs Capitalised Into Replacement Gilt WIP

Includes:

- all accumulated market-pig cost before selection;
- developer/replacement feed;
- directly attributable replacement-health costs;
- directly attributable development costs.

### 6.3 Period Expenses

Examples:

- general labour;
- administration;
- fixed overheads;
- routine breeding herd feed;
- sow veterinary care;
- AI/semen;
- routine boar costs;
- general transport not directly attributable to a specific inventory asset;
- financing costs;
- other non-capitalisable overheads.

The exact allocation policy should remain explicit and testable.

---

## 7. Sale Accounting

When a market pig is sold:

```text
Revenue = sale proceeds
Cost of Sales = pig accumulated carrying cost
Inventory reduction = pig accumulated carrying cost
```

Example:

```text
Sale proceeds:             $150
Pig carrying value:        $115
--------------------------------
Gross margin:               $35
```

No inventory gain should be recognised before sale.

---

## 8. Mortality Accounting

When an animal dies, its carrying value must be removed from inventory.

Example:

```text
Grower carrying value: $62
```

Record:

```text
Mortality loss:        $62
Livestock inventory:  -$62
```

This gives mortality a realistic financial effect.

A 95 kg finisher death should normally produce a larger economic loss than a recently weaned pig death.

---

## 9. Sow Death / Early Cull

If a breeding sow leaves the herd before planned cull:

```text
Loss or gain =
    proceeds received
    - current carrying value
```

Example:

```text
Current carrying value: $275
Cull proceeds:           $150

Loss on disposal:        $125
```

If the sow dies and no proceeds are received:

```text
Loss = full current carrying value
```

---

## 10. Boar Disposal

Same principle:

```text
gainOrLoss =
    disposal proceeds
    - current carrying value
```

---

## 11. Farm Net Worth

At every simulated day, Pigflow should be capable of calculating:

```text
Cash
+ Feed inventory
+ Other supplies inventory
+ Market livestock WIP
+ Replacement gilt WIP
+ Breeding sow carrying value
+ Boar carrying value
+ Other modelled farm assets
- Supplier payables
- Other liabilities
= Farm Net Worth
```

Example:

| Item | Value |
|---|---:|
| Cash | $4,500 |
| Feed inventory | $3,200 |
| Market pigs | $18,700 |
| Replacement gilts | $2,800 |
| Breeding sows | $8,500 |
| Boars | $900 |
| **Gross assets** | **$38,600** |
| Supplier payables | -$5,100 |
| **Farm net worth** | **$33,500** |

This valuation should be available for any day in the simulation.

---

## 12. Book Value vs Estimated Market Value

The core accounting model should use **cost-based book value**.

Do not value unsold pigs at expected selling price for the purpose of profit.

Future enhancement:

Pigflow may show a separate informational figure:

```text
Book value:                 $82
Estimated realizable value: $121
```

Estimated realizable value must not feed into inventory-adjusted profit unless a later accounting model explicitly chooses fair-value accounting.

---

## 13. Inventory-Adjusted Profit Formula

At period level, one valid reconciliation is:

```text
Inventory-adjusted profit =
    Current P&L
    + Closing capitalised livestock costs
    - Opening capitalised livestock costs
    - Breeding asset depreciation adjustments
    - Inventory write-offs
    ± disposal adjustments
```

However, the preferred implementation is to build the new P&L from explicit accounting movements rather than apply a single adjustment to the existing P&L.

Preferred statement:

```text
Pig sales revenue
+ Gilt sales
+ Cull sales
+ Other operating revenue
- Cost of livestock sold
- Mortality/write-off losses
- Breeding operating costs
- Labour
- Overheads
- Breeding stock depreciation
- Other period expenses
= Inventory-adjusted operating profit
```

---

## 14. Comparison With Existing P&L

The primary product requirement is comparison.

Pigflow should display both calculations side by side.

Example:

| Metric | Current P&L | Inventory-Adjusted P&L |
|---|---:|---:|
| Year 1 | -$19,122 | -$15,400 |
| Year 2 | -$29,795 | -$18,900 |
| Year 3 | +$11,102 | +$19,600 |
| Year 4 | +$19,640 | +$20,200 |
| Year 5 | +$21,115 | +$20,700 |
| 5-year average | $317 | $5,240 |

The exact figures above are illustrative only.

The UI should clearly label the new measure as:

**Experimental: Inventory-Adjusted P&L**

until the implementation has been validated.

---

## 15. P&L Reconciliation

Each period should expose a reconciliation explaining why the two profit figures differ.

Example:

```text
Current P&L                         $2,000

Add:
Increase in market livestock WIP   $4,500
Increase in replacement WIP        $1,200

Less:
Breeding stock depreciation         $700
Mortality inventory write-offs      $300

Inventory-adjusted P&L             $6,700
```

This is important because users must be able to understand why the figures diverge.

---

## 16. Balance Sheet / Farm Worth View

Add an experimental view:

**Farm Worth**

Suggested sections:

### Assets

```text
Cash
Feed & supplies
Market livestock
Replacement gilts
Breeding sows
Boars
Other assets
```

### Liabilities

```text
Supplier payables
Bank overdraft
Other liabilities
```

A bank balance below zero is a liability and not an asset worth less than
nothing. An overdrawn account is borrowing, and carrying it as negative cash
understates both sides of the sheet while leaving the net worth correct — so a
plan being funded reads as smaller than it is rather than as borrowed against.

```text
assetCash  = max(0, cash)
overdraft  = max(0, -cash)
```

### Result

```text
Farm Net Worth
```

The view should support:

- current simulation date;
- month-end;
- year-end;
- comparison between plans;
- change in net worth over time.

---

## 17. Suggested Data Model

The implementation should avoid recomputing historical cost from scratch where practical.

### Market Pig

Potential fields:

```ts
inventoryCost: number
```

Optionally broken down:

```ts
inventoryCost: {
  feed: number
  health: number
  heating: number
  bedding: number
  other: number
}
```

### Replacement Gilt

```ts
replacementInventoryCost: number
```

### Sow

```ts
initialBreedingValue: number
currentCarryingValue: number
accumulatedDepreciation: number
```

Current carrying value can also be derived instead of persisted if all inputs are stable.

### Boar

```ts
initialBreedingValue: number
serviceStartDay: number
currentCarryingValue: number
```

### Stores

Store inventory should retain:

```ts
quantity
totalCost
weightedAverageUnitCost
```

---

## 18. Accounting Events

Prefer explicit accounting events.

Examples:

```ts
FeedPurchased
FeedConsumed
PigCostAccumulated
PigSold
PigDied
GiltSelected
GiltPromoted
SowDepreciated
SowCulled
SowDied
BoarPurchased
BoarDepreciated
BoarDisposed
InventoryWrittenOff
```

Each event should produce deterministic accounting movements.

This makes the system easier to audit and test.

---

## 19. Daily Valuation Snapshot

Expose a read model such as:

```ts
type FarmValuation = {
  date: string

  cash: number

  inventory: {
    feed: number
    supplies: number
    marketLivestock: number
    replacementGilts: number
  }

  breedingAssets: {
    sows: number
    boars: number
  }

  liabilities: {
    payables: number
    other: number
  }

  totalAssets: number
  totalLiabilities: number
  netWorth: number
}
```

This could power both the UI and exports.

---

## 20. Inventory-Adjusted P&L Read Model

Suggested shape:

```ts
type InventoryAdjustedPnL = {
  revenue: {
    pigSales: number
    giltSales: number
    cullSales: number
    other: number
    total: number
  }

  costOfSales: {
    marketPigCost: number
    total: number
  }

  grossProfit: number

  operatingExpenses: {
    breedingFeed: number
    breedingHealth: number
    ai: number
    labour: number
    overheads: number
    depreciation: number
    mortalityLosses: number
    other: number
    total: number
  }

  operatingProfit: number
}
```

---

## 21. Current P&L Must Remain Untouched

Implementation rule:

> Do not modify the existing `operatingProfitOrLoss()` semantics as part of this feature.

Instead introduce a parallel calculation, for example:

```ts
inventoryAdjustedProfitOrLoss(...)
```

or an accounting service responsible for the new view.

The comparison screen should consume both.

---

## 22. Plan Comparison Metrics

Add optional comparison metrics:

```text
Current profit / year
Inventory-adjusted profit / year
Change in livestock inventory / year
Farm net worth at end
Increase in farm net worth / year
Market livestock book value
Breeding herd book value
Feed inventory value
```

For expanding farms, this would allow the user to distinguish:

```text
Poor cash flow
from
Poor profitability
from
Rapid asset accumulation
```

---

## 23. Example: Expanding Farm

Suppose Year 2 produces:

```text
Sales revenue                  $30,000
Period expenditure             $38,000
```

Current P&L:

```text
-$8,000
```

During the year:

```text
Market livestock WIP rises     $5,000
Replacement gilt WIP rises     $2,000
Breeding stock value rises     $3,000
Depreciation                     $800
Mortality write-offs             $400
```

Inventory-adjusted view might show approximately:

```text
Current loss                    -$8,000
+ Inventory/WIP increase         $7,000
+ Breeding asset additions       $3,000
- Depreciation                    $800
- Write-offs                      $400
---------------------------------------
Adjusted profit                   $800
```

Meanwhile cash may still be deeply negative.

That distinction is the main reason for introducing this feature.

---

## 24. Required Configuration Changes

Potential new fields:

```ts
herd.boarCullSaleValue
```

or:

```ts
herd.boarResidualValue
```

Optional future fields:

```ts
accounting.sowDepreciationMethod
accounting.boarDepreciationMethod
accounting.inventoryCostMethod
```

Initial implementation should avoid unnecessary configurability.

Recommended defaults:

```text
Livestock inventory: actual accumulated cost
Feed inventory: weighted average cost
Sow depreciation: straight line by parity
Boar depreciation: straight line by service month
```

---

## 25. Implementation Phases

### Phase 1 — Valuation Read Model

Implement farm valuation without changing any current P&L behaviour.

Add:

- feed inventory value;
- market livestock accumulated cost;
- replacement gilt accumulated cost;
- sow carrying value;
- boar carrying value;
- liabilities;
- farm net worth.

Goal:

> Pigflow can answer "What is this farm worth today?"

### Phase 2 — Inventory-Adjusted P&L

Add the parallel P&L.

Track:

- cost of animals sold;
- inventory accumulation;
- mortality losses;
- breeding depreciation;
- operating expenses.

Goal:

> Pigflow can calculate both current P&L and inventory-adjusted P&L.

### Phase 3 — Comparison UI

Show:

```text
Current P&L
vs
Inventory-adjusted P&L
```

with reconciliation.

Add farm net worth to plan comparison.

### Phase 4 — Validation

Run known scenarios:

- static herd;
- rapidly expanding herd;
- contracting herd;
- high mortality;
- no sales;
- all pigs sold before horizon;
- homebred replacement gilts;
- purchased replacement gilts;
- sow culling;
- sow mortality;
- boar replacement.

---

## 26. Acceptance Criteria

### Existing Behaviour

- Existing current P&L output is unchanged.
- Existing cashflow output is unchanged.
- Existing simulation biology is unchanged.

### Inventory

- Feed remaining in stores has a book value.
- Unsold market pigs have accumulated book cost.
- Selected gilts retain their accumulated cost.
- Promoted gilts become breeding assets.
- Sold animals release their carrying cost to cost of sales.
- Dead animals release their carrying cost to mortality loss.

### Breeding Assets

- Sow carrying value declines by parity.
- Sow carrying value does not fall below expected cull value while alive under normal depreciation.
- Boar carrying value declines by months in service.
- Boar carrying value does not fall below residual value under normal depreciation.

### Farm Worth

For every simulation date:

```text
Net Worth =
    Total Assets
    - Total Liabilities
```

### Reconciliation

The system must be able to explain the difference between:

```text
Current P&L
and
Inventory-Adjusted P&L
```

for any month or year.

---

## 27. Key Invariants

The implementation should enforce:

```text
Feed purchase:
Cash/payable decreases/increases
Feed inventory increases
No immediate inventory-adjusted feed expense
```

```text
Feed consumption by market pig:
Feed inventory decreases
Pig WIP increases
No immediate inventory-adjusted profit impact
```

```text
Market pig sale:
Cash/receivable increases
Revenue increases
Pig WIP decreases
Cost of sales increases
```

```text
Pig death:
Pig WIP decreases
Mortality loss increases
```

```text
Gilt promotion:
Replacement WIP decreases
Breeding asset increases
No profit created
```

```text
Breeding depreciation:
Breeding asset decreases
Depreciation expense increases
```

Assets must never be created simply by moving costs between accounts.

---

## 28. Design Principle

The feature should preserve this mental model:

> **Cash tells us whether the farm can survive.  
> Profit tells us whether the farm is creating economic value.  
> Net worth tells us how much value is currently sitting in the farm.**

Pigflow should expose all three without forcing one to substitute for another.

---

## 29. Initial Product Recommendation

Ship the feature under an **experimental accounting** label.

Suggested UI:

```text
Profit view

● Current P&L
○ Inventory-adjusted P&L (experimental)
```

For comparisons, show both simultaneously.

Do not remove or reinterpret the existing profit metric until the inventory-adjusted model has been validated against multiple farm scenarios and the differences are understood.

---

## 30. Amendments

Three amendments, from review of the first implementation. Each replaces what
is written above it where the two disagree.

### 30.1 Opening stock is entered, not reconstructed

A plan may describe the animals it opens with group by group, each group with a
**value per head on day zero**. Those groups are then the source of truth for
what the farm starts with: the head counts are read off them rather than kept
beside them.

The value entered is what the animal is worth on day zero. It is **not** its
original purchase price, and the plan must not rebuild it from what the animal
would have cost to rear here — on a herd that was bought in that is simply the
wrong number, and on any herd it invents a history the farm did not have.

Opening stock is an opening balance and nothing else:

```text
increases opening livestock assets
no day-0 expense
no day-0 cash payment
no day-0 revenue
no effect on the existing P&L
```

Each generated animal is seeded from its group:

| Opening animal | Basis |
|---|---|
| Market pig | `CostRecord` starts at `openingValuePerHead` |
| Replacement gilt | `CostRecord` starts at `openingValuePerHead` |
| Sow | `breedingValue` starts at `openingValuePerHead` |
| Boar | `breedingValue` starts at `openingValuePerHead` |

So a starting market pig's cost of sale is its opening value plus everything
spent on it after day zero:

```text
Opening grower book value       $70
Feed after simulation start      $28
Health                            $3
------------------------------------
Carrying value at sale          $101
```

A plan that gives only head counts keeps the behaviour specified above: the
growing pigs open at nothing and the founding breeding stock is priced at what a
replacement gilt or a boar costs. Plans saved before this existed are that kind,
and none of them may come out differently.

### 30.2 Depreciation runs from the day-0 carrying value

§5.6 and §5.7 write an animal down from its value over its whole working life.
That is right for an animal the plan itself reared or bought, and wrong for one
the farm already owned: a parity-3 sow entered at $275 is worth $275 today, and
writing her down again for parities one to three charges this plan for wear that
happened before it opened.

Both formulas therefore take the point in the working life at which the value
was set — zero for anything the plan put into the herd:

```text
sowDepreciationPerParity =
    max(0, breedingValue - expectedCullValue)
    / max(1, cullAfterParity - valuedAtParity)

sowAccumulated = perParity × max(0, currentParity - valuedAtParity)
```

```text
boarDepreciationPerDay =
    max(0, breedingValue - residualValue)
    / max(1, workingLifeDays - valuedAfterServiceDays)

boarAccumulated = perDay × max(0, daysInService - valuedAfterServiceDays)
```

A boar entered at $350 with six months behind him is carried at $350 on day
zero, and that $350 is written down over the eighteen months he has left.

### 30.3 Financing is not trading, in either statement

Generated funding injections and withdrawals are posted to other income and to
fixed overheads so that the cash book balances. Neither is the farm earning or
spending anything, so **both** profit statements take both figures back out —
and take out the same two figures, recorded by the run rather than matched up
again by each reader.

There is one inventory-adjusted profit calculation:

```text
currentProfit  = (income - financingIn) - (expenses - financingOut)
adjustedProfit = currentProfit + changeInInventoryAtCost
```

The plan summary, the trading statement, the reconciliation, the workbook and
the plan comparison all read that one figure. Rows the owner typed himself — a
grant, a repair — are farm items and stay in both statements.
