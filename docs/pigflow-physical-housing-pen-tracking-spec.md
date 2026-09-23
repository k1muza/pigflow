# Pigflow Physical Housing & Pen Tracking — Codex Implementation Spec

Implement the next Pigflow housing phase.

The feature changes housing from simple aggregate **Housing Capacity** inputs into a first-class physical farm model:

```text
Building → Room → Pen
```

The simulator must assign pigs/cohorts to real pens throughout the simulation and keep a complete record of movements and occupancy.

Before changing code, inspect:

- current Farm Inputs UI;
- current Housing Capacity settings;
- housing-needs planner;
- optimized housing structure generator;
- biological simulation;
- animal/cohort models;
- event log;
- `PlanSimulationResult`;
- persistence/schema/migrations;
- relevant tests.

Do not rewrite the biological or financial simulation.

---

## 1. Replace Housing Capacity with a Housing settings panel

In Farm Inputs, remove/deprecate the existing aggregate **Housing Capacity** panel.

Create a dedicated settings tab:

```text
Housing
```

The Housing tab becomes the source of truth for physical housing.

At the top provide:

```text
[ Generate Housing ]
```

If housing already exists:

```text
[ Regenerate Housing ]
```

Show:

- generated/current status;
- whether housing is stale relative to current farm inputs;
- building count;
- room count;
- pen count;
- design head capacity by housing type;
- construction phases.

Below that show the hierarchy:

```text
Breeding & Service House
  Room 1 — Boar
    Pen 1
  Room 2 — Service / Open Sow
    Pen 1
    Pen 2
    ...

Gestation House
  Room 1
    Pen 1
    Pen 2
    ...

Farrowing House
  Room 1
    Pen 1
    ...
```

Prefer expandable/collapsible building and room rows.

Do not require the user to understand the old aggregate housing-capacity fields.

---

## 2. Housing generation is explicit

Do **not** regenerate housing automatically when simulation inputs change.

**Generate Housing** should:

1. perform the existing housing-demand planning pass;
2. run the optimized structure generator;
3. convert the selected structure into persistent physical buildings, rooms and pens;
4. save that structure into Farm Inputs.

The generated housing becomes input to subsequent simulations.

Store enough metadata to determine whether it is stale:

```ts
housing.generatedFromInputHash
housing.generatedAt
housing.generatorVersion
```

If relevant farm inputs change, display:

```text
Housing may be out of date with the current plan.
```

Provide:

```text
Regenerate Housing
```

Do not silently regenerate.

---

## 3. Avoid the planning/simulation circular dependency

Housing generation requires biological demand before physical housing exists.

Introduce a clear distinction:

```text
housing planning simulation
normal farm simulation
```

The planning pass calculates biological housing demand without enforcing physical pen availability.

Conceptually:

```text
PlanConfig
    ↓
biological planning pass
    ↓
HousingDemandBuilder
    ↓
Housing optimizer
    ↓
PhysicalFarmPlan
    ↓
saved into PlanConfig.housing
```

Then normal simulation becomes:

```text
PlanConfig + PhysicalFarmPlan
    ↓
biological simulation
    ↓
PhysicalHousingAllocator
    ↓
housing state/events
```

Do not create an accidental recursive simulation dependency.

---

## 4. Persistent physical housing model

Introduce a persisted model similar to:

```ts
type PhysicalFarmPlan = {
  generatedFromInputHash?: string;
  generatedAt?: string;
  generatorVersion?: string;

  buildings: PhysicalBuilding[];
};

type PhysicalBuilding = {
  id: string;
  name: string;

  housingType?: HousingType;

  lengthM: number;
  widthM: number;

  commissionedDay: number;

  rooms: PhysicalRoom[];
};

type PhysicalRoom = {
  id: string;
  buildingId: string;

  name: string;
  housingType: HousingType;

  lengthM: number;
  widthM: number;

  commissionedDay: number;

  pens: PhysicalPen[];
};

type PhysicalPen = {
  id: string;
  roomId: string;

  name: string;

  housingType: HousingType;

  maxHead: number;
  floorAreaM2: number;

  allowedStages: PigStage[];

  commissionedDay: number;
};
```

Use stable deterministic IDs.

Examples:

```text
BREED-01
BREED-01-R01
BREED-01-R01-P01

GEST-01-R01-P04

FARR-01-R02-P07

WEAN-01-R03-P02
```

IDs must remain stable between simulations when the saved housing plan is unchanged.

---

## 5. Construction phases must matter

Rooms/pens generated for future phases already have build-by / commissioning information.

Persist that.

A pen must **not** be available before its `commissionedDay`.

Example:

```text
FIN-01-R01 commissioned 2027
FIN-01-R02 commissioned 2027
FIN-01-R03 commissioned 2028
FIN-01-R04 commissioned 2028
FIN-01-R05 commissioned 2029
```

The simulator cannot allocate pigs into a future room.

---

