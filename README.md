# PigFlow

PigFlow is a transparent piggery cashflow planner built with Next.js, TypeScript, Tailwind CSS, shadcn/ui, Recharts, date-fns and Zod.

The farm is simulated one day at a time. Every sow, boar and growing pig is an object with a sex, a weight, an age and a dam, and it posts its own money to a ledger.

## The rules the simulation runs on

**A pig is an individual.** Its stage sets which ration it eats, its sex scales growth and with it appetite, and what it eats each day is built from the weight it is carrying — so a 95 kg finisher eats measurably more than a 62 kg one. Each pig also carries its own thriftiness, so litter mates do not all reach sale weight on the same day. Suckling piglets live on milk until they are old enough for creep feed.

**Feed conversion is an outcome, not a setting.** A pig eats to stay alive before it eats to grow, so a day's ration is upkeep plus the feed that day's gain costs. Upkeep follows metabolic weight — `(weight ÷ 100 kg)^0.75` of what a 100 kg pig needs — so it rises steadily but less than in proportion, which is the same relationship the housing manual states from the cold end when it puts the extra ration a chilled pig needs at 0.3 g per kilogram of bodyweight per degree. Gain gets dearer separately: a weaner lays down lean, which is largely water, while a finisher lays down fat, which costs several times as much to make, so the price of a kilogram is read off a line between what it costs at 20 kg and at 100 kg. Conversion therefore worsens across the growout from both directions at once — about 1.8 feed to gain in the weaner house, 2.3 in the grower house and 3.1 in the finishing house on the defaults, near 2.5 over the whole growout. Nothing types those ratios in; the plan inputs are the two ends of the curve, and the app shows you what they come to. A pig that grows faster converts better on the same curve, because the same upkeep is spread over more gain — which is why entire males finish cheaper than gilts despite eating more each day.

**The herd grows into its sow places.** Set a maximum number of sows and a starting herd — even two maiden gilts. Female pigs are held back at selection weight while places are uncovered, reared on a developer ration, and join the herd once they meet both a service weight and a service age — 140 kg at 240 days by default, inside the 135–170 kg at 220–270 days that guidance commonly gives. When the places are full, maturing gilts are sold as breeding stock instead. No more than two gilts are kept from any one litter, which is ordinary selection practice and stops an expanding herd locking itself into a single farrowing batch.

**No female is ever served by her own sire.** Boars are worked in rotation rather than one boar doing everything, and each is rotated off at the end of a working life you set. As soon as a boar's own daughters come to service, the farm stands a second, unrelated boar — a closed herd filling its sow places from its own gilts cannot otherwise avoid breeding daughters back to their father.

**Generations are tracked, including overlapping ones.** Founding stock is generation 0 and every piglet is one past its dam. A home-bred sow keeps the ear tag she was born with, along with her dam, her sire and the cost of rearing her. Several generations breed side by side, and the simulator reports each one's births, survivors, breeding females, sales and losses.

**Costs follow a pig's age.** Each treatment in the vaccination schedule is charged on the day a pig reaches that age. Heating is charged per day while a pig is under the heated age. Every charge is recorded against the individual animal, split by kind of cost and by the stage it was incurred in — so the app can show what a market pig cost in the farrowing house, as a weaner, as a grower and as a finisher.

**A market pig carries the herd behind it.** "What a market pig costs" is the pig's own bill by stage, plus the breeding herd's running cost net of what it earns on surplus gilts and cull sows, plus its share of overheads. Pigs that die are carried by the pigs that reach the abattoir. Sow feed alone is about $25 a market pig, so a readout that leaves the breeding herd out overstates the margin by more than half.

**Labour is a head-count cost, not a fixed overhead.** Set a wage per stockperson and how many head one can run. The payroll is re-read every month from the herd averaged over the month just gone: a post is taken on as soon as the work is there, and shed only once the herd has fallen clearly below it, so a batch-farrowing herd does not hire and fire month to month.

**Feed comes by the truckload, and the trips are planned backwards.** Feed is not bought by the mouthful. Once the herd has been simulated, its feeding is walked backwards from the last day and the running total cut into lorry-loads; each trip is then placed on the day the herd starts eating into its load, a buffer ahead of when it is first needed. Walking backwards is the point: it lands the part load at the start of the plan, where a two-sow herd eating six kilograms a day belongs, and leaves every later trip full. Filling forwards would put a full 2.5 tonnes on the farm on day one and the part load at the end, which is the wrong way round.

