# Pig Project Event Log Review

## Executive Summary

The revised event log is substantially stronger than the earlier version and is now suitable as a serious basis for cash-flow simulation. It includes much more of the real operational lifecycle: heat detection, service, failed conception, pregnancy scanning, re-service, feed procurement, gas procurement, bedding, supplier payments, staffing, animal deaths, gilt selection, slaughter sales, and boar replacement.

The main remaining weaknesses are no longer simply missing events. They are mostly **simulation-logic issues** that could cause the model to appear more reliable or more efficient than a real piggery.

The highest-priority fixes are:

1. Forecast feed and gas demand before new production stages begin.
2. Remove duplicate farrowing records.
3. Add abortions and late pregnancy failures.
4. Introduce realistic variation in litter size and stillbirths.
6. Add health and treatment costs.

---

## 1. Inventory Reordering Reacts Too Late

### Finding

The model appears to react to new demand **after the production stage has already started**.

Examples include:

- Gas running out on the first farrowing day.
- Weaner feed running out on the first weaning day.
- Grower feed running out when pigs first enter the grower stage.
- Finisher feed running out when pigs first become finishers.

This suggests reorder logic is based mainly on current consumption rather than future scheduled demand.

### Why It Matters

Most of these demand changes are predictable.

For example:

- Farrowing dates are known months ahead.
- Weaning dates are known approximately 28 days after farrowing.
- Grower and finisher transitions can be forecast from age and expected growth.
- Gas requirements can be forecast from the number of expected litters.

A real farm should normally order before the stage transition.

### Recommended Change

Calculate:

```text
Projected stock at delivery date
=
Current stock
- Forecast consumption during supplier lead time
- Safety stock
```

Reorder when projected stock falls below zero or below a defined reserve level.

The demand forecast should include animals that **will enter a new feed category before the next delivery arrives**.

---

## 2. Farrowing Is Double-Logged

### Finding

Each litter is represented by two farrowing-type events, for example:

```text
SOW-001 farrowed 12 live piglets, parity 1
12 piglets born
```

This causes the event log to contain roughly twice as many `Farrowing` rows as actual farrowings.

### Why It Matters

Any report using:

```text
count(Type == "Farrowing")
```

could double the number of farrowings and distort:

- litters per sow per year,
- piglets per litter,
- farrowing rate,
- farrowing-house utilization,
- sow productivity.

### Recommended Change

Keep one farrowing event per litter.

For example:

```text
Farrowing,SOW-001 farrowed: 13 total born, 12 live, 1 stillborn, 0 mummified, parity 1
```

If a separate cohort-creation event is needed internally, give it another type such as:

```text
Birth cohort
Piglet cohort created
Inventory
```

---

## 3. No Abortion or Late Pregnancy Failure

### Finding

The revised model includes:

- service,
- return to heat,
- failed conception,
- pregnancy scanning,
- re-service.

This is a major improvement.

However, once a sow is confirmed pregnant, the simulation appears to assume she will farrow unless she dies.

### Why It Matters

Real herds experience:

- abortion,
- pregnancy loss,
- late return,
- presumed pregnancy that fails to result in farrowing.

These events create significant economic losses because the sow consumes feed for weeks or months without producing a litter.

### Recommended Change

After a positive pregnancy scan, introduce a small probability of:

```text
Abortion
Late pregnancy loss
Not-in-pig at presumed term
```

Example:

```text
Pregnancy loss,SOW-014 aborted at day 72 of gestation
```

The model should then determine whether the sow:

- returns to service,
- is treated,
- is culled,
- or remains open for a period.

---

## 4. Litter Size Is Still Too Uniform

### Finding

The average litter size is reasonable, but nearly every litter produces either:

```text
12 live piglets
or
13 live piglets
```

### Why It Matters

The average may be realistic while the **distribution is unrealistic**.

A real herd will occasionally produce:

- poor litters of 7–10 live piglets,
- average litters of 11–13,
- very strong litters of 14–17+.

Parity should also influence expected litter size.

### Recommended Change

Retain approximately the same long-run average, but widen the distribution.

Example model:

```text
Parity 1: mean ≈ 11.5–12.5
Parity 2–4: mean ≈ 12.5–14
Older parity: gradual decline
```

Apply random variation around these means rather than selecting only 12 or 13.

---

## 5. Stillborn and Mummified Piglets Are Missing

### Finding

Farrowing events currently focus mainly on live-born piglets.

### Why It Matters

A realistic farrowing record should distinguish:

```text
Total born
Live born
Stillborn
Mummified
```

This allows meaningful calculation of:

- total-born performance,
- born-alive percentage,
- stillbirth rate,
- pre-weaning mortality,
- pigs weaned per litter.

### Recommended Change

Use an event structure such as:

```text
SOW-021 farrowed:
14 total born,
12 live,
1 stillborn,
1 mummified,
parity 3
```

The existing live-born average does not necessarily need to be reduced. Total-born numbers can simply be generated around it.

---


## 6. Health and Veterinary Costs Are Still Underrepresented

### Finding

The log has animal deaths but relatively little representation of:

- vaccination,
- veterinary treatment,
- medication,
- deworming,
- disease episodes,
- injury treatment.

### Why It Matters

Most pig-health problems do not immediately cause death.

They often cause:

- treatment expenditure,
- slower average daily gain,
- poorer feed conversion,
- delayed sale,
- reproductive failure.

Ignoring these effects creates an overly efficient production system.

### Recommended Change

Add routine preventive-health costs plus stochastic treatment events.

Example:

```text
Health,PIG-00124 treated for respiratory infection
Cost,$8.50
Growth penalty,7 days at reduced ADG
```

Not every individual pig needs detailed clinical simulation. Cohort-level health events would be sufficient for financial modelling.

---

