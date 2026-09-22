# Pigflow Housing Needs Planner — Specification

## 1. Objective

Add a **Housing Needs Planner** that uses the existing Pigflow simulation to determine:

- what types of pig housing are required;
- how many pens/places are required for each housing type;
- the minimum and recommended capacity;
- how those pens can be grouped into rectangular rooms;
- how many buildings are required;
- approximate rectangular dimensions for rooms and buildings;
- when each housing type reaches peak demand.

The housing calculation must use the **same daily simulation state that produces Herd Development**.

Do **not** calculate housing directly from a rule such as:

```text
50 sows => X weaner pens
```

Instead calculate housing from the actual animals produced by the simulation:

```text
simulation
    ↓
daily herd state
    ↓
housing demand
    ↓
pen allocation
    ↓
peak simultaneous pen requirement
    ↓
rooms
    ↓
buildings
```

The `Herd Development Plan` spreadsheet is a useful way to inspect/validate the result, but should **not** be the primary input because month-end snapshots can miss short-lived daily housing peaks.

---

## 2. Scope

### Included

Support these housing categories:

```ts
type HousingType =
  | "boar"
  | "service_sow"
  | "gestation"
  | "farrowing"
  | "gilt"
  | "weaner"
  | "grower"
  | "finisher";
```

Produce:

```text
Housing requirements
→ required pens/places
→ required animal floor area
→ rectangular pen dimensions
→ rectangular room dimensions
→ rooms per building
→ number of buildings
→ approximate building dimensions
```

### Explicitly excluded from this version

Do not implement yet:

- daily farm task schedules;
- feed allocation by room;
- vaccinations by room;
- animal movement instructions;
- live-farm task completion;
- BOQ/construction costs;
- automatic site positioning;
- manure-system engineering;
- water-system engineering;
- ventilation engineering;
- architectural/construction drawings.

This feature is **capacity and structure planning only**.

---

## 3. Reference manual

Use `Manualonhousingforpigs.pdf` as the default housing-rule profile.

The manual treats boars, service sows, pregnant sows, farrowing, weaners, growers and finishers as different housing requirements rather than treating all pigs as interchangeable floor-space demand.

All values derived from the manual must live in configuration rather than being scattered through simulation code.

Use terminology such as:

```text
Source: ARC Pig Housing Manual profile
```

Do not represent these defaults as current legislation.

---

## 4. Architecture

Keep the housing calculation separate from the biological simulation.

Suggested flow:

```text
PlanConfig
   ↓
Farm simulation
   ↓
PlanSimulationResult / daily farm state
   ↓
HousingDemandBuilder
   ↓
VirtualPenAllocator
   ↓
HousingCapacityResult
   ↓
StructureGenerator
   ↓
HousingPlan
```

Suggested modules:

```text
src/lib/housing/
    rules.ts
    demand.ts
    allocator.ts
    geometry.ts
    structures.ts
    result.ts
```

The housing planner must not change breeding, mortality, growth, sales, cashflow or P&L.

It is a read/planning layer over the existing simulation.

---

## 5. Required simulation information

For every simulation day the housing planner needs access to enough information to determine:

```ts
type HousingAnimalSnapshot = {
  id: string;

  kind:
    | "sow"
    | "boar"
    | "gilt"
    | "pig";

  stage?:
    | "piglet"
    | "weaner"
    | "grower"
    | "finisher";

  reproductiveState?:
    | "open"
    | "gestating"
    | "lactating";

  weightKg: number;
  ageDays: number;

  cohortId?: string;

  expectedFarrowDay?: number;
  expectedWeanDay?: number;

  sex?: "male" | "female";
};
```

Prefer using existing engine objects/state rather than creating duplicate biological calculations.

---

## 6. Important principle: calculate daily demand

Do not calculate housing from monthly Herd Development snapshots.

Example:

```text
31 January:
12 farrowing sows

28 February:
14 farrowing sows
```

There could still have been **17 farrowing places required on 12 February**.

Therefore housing demand must be calculated from daily simulation data.

The monthly Herd Development export should later be used as a reconciliation/reporting view.

---

## 7. Housing rules configuration

Create a single housing policy object.