Because the schedule is read off feeding that has already happened rather than forecast, nothing is delivered that is not eaten and the bins never run dry. Every trip carries an order list — the exact rations it was drawn on for — and shows up in that day's activities. The haulage is paid when the load lands and then rides on the kilograms it brought, so a pig carries its share of the lorry as it eats: about $9 on a market pig at the default 2.5 tonne truck and $60 a trip, small beside the feed itself and invisible if you leave it out.

**You can put income and costs in by hand.** A herd model cannot know about a grant, a roof repair or a licence fee, so any month will take rows of your own. They land on the first day of that month and join the farm's own general lines — money in under `Other income`, money out under `Fixed overheads` — so the cashflow, the workbook and the export all carry them the same way as everything else, with no extra lines to reconcile. A cost you add is a cost of the business: it attracts the contingency percentage and is carried over the pigs sold like any other overhead.

**Funding the plan is two decisions, and it will make both for you.** *Add cash injections* walks the months in order and puts in exactly what each one is short, so the balance never closes below the working capital the plan says to keep. *Withdraw excess* takes the surplus back out as it builds — but only what the leanest month still to come can spare, because money taken out now is gone from every month after it, and drawing each month down to its own surplus would simply hand the shortfall to the next one. Both write ordinary rows you can read, edit and delete, and both can be cleared again. These generated rows are financing rather than farming: they show in the cashflow on the same two lines as everything else, but no contingency is charged on them and they are kept out of what a pig costs to produce, so funding the plan never makes the pork look dearer.

**Pigs leave in cohorts, alive, on the day they are sold.** Litter mates born on one day are one cohort and go together, on the day the cohort's average liveweight reaches the target — so some go a little under it and some over, which is what a batch really does. A pig at a time would be a lorry for a pig at a time; a cohort of ten is a load worth moving. They travel live to the abattoir on the day of the sale: head sold over what the lorry holds — 22 pigs by default — rounded up, so a part load still costs a whole trip and a cohort too big for one load takes another. Each run is charged to the pigs that were on it rather than to the farm at large, so there is no flat charge per head. The farm's haulage ends at the abattoir; what happens past it is another business. It shows in the day's activities alongside the feed lorry coming in, and on its own cashflow line.

The cost of this is that the cashflow is lumpy, and honestly so: on the default two-sow plan, nineteen months of thirty-six have no sale in them at all. Drawing pigs one at a time spread the income evenly, but no small farm sells that way.

**Pigs are priced on the carcass.** The sale price is quoted per kilogram deadweight, because that is how abattoirs pay. A pig's liveweight is dressed out at the dressing percentage you set — 70% by default — before it meets the price.

## Reading the plan

- **The plan picker** — the name in the top bar opens every plan kept on this device. A plan is its inputs and nothing else, so opening another one swaps the herd, the cashflow, the calendar and the workbook together; there is no shared state to leak between them. Duplicating is the point: take the plan you believe in, change one thing — a bigger shed, next year's feed price, a second boar — and keep both to compare. Plans are shared: they live in Cloud Firestore, so a plan built on the farm opens for someone remote, and an edit made in one browser appears in the others within a second. A single plan saved by an earlier version opens as the first one in the list.

- **Financial planning** — switch between months and plan years, and open any period to see exactly what it is expected to receive and spend, line by line, with the production that drove it. On a month you can add your own rows under Income or Expenditure; the panel itemises them and shows the line they post to net of them, so the statement still adds up. Under the table, one button funds the whole plan and another takes the surplus back out.
- **Farm simulator** — a full plan year as a calendar, or the same plan as a list of months. Open any date for that day's cash in and out, everything the farm did — farrowings, weanings, sales, treatments, the feed lorry and what was on it — and the herd split by stage and by what each sow is doing. The page behind it rebuilds the herd animal by animal to that date and reports cost of production and financial standing.
- **Overview** — the cash curve at monthly or yearly zoom, growing stock by stage, and the checks that need attention. Both charts answer to one set of year chips: click a year to look at it on its own, click a second to take in every year between.

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

