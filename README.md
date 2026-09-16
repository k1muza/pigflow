# PigFlow

PigFlow is a transparent piggery cashflow planner built with Next.js, TypeScript, Tailwind CSS, Recharts, date-fns and Zod.

The farm is simulated one day at a time. Every sow, boar and growing pig is an object with a sex, a weight, an age and a dam, and it posts its own money to a ledger.

## The rules the simulation runs on

**A pig is an individual.** Its stage sets the ration, its sex scales appetite and growth, and its weight scales the maintenance share of what it eats — so a 95 kg finisher eats measurably more than a 62 kg one. Each pig also carries its own thriftiness, so litter mates do not all reach sale weight on the same day. Suckling piglets live on milk until they are old enough for creep feed.

**The herd grows into its sow places.** Set a maximum number of sows and a starting herd — even two maiden gilts. Female pigs are held back at selection weight while places are uncovered, reared on a developer ration, and join the herd once they meet both a service weight and a service age — 140 kg at 240 days by default, inside the 135–170 kg at 220–270 days that guidance commonly gives. When the places are full, maturing gilts are sold as breeding stock instead. No more than two gilts are kept from any one litter, which is ordinary selection practice and stops an expanding herd locking itself into a single farrowing batch.

**No female is ever served by her own sire.** Boars are worked in rotation rather than one boar doing everything, and each is rotated off at the end of a working life you set. As soon as a boar's own daughters come to service, the farm stands a second, unrelated boar — a closed herd filling its sow places from its own gilts cannot otherwise avoid breeding daughters back to their father.

**Generations are tracked, including overlapping ones.** Founding stock is generation 0 and every piglet is one past its dam. A home-bred sow keeps the ear tag she was born with, along with her dam, her sire and the cost of rearing her. Several generations breed side by side, and the simulator reports each one's births, survivors, breeding females, sales and losses.

**Costs follow a pig's age.** Each treatment in the vaccination schedule is charged on the day a pig reaches that age. Heating is charged per day while a pig is under the heated age. Every charge is recorded against the individual animal, split by kind of cost and by the stage it was incurred in — so the app can show what a market pig cost in the farrowing house, as a weaner, as a grower and as a finisher.

**A market pig carries the herd behind it.** "What a market pig costs" is the pig's own bill by stage, plus the breeding herd's running cost net of what it earns on surplus gilts and cull sows, plus its share of overheads. Pigs that die are carried by the pigs that reach the abattoir. Sow feed alone is about $25 a market pig, so a readout that leaves the breeding herd out overstates the margin by more than half.

**Labour is a head-count cost, not a fixed overhead.** Set a wage per stockperson and how many head one can run. The payroll is re-read every month from the herd averaged over the month just gone: a post is taken on as soon as the work is there, and shed only once the herd has fallen clearly below it, so a batch-farrowing herd does not hire and fire month to month.

**Pigs are priced on the carcass.** The sale price is quoted per kilogram deadweight, because that is how abattoirs pay. A pig's liveweight is dressed out at the dressing percentage you set — 70% by default — before it meets the price.

## Reading the plan

- **Money** — switch between months and plan years, and pick any period to see exactly what it is expected to receive and spend, line by line, with the production that drove it.
- **Farm simulator** — pick any date and time inside the plan. The herd is rebuilt animal by animal up to that moment and reports stock numbers, the breeding herd, generations, cost of production and financial standing together.
- **Overview** — the cash curve at monthly or yearly zoom, growing stock by stage, and the checks that need attention.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Quality checks

```bash
npm test
npm run lint
npm run build
```

The plan is saved in the browser on the current device. Use **Export CSV** to save the monthly cashflow outside the browser.

## Where the code lives

| Path | What it holds |
| --- | --- |
| `src/lib/config.ts` | The plan schema, defaults and biological constants. |
| `src/lib/sim/animals.ts` | `Animal`, `Sow`, `Boar`, `GrowingPig` and the per-animal `CostRecord`. |
| `src/lib/sim/farm.ts` | The day-by-day `Farm` simulation and its point-in-time read-out. |
| `src/lib/sim/ledger.ts` | Every cost and receipt, by category and by day. |
| `src/lib/model.ts` | Rolls the daily record up into months, plan years and warnings. |

`farmStateAt(config, "2028-06-15T14:30")` rebuilds the herd up to that moment and returns the stock numbers and the financial standing together.

## Modeling boundary

Litter size, conception, mortality, growth and timing are drawn from a seeded random generator, so one run is a plausible farm rather than the average of many — change the scenario seed to see how much the outcome moves. Sow places are the only capacity limit; growing pens and feed storage are not. Labour scales with head count, but only in money: there is no model of whether the people are available. Inbreeding avoidance goes as far as never serving a female with her own sire; half-sib and cousin matings are not tracked. Heating is a flat daily rate with no seasonal swing. PigFlow is not a diagnosis or treatment tool, a diet-formulation system, or a guarantee of production results. Replace benchmark defaults with local farm records, supplier quotations and a herd-specific veterinary programme.