Example:

```ts
type HousingPolicy = {
  farrowing: {
    preFarrowDays: number;
    cleaningDays: number;

    penMinWidthM: number;
    penMaxWidthM: number;

    penMinLengthM: number;
    penMaxLengthM: number;
  };

  weaner: {
    targetHeadPerPen: number;
    maxHeadPerPen: number;

    floorAreaM2PerHead: number;

    cleaningDays: number;
  };

  grower: {
    targetHeadPerPen: number;
    maxHeadPerPen: number;

    cleaningDays: number;

    floorAreaBands: Array<{
      maxWeightKg: number;
      m2PerHead: number;
    }>;
  };

  finisher: {
    targetHeadPerPen: number;
    maxHeadPerPen: number;

    cleaningDays: number;

    floorAreaBands: Array<{
      maxWeightKg: number;
      m2PerHead: number;
    }>;
  };

  boar: {
    housingOnlyAreaM2: number;
    servicePenAreaM2: number;
  };

  gestation: {
    mode: "group";

    targetSowsPerPen: number;
    minAreaM2PerSow: number;
  };

  serviceSow: {
    areaM2PerSow: number;
  };

  structure: {
    reservePct: number;

    pensPerRoomOptions: number[];

    centralPassageWidthM: number;

    preferredRoomMaxAspectRatio: number;

    maxRoomsPerBuilding: number;
  };
};
```

---

## 8. Initial manual-derived defaults

Use the manual as the source of defaults.

### Boars

One boar should normally occupy a separate pen.

The manual gives:

```text
housing-only boar pen: ≥ 7.0 m²
boar pen used for service: ≥ 9.3 m²
```

with the shortest side of a service pen not less than 2.1 m.

Suggested default:

```ts
boar: {
  housingOnlyAreaM2: 7.0,
  servicePenAreaM2: 9.3,
}
```

Use actual simulated boar numbers to determine pen count.

---

## 9. Service/open sow housing

Open/service sows require separate service-area capacity.

The manual describes individual sow pens of approximately 1.8 m² in the service/boar housing system.

Use the **maximum simultaneous number of sows requiring service/open housing**, not a percentage of total sows.

For each day:

```text
service sow places required
=
number of eligible sows currently in service/open housing state
```

---

## 10. Gestation housing

For v1 use **group gestation housing**.

The manual recommends grouping sows of similar bodyweight/condition and describes groups of approximately four to five sows with 3.9–4.9 m² total floor area per sow in that housing design.

Suggested default:

```ts
gestation: {
  mode: "group",
  targetSowsPerPen: 5,
  minAreaM2PerSow: 3.9,
}
```

The planner must ensure both:

```text
head count <= target/max group size
```

and:

```text
pen area >= number of sows × minimum area/sow
```

Use actual daily gestating sow counts.

---

## 11. Farrowing housing

One sow and her litter require one farrowing pen.

The manual gives farrowing pen dimensions approximately:

```text
1.8–2.0 m wide
×
2.2–2.5 m long
```

and recommends moving the sow in about one week before farrowing.

The manual's example occupation cycle is:

```text
7 days before farrowing
+ 35 days sow/litter
+ 4 days cleaning
= 46 days
```

Pigflow must **not hard-code 35 lactation days**.

Use:

```ts
reservationStart =
  expectedFarrowDay - policy.farrowing.preFarrowDays;

releaseDay =
  actualWeanDay + policy.farrowing.cleaningDays;
```

Therefore the farrowing requirement is:

```text
maximum number of overlapping farrowing reservations
```

during the simulation.

This is more accurate than simply using the maximum `lactatingSows` count.

---

## 12. Weaner housing

The manual's 35-day weaning example combines approximately two litters into groups of around 20 pigs and uses approximately 8 m² per pen, equivalent to roughly 0.3–0.5 m²/head.

Suggested conservative initial default:

```ts
weaner: {
  targetHeadPerPen: 20,
  maxHeadPerPen: 20,
  floorAreaM2PerHead: 0.4,
  cleaningDays: 7,
}
```

The manual includes a seven-day cleaning/sterilising period between weaner groups.

Group weaners primarily by:

```text
1. cohort/litter relationship
2. similar bodyweight
3. target pen size
```

Do not combine pigs solely to achieve perfect pen utilisation.

---

## 13. Grower housing

The manual normally keeps existing grower groups together when they move from weaner housing, apart from weak/small pigs; alternatively pigs may be divided according to liveweight.

Suggested default:

```ts
grower: {
  targetHeadPerPen: 20,
  maxHeadPerPen: 20,
  cleaningDays: 7,
}
```

Do not constantly rebalance grower groups between pens.

Maintain a stable batch where possible.

---

## 14. Finisher housing

The manual suggests groups of approximately 8–10 finishing pigs according to bodyweight. Where young males are intact, sex becomes an important grouping criterion.

Suggested default:

```ts
finisher: {
  targetHeadPerPen: 10,
  maxHeadPerPen: 10,
  cleaningDays: 7,
}
```

Group primarily by:

```text
sex compatibility, where relevant
weight
previous cohort
```

---

## 15. Grower/finisher floor-area rules

Use the **maximum expected bodyweight while the pigs occupy the pen**, not merely their weight when entering it.

The manual provides approximate grower/finisher norms of:

```text
~45 kg       0.80 m²/head
up to 90 kg  0.95 m²/head
up to 110 kg 1.00–1.30 m²/head
```

Use conservative defaults:

```ts
floorAreaBands: [
  { maxWeightKg: 45,  m2PerHead: 0.80 },
  { maxWeightKg: 90,  m2PerHead: 0.95 },
  { maxWeightKg: 110, m2PerHead: 1.30 },
];
```

If the simulation permits animals heavier than the highest configured band, do not silently extrapolate.

Return a warning:

```text
No housing floor-area rule configured for pigs above 110 kg.
```

---

## 16. Virtual pen allocation algorithm

This is the main algorithm for v1.

Do **not** use an optimisation library yet.

Use a deterministic first-fit allocator.

For each simulation day:

```text
1. Release pens whose cleaning period has ended.

2. Determine animals/batches that need housing.

3. Determine the required HousingType.

4. Keep animals already correctly housed in their current pen.

5. For animals entering a new stage:
      build compatible batches.

6. Find an available compatible virtual pen.

7. Prefer:
      a. keeping an existing cohort together;
      b. a pen with the least unused capacity.

8. If no compatible pen exists:
      create a new virtual pen.

9. Assign the batch to that pen.

10. When a batch leaves:
      mark its old pen CLEANING.

11. Record:
      active pens,
      occupied pens,
      cleaning pens,
      spare pens,
      head count.
```

The maximum number of virtual pens that have to exist simultaneously becomes the **minimum required pen count**.

---

## 17. Pen lifecycle

Use:

```ts
type PenState =
  | "available"
  | "reserved"
  | "occupied"
  | "cleaning";
```

Example:

```text
Day 100–134
Pen W03 = occupied

Day 135–141
Pen W03 = cleaning

Day 142
Pen W03 = available
```

An empty cleaning pen must **not** count as available capacity.

This distinction is critical to housing requirements.

---

## 18. Stable batches

For growing pigs, the allocator should work with batches.

Example:

```ts
type HousingBatch = {
  id: string;
  stage: "weaner" | "grower" | "finisher";

  pigIds: string[];
  sourceCohortIds: string[];

  averageWeightKg: number;
  minWeightKg: number;
  maxWeightKg: number;

  sexClass?: "mixed" | "male" | "female";
};
```

General rule:

```text
Keep an established batch together if it fits.
```

Do not move animals between pens merely because another pen has spare places.

The manual notes that disruption of pig social hierarchy can cause fighting/stress and that repeated pen changing can adversely affect production.

---

## 19. Minimum vs recommended capacity

Produce two values.

Example:

```text
Minimum simulated requirement:   27 finisher pens
Recommended capacity:            30 finisher pens
```

The first is simulation-derived.

The second adds an operational reserve.

Suggested initial configuration:

```ts
reservePct: 0.10
```

Calculation:

```ts
recommendedPens =
  Math.ceil(minimumPens * (1 + reservePct));
```

Then round to a complete room module later.

Clearly label the distinction.