## 6. Runtime physical farm state

During simulation maintain runtime state.

Suggested shape:

```ts
type PhysicalFarmState = {
  day: number;

  buildings: Record<string, BuildingHousingState>;
  rooms: Record<string, RoomHousingState>;
  pens: Record<string, PenHousingState>;

  entityLocations: Record<string, PhysicalLocation>;
};

type PhysicalLocation = {
  buildingId: string;
  roomId: string;
  penId: string;
};

type PenHousingState = {
  penId: string;

  status:
    | "NOT_COMMISSIONED"
    | "AVAILABLE"
    | "OCCUPIED"
    | "RESERVED"
    | "CLEANING"
    | "OUT_OF_SERVICE";

  occupants: HousingOccupant[];

  occupiedHead: number;

  reservedUntilDay?: number;
  cleaningUntilDay?: number;
};

type HousingOccupant =
  | {
      type: "animal";
      animalId: string;
    }
  | {
      type: "cohort";
      cohortId: string;
      head: number;
    };
```

Room and building state should normally be derived from their pens.

Avoid maintaining contradictory independent room capacity state.

---

## 7. Individual breeders vs growing cohorts

Use the simulator's existing entity model.

Breeding animals should normally have individual physical locations:

```text
Sow 014
  → FARR-01 / R02 / P03

Boar 002
  → BREED-01 / R01 / P01
```

Growing pigs may be allocated as cohorts/batches if the existing simulation models them as cohorts.

Example:

```text
Batch W-041
19 pigs
  → WEAN-01 / R03 / P02
```

Do not force thousands of artificial individual pig records merely for housing if the underlying simulation is cohort-based.

However, the location abstraction should allow individual animals where they already exist.

---

## 8. Deterministic pen allocator

Create a dedicated physical housing allocator.

Conceptually:

```ts
allocateHousing(
  entity,
  requirement,
  farmState,
  day
): AllocationResult
```

Rules:

1. only use commissioned buildings/rooms/pens;
2. only use compatible housing types;
3. never exceed max head;
4. respect floor-area requirements;
5. exclude cleaning/reserved/out-of-service pens;
6. preserve stable cohorts;
7. avoid unnecessary mixing;
8. prefer keeping animals in their current pen;
9. prefer filling an active room before opening another room;
10. prefer sensible use of partially occupied compatible pens;
11. avoid unnecessary animal movements;
12. deterministic input must produce deterministic allocation.

Do **not** rebalance pigs merely to make occupancy percentages look nicer.

An animal/cohort should move because of a real event or housing requirement, not because another packing arrangement scores slightly better.

---

## 9. Physical movements

Create explicit housing movement records.

Example model:

```ts
type HousingMovementEvent = {
  day: number;

  occupant:
    | { type: "animal"; animalId: string }
    | { type: "cohort"; cohortId: string; head: number };

  from?: PhysicalLocation;
  to?: PhysicalLocation;

  reason:
    | "INITIAL_PLACEMENT"
    | "SERVICE"
    | "GESTATION"
    | "PRE_FARROW"
    | "WEANING"
    | "STAGE_TRANSITION"
    | "SALE"
    | "CULL"
    | "MORTALITY"
    | "MANUAL";

  eventId?: string;
};
```

Example:

```text
Day 621

Sow 014
GEST-01 / R01 / P04
    →
FARR-01 / R02 / P03

Reason: PRE_FARROW
```

Keep these records in the simulation result.

---

## 10. Pen lifecycle

Model physical pen lifecycle explicitly.

Typical lifecycle:

```text
AVAILABLE
    ↓ allocation
OCCUPIED
    ↓ pigs leave
CLEANING
    ↓ cleaning period complete
AVAILABLE
```

For farrowing:

```text
AVAILABLE
    ↓ pre-farrow reservation
RESERVED
    ↓ sow arrives
OCCUPIED
    ↓ weaning
CLEANING
    ↓
AVAILABLE
```

Use the housing policy's existing cleaning/reservation durations.

Do not duplicate different cleaning rules inside the allocator.

---

## 11. Biological transitions drive housing movements

Integrate with existing biological events.

Examples:

### PRE-FARROW

```text
Sow
Gestation pen
    →
Farrowing pen
```

### BIRTH

Piglets inherit the sow's farrowing-pen location.

### WEANING

```text
Sow
Farrowing pen
    →
Service/Open Sow housing

Litter/cohort
Farrowing pen
    →
Weaner pen

Farrowing pen
    →
CLEANING
```

### WEANER → GROWER

```text
cohort
Weaner pen
    →
Grower pen
```

### GROWER → FINISHER

```text
cohort
Grower pen
    →
Finisher pen
```

### SALE/CULL

Occupant is removed from the physical farm.

Do not modify the biological meaning/timing of these events just to make housing allocation easier.

---

## 12. Housing shortage

The allocator must **never** silently overfill a pen.

If no valid pen exists, create a structured housing conflict:

```ts
type HousingConflict = {
  day: number;

  housingType: HousingType;

  requiredHead: number;

  availableHeadCapacity: number;

  occupantId?: string;

  reason:
    | "NO_COMMISSIONED_PEN"
    | "ALL_COMPATIBLE_PENS_FULL"
    | "ALL_COMPATIBLE_PENS_CLEANING"
    | "ALL_COMPATIBLE_PENS_RESERVED"
    | "GROUP_CANNOT_FIT";
};
```

For this phase:

- report the conflict;
- do not invent extra housing;
- do not silently increase capacity;
- do not automatically change biological dates;
- do not place pigs into invalid housing.

Preserve enough state so the simulation/report can tell the user exactly what failed.

---

## 13. Housing occupancy history

Do not persist a gigantic deep copy of the entire farm for every simulation day unless performance testing proves it acceptable.

Prefer event-sourced history:

- housing movements;
- pen status transitions;
- room/building commissioning events.

Maintain current state in memory while simulating.

From the event stream we should be able to reconstruct:

```text
where was Sow 014 on Day 621?
```

and:

```text
what occupied FIN-01/R03/P04 on Day 950?
```

If convenient, add periodic snapshots as an optimization, but events are the source of truth.

---

## 14. PlanSimulationResult

Extend the result with something like:

```ts
type HousingSimulationResult = {
  movements: HousingMovementEvent[];
  conflicts: HousingConflict[];

  finalState: PhysicalFarmState;

  penUtilization: PenUtilizationSummary[];
  roomUtilization: RoomUtilizationSummary[];
};
```

Attach it to the existing `PlanSimulationResult`.

Do not run a second biological simulation merely to produce housing reports.

---

## 15. UI after simulation

The first UI can be simple.

Add a way to inspect physical housing for a chosen simulation day:

```text
Day 842

FARROWING HOUSE

  Room 1
    Pen 1 — Sow 014 + litter
    Pen 2 — Cleaning
    Pen 3 — Sow 021 + litter

  Room 2
    ...

WEANER HOUSE

  Room 1
    Pen 1 — W-041 — 20 pigs
    Pen 2 — W-042 — 18 pigs
    Pen 3 — Available
    Pen 4 — Available
```

Do not build the full daily-operations feature yet.

The milestone is physical traceability.

---

## 16. Existing Housing Capacity migration

The new physical housing model should ultimately replace the current Housing Capacity settings.

Do not leave two competing sources of truth.

Provide a migration strategy for old saved plans.

Possible safe behavior:

- legacy plan with aggregate capacity: show **Legacy housing configuration**;
- allow user to **Generate Housing**;
- once physical housing exists, it becomes authoritative;
- remove/ignore aggregate capacity for that plan.

Do not silently reinterpret old aggregate values into arbitrary buildings unless there is an explicit, deterministic migration rule.

---

## 17. Regeneration safety

Regenerating housing is destructive because IDs may change and the physical farm plan may have been manually adjusted.

When the user presses **Regenerate Housing**:

show a confirmation explaining that the generated physical layout will be replaced.

Ideally calculate and show a small diff:

```text
Buildings: 6 → 7
Rooms: 24 → 28
Pens: 138 → 146
```

Do not overwrite manually modified housing without confirmation.

---

## 18. Tests

Add tests for at least:

1. every housed entity has at most one pen location;
2. no pen exceeds its max head;
3. no entity is assigned to incompatible housing;
4. non-commissioned pens cannot receive animals;
5. cleaning pens cannot receive animals;
6. reserved farrowing pens cannot receive another sow;
7. pre-farrow transfer creates a movement;
8. birth leaves piglets in the mother's farrowing location;
9. weaning moves sow and litter to the correct housing types;
10. vacated farrowing pen enters cleaning;
11. pen becomes available after cleaning;
12. weaner → grower transition creates a movement;
13. grower → finisher transition creates a movement;
14. sale removes the entity from housing;
15. mortality updates pen occupancy;
16. deterministic simulation produces identical locations/events;
17. allocator prefers staying in an existing valid pen;
18. allocator does not rebalance without a triggering event;
19. allocator prefers an active room before opening another equivalent room;
20. shortage produces `HousingConflict` rather than overcapacity;
21. physical housing capacity replaces aggregate housing capacity when present;
22. legacy plans still load;
23. generated room commissioning dates are respected;
24. housing event history can reconstruct an entity's location on a past day;
25. housing event history can reconstruct a pen's occupants on a past day.

---

## 19. Important invariant

After this implementation, Pigflow must be able to answer these two questions for **ANY simulated day**:

```text
Where is every pig / cohort?
```

and:

```text
What is inside every pen?
```

That is the definition of done for this phase.

Do not implement daily feed/task scheduling yet.

Do not implement live farm check-ins yet.

Do not implement automatic housing-constrained biological rescheduling yet.

First make physical housing state and movement history correct, deterministic and inspectable.
