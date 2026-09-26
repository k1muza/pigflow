# FeedSport ingredient snapshot

PigFlow keeps a source-faithful snapshot of the FeedSport ingredient and nutrient catalogues here.

The snapshot is intentionally separate from PigFlow's structured formulation library. It preserves FeedSport ingredient IDs, nutrient IDs, values, source-table labels and basis exactly so that the mapping from source data into PigFlow's formulation model can be explicit and testable rather than hidden inside a copy operation.

The current snapshot contains 324 ingredients and 155 nutrient definitions. Fifty-three ingredients contain swine-specific nutrient rows from the Brazilian Tables for Poultry and Swine enrichment.

## Refresh

Run:

```bash
npm run data:import-feedsport
```

To import another FeedSport ref:

```bash
npm run data:import-feedsport -- --ref main
```

The importer resolves the ref to an exact commit, rewrites the JSON shards, updates `manifest.json`, and regenerates `snapshot.ts`. Set `GITHUB_TOKEN` if unauthenticated GitHub API rate limits are a problem.

Do not edit the generated JSON shards or `snapshot.ts` by hand.

## Known upstream issue

FeedSport currently has one nutrient ID referenced by ingredient compositions but absent from its nutrient catalogue: `118`. It appears on the source "Fatty acids" rows. PigFlow preserves the source rows and records the unresolved ID in `manifest.json`; it does not guess a nutrient name.