The reference manual commonly recommends slightly more pens than the exact arithmetic requirement in its worked examples to provide practical capacity.

---

## 20. Pen geometry

Every pen must have a rectangular footprint.

Given:

```text
headCount
×
required m²/head
=
required pen area
```

generate a practical rectangle.

Example:

```text
10 finishers
×
1.30 m²
=
13.0 m²
```

Possible geometry:

```text
3.25 m × 4.00 m
= 13.00 m²
```

Do not hard-code `3.25 × 4.00`.

Use an algorithm.

---

## 21. Rectangular pen algorithm

Given:

```ts
requiredAreaM2
preferredAspectRatio
minimumWidthM?
```

Search candidate widths in increments such as:

```ts
DIMENSION_STEP_M = 0.25;
```

For each candidate width:

```ts
length =
  ceilToStep(requiredArea / width);

actualArea =
  width * length;

aspectRatio =
  max(width, length) / min(width, length);
```

Score:

```ts
score =
  wastedAreaM2 * AREA_WEIGHT
  + abs(aspectRatio - preferredAspectRatio) * RATIO_WEIGHT;
```

Reject candidates violating explicit manual constraints.

For a boar service pen:

```text
shortest side >= 2.1 m
area >= 9.3 m²
```

Choose the valid candidate with the lowest score.

---

## 22. Room concept

For Pigflow, define a **room** as:

> A rectangular independently manageable compartment containing one or more pens of the same housing type.

A room should not mix:

```text
weaner pens + finisher pens
```

or:

```text
farrowing + grower pens
```

in v1.

This keeps cleaning and future operational planning simple.

---

## 23. Room templates

Do not try arbitrary architectural geometry.

Generate only simple rectangular templates.

Support:

```ts
type RoomLayout =
  | "single_row"
  | "double_row_central_passage";
```

Candidate pen counts:

```ts
pensPerRoomOptions = [2, 4, 6];
```

This must be configurable.

---

## 24. Single-row room geometry

Example arrangement:

```text
┌──────┬──────┬──────┬──────┐
│ Pen  │ Pen  │ Pen  │ Pen  │
├──────┴──────┴──────┴──────┤
│       service passage       │
└─────────────────────────────┘
```

Calculate:

```ts
roomLength =
  pensPerRoom * penWidth;

roomWidth =
  penDepth + passageWidth;
```

Add configured wall/structural allowance if required.

---

## 25. Double-row room geometry

Example:

```text
┌──────┬──────┐
│ Pen  │ Pen  │
├──────┴──────┤
│   passage   │
├──────┬──────┤
│ Pen  │ Pen  │
└──────┴──────┘
```

For an even number of pens:

```ts
pensPerSide =
  pensPerRoom / 2;

roomLength =
  pensPerSide * penWidth;

roomWidth =
  penDepth * 2 + passageWidth;
```

The manual's grower/finisher building examples include rows of pens with feeding/service passages, so this is consistent with its general building arrangement.

---

## 26. Choosing the room template

For every housing type:

1. calculate recommended pen count;
2. generate room candidates for each `pensPerRoomOption`;
3. generate both valid layouts;
4. calculate room dimensions;
5. calculate how many rooms are required;
6. calculate resulting spare pens.

Example:

```text
27 minimum finisher pens
30 recommended after reserve
```

Candidates:

```text
2 pens/room
15 rooms
0 spare pens

4 pens/room
8 rooms
32 total pens
2 spare pens

6 pens/room
5 rooms
30 total pens
0 spare pens
```

Score each candidate.

Suggested scoring:

```ts
score =
    sparePens * 100
  + roomCount * 5
  + awkwardAspectRatioPenalty;
```

Do not optimise purely for the fewest rooms.

Reject rooms exceeding:

```ts
preferredRoomMaxAspectRatio
```

unless no feasible alternative exists.

---

## 27. Buildings

A building contains rooms of one primary housing type.

Initial building categories:

```ts
type BuildingType =
  | "breeding_service"
  | "gestation"
  | "farrowing"
  | "weaner"
  | "grower"
  | "finisher";
```

`breeding_service` may include:

```text
boar pens
service sow pens
gilt pens
```