## Where the plans are kept

Plans live in Cloud Firestore, in one shared collection — there is no per-person
ownership, because the point is that a plan can be opened by someone who is not
on the farm. Getting in needs an email and password account, which you create in
the Firebase console; the app has no sign-up. See
[docs/firebase-setup.md](docs/firebase-setup.md) for the console steps, the
security rules, and what "shared" costs you in privacy.

Offline is not an afterthought. Firestore answers from an on-device IndexedDB
cache and queues writes, so a tab that is already open keeps working on a bad
line and catches up by itself; the badge in the header says which of the two you
are on. A copy of the plans also stays in the browser, which is what opens the
planner if Firebase is unreachable. What this does *not* cover is reloading the
page with no connection — that needs a service worker, which the app does not
ship.

**With no Firebase project configured the app still runs**, keeping plans in the
browser exactly as it did before, and with no sign-in to get past — so a fresh
clone works without credentials.

## Analytics

Page views go to [Vercel Analytics](https://vercel.com/docs/analytics) through
`<Analytics />` in the root layout. It only reports once the app is deployed on
Vercel with Analytics switched on for the project; locally it does nothing. No
plan data is sent — it sees the route, not what is on it.

Use **Export Excel** to take the cashflow out of the app entirely.

## Where the code lives

| Path | What it holds |
| --- | --- |
| `src/lib/config.ts` | The plan schema, defaults and biological constants. |
| `src/lib/growth-curve.ts` | Upkeep, the cost of a kilogram of gain, and the conversion they come to at any weight. |
| `src/lib/workspace.ts` | The set of saved plans, which one is open, and reading them back from the browser. |
| `src/lib/cloud-plans.ts` | Turns stored documents into plans, and works out the smallest set of writes that makes the cloud match the screen. |
| `src/lib/firebase.ts` | Connects to Firestore with its offline cache. |
| `src/lib/auth.ts` | Signing in and out, password resets, and turning Firebase's errors into English. |
| `src/components/auth-gate.tsx` | Sends a signed-out visitor to `/login` instead of an empty planner. |
| `src/hooks/use-workspace.ts` | Holds the plans on screen and keeps them level with everyone else's. |
| `src/lib/sim/animals.ts` | `Animal`, `Sow`, `Boar`, `GrowingPig` and the per-animal `CostRecord`. |
| `src/lib/sim/farm.ts` | The day-by-day `Farm` simulation and its point-in-time read-out. |
| `src/lib/sim/feed-plan.ts` | Cuts the plan's feeding into lorry-loads and places each trip. |
| `src/lib/sim/ledger.ts` | Every cost and receipt, by category and by day. |
| `src/lib/funding.ts` | Works out the cash to put in to stay solvent, and the surplus to take out. |
| `src/lib/model.ts` | Rolls the daily record up into months, plan years and warnings. |

`farmStateAt(config, "2028-06-15T14:30")` rebuilds the herd up to that moment and returns the stock numbers and the financial standing together.

## Modeling boundary

Litter size, conception, mortality, growth and timing are drawn from a seeded random generator, so one run is a plausible farm rather than the average of many — change the scenario seed to see how much the outcome moves. Sow places are the only capacity limit; growing pens are not, and the feed bins are assumed big enough to hold a full load. Feed is costed as it is eaten while the haulage is paid on delivery, so the cashflow shows lumpy delivery charges against a smooth feed bill rather than the full lumpy invoice. The feed schedule is planned with hindsight — it is the cheapest set of trips that would have fed the herd, not a rule a stockperson could follow on the day — and it assumes feed keeps for as long as a load lasts. Labour scales with head count, but only in money: there is no model of whether the people are available. Inbreeding avoidance goes as far as never serving a female with her own sire; half-sib and cousin matings are not tracked. Heating is a flat daily rate with no seasonal swing, and while the feed curve is built on the same relationship that makes a cold pig eat more, temperature itself does not move intake here: the curve is two anchor points and a straight line between them, not a diet formulated against an energy and lysine specification. PigFlow is not a diagnosis or treatment tool, a diet-formulation system, or a guarantee of production results. Replace benchmark defaults with local farm records, supplier quotations and a herd-specific veterinary programme.