The others should initially remain dedicated.

---

## 28. Building generation algorithm

Keep this simple in v1.

Given:

```text
number of required rooms
maxRoomsPerBuilding
```

calculate:

```ts
buildingCount =
  Math.ceil(roomCount / maxRoomsPerBuilding);
```

Distribute rooms as evenly as possible.

Example:

```text
10 finisher rooms
max 6 rooms/building

=> 2 buildings
   House A = 5 rooms
   House B = 5 rooms
```

Do not create:

```text
House A = 6
House B = 4
```

unless another constraint requires it.

`maxRoomsPerBuilding` is a **Pigflow planning assumption**, not a rule from the manual, and must be configurable.

---

## 29. Building geometry

Buildings must also be rectangular.

For v1, place rooms sequentially along one building axis.

Example:

```text
┌────────┬────────┬────────┬────────┐
│ Room 1 │ Room 2 │ Room 3 │ Room 4 │
└────────┴────────┴────────┴────────┘
```

If all rooms have equal dimensions:

```ts
buildingLength =
  roomCount * roomLength;

buildingWidth =
  roomWidth;
```

Add configured:

```text
external passage
wall allowance
service area
```

only if explicitly represented by the structure policy.

Do not invent hidden floor area.

---

## 30. Result model

Suggested result:

```ts
type HousingNeedsResult = {
  generatedFromSimulationDayCount: number;

  types: HousingTypeResult[];

  totals: {
    buildings: number;
    rooms: number;
    pens: number;

    animalFloorAreaM2: number;
    estimatedStructureAreaM2: number;
  };

  warnings: HousingWarning[];
};

type HousingTypeResult = {
  housingType: HousingType;

  peakDay: number;

  peakHead: number;

  minimumPens: number;
  recommendedPens: number;

  pen: {
    capacityHead: number;

    widthM: number;
    lengthM: number;
    areaM2: number;
  };

  room: {
    layout: RoomLayout;

    pensPerRoom: number;

    roomCount: number;

    widthM: number;
    lengthM: number;
    areaM2: number;
  };

  buildings: Array<{
    roomCount: number;

    penCount: number;
    headCapacity: number;

    widthM: number;
    lengthM: number;
    areaM2: number;
  }>;

  sourceAssumptions: string[];
};
```

---

## 31. Example report

Output something resembling:

```text
HOUSING NEEDS

Farrowing
Peak reserved sows:       8
Minimum pens:             8
Recommended pens:         8

Suggested:
1 Farrowing House
2 rooms
4 pens / room

Pen:
2.0 m × 2.5 m

Room:
approximately X × Y m

--------------------------------

Weaners
Peak pigs requiring housing: 283
Minimum simulated pens:       15
Recommended/module capacity:  16

Suggested:
1 Weaner House
4 rooms
4 pens / room
20 pigs / pen

Total capacity:
320 weaners

--------------------------------

Growers
Peak pigs requiring housing: ...
Minimum simulated pens:       ...
Recommended pens:             ...

Suggested:
...

--------------------------------

Finishers
Peak pigs requiring housing: ...
Minimum simulated pens:       ...
Recommended/module capacity:  ...

Suggested:
2 Finisher Houses
4 rooms / house
4 pens / room
10 pigs / pen
```

These numbers must come from the actual new allocator, not hard-coded from the current spreadsheet.

---

## 32. Explainability

Every recommendation must expose its derivation.

Example:

```text
Why 16 weaner pens?

Peak simultaneous occupied pens: 14
Peak pens unavailable for cleaning: 1

Minimum physical requirement: 15

10% operational reserve:
15 × 1.10 = 16.5

Chosen room module:
4 pens / room

Rounded module capacity:
20 pens
```

If rounding to the room module increases the number further, show that separately:

```text
Minimum:       15
With reserve:  17
Module capacity: 20
```

Do not hide these steps behind a single recommendation number.

---

## 33. Reconciliation with Herd Development

Add tests comparing housing results with Herd Development.

For each housing type:

```text
peak housed head
>=
corresponding observed herd count
```

But do not expect them always to be identical because:

- farrowing accommodation includes pre-farrow reservation;
- pens may remain unavailable during cleaning;
- cohorts cause partially occupied pens;
- monthly reports may miss daily peaks.

This is expected.

---

## 34. Important housing invariants

The implementation must enforce:

```text
No animal is allocated to more than one pen.

Every animal requiring housing has exactly one housing assignment.

A pen cannot contain more animals than maxHead.

Required animal floor area cannot exceed pen floor area.

A cleaning pen cannot receive animals.

A reserved farrowing pen cannot be allocated elsewhere.

A farrowing pen contains at most one sow/litter unit.

A boar requiring an individual pen cannot share it.

A room contains only compatible pen types.

All generated pens are rectangular.

All generated rooms are rectangular.

All generated buildings are rectangular.

Recommended capacity can never be lower than minimum simulated capacity.
```

---

## 35. Determinism

The housing plan must be deterministic.

The same:

```text
PlanConfig
+
simulation result
+
HousingPolicy
```

must always produce exactly the same:

```text
pen count
room count
building count
dimensions
peak dates
```

Do not use random placement.

---

## 36. Tests

At minimum implement tests for:

```text
1. A farrowing pen is reserved before farrowing.

2. A farrowing pen remains unavailable during cleaning.

3. Overlapping farrowings create additional pen demand.

4. Twenty weaners fit one standard weaner pen.

5. Twenty-one weaners require two pens when maxHead = 20.

6. Grower cohorts remain together when a compatible pen exists.

7. Finisher groups do not exceed configured head capacity.

8. Weight-derived floor-area constraints can require additional pens even when head capacity has not been exceeded.

9. A cleaning pen cannot be reused early.

10. Virtual allocation creates another pen when none is available.

11. Peak virtual pen count equals minimum required pen count.

12. Recommended pen count >= minimum pen count.

13. Room generation never provides fewer pens than recommended.

14. Generated rectangular pen area >= required animal floor area.

15. Generated rooms are rectangular.

16. Generated buildings are rectangular.

17. Boar service pens satisfy minimum area and minimum short-side constraint.

18. Increasing litter size increases or preserves housing requirement; it must never reduce it solely because of allocator behaviour.

19. Increasing mortality may reduce downstream housing demand.

20. Increasing sale weight / days to sale increases or preserves finisher housing demand.

21. Changing weaning age changes farrowing/weaner occupancy appropriately.

22. Monthly Herd Development counts never exceed the physical capacity reported for the corresponding stage.

23. Existing cashflow, P&L and herd simulation results remain unchanged by enabling housing planning.
```

---

## 37. Implementation sequence

Implement this in four small steps:

```text
Phase 1
Daily HousingDemandBuilder
+
virtual pen allocator

Deliverable:
exact minimum pens required by housing type.

Phase 2
Pen geometry

Deliverable:
rectangular pen dimensions and area.

Phase 3
Room generator

Deliverable:
number of rooms, pens per room and rectangular room dimensions.

Phase 4
Building generator

Deliverable:
building type, number of buildings, rooms/building and approximate rectangular dimensions.
```

Do **not** start with building geometry.

First prove that:

```text
given this simulation,
Pigflow correctly determines how many pens must exist.
```

Once that is trustworthy, the rectangular room/building generation becomes a much simpler deterministic packing problem.

---

## Definition of done

The feature is complete when Pigflow can take an arbitrary farm simulation and produce something like:

```text
Required Housing

1 Breeding & Service House
  - 2 boar pens
  - 8 service sow places
  - 3 gilt pens

1 Gestation House
  - 10 group pens
  - capacity 50 sows

1 Farrowing House
  - 2 rooms
  - 4 pens per room
  - 8 farrowing places

1 Weaner House
  - 4 rooms
  - 4 pens per room
  - 320 head capacity

1 Grower House
  - 5 rooms
  - 4 pens per room
  - 400 head capacity

2 Finisher Houses
  - 4 rooms each
  - 4 pens per room
  - 320 total head capacity
```

with every figure traceable back to:

```text
simulation demand
→ pen allocation
→ manual housing constraints
→ reserve
→ rectangular room template
→ building grouping
```

and without changing any existing Pigflow financial or biological simulation result.
