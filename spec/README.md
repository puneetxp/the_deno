# Query builder contract (all adapters)

Every adapter of the framework (Deno, PHP, Go, .NET, Python, ...) builds
queries the same way: from a model's chain, never from SQL written in the
app. Relations are used by name, from the model's relations map, which
compile-php generates from `database/Model/*.json`.

`query_cases.json` holds the cases. Each adapter's tests replay every case
and must produce exactly the `sql` and `params` given. the_deno runs them in
`src/model_query_test.ts`; copy that runner for a new adapter.

## The chain

| Step | Meaning |
| --- | --- |
| `where({col: value})` | `col IN (?)`. A list gives `IN (?, ?)`; an empty list matches nothing (`1 = 0`). Calls chain with AND. Several columns in one call come out in column-name order, so the SQL never depends on map order (Go maps have none). |
| `where({...}, true)` | Same, but first drops the conditions added earlier in the chain. |
| `whereHas(rel, {col: value})` | Keep rows with a related row matching the conditions. |
| `whereHas(rel, related => related.where(...)...)` | The same, with any chain on the related model, including more `whereHas`. |
| `whereNotHas(rel, ...)` | Keep rows with no such related row. |
| `orderBy(col, "ASC" \| "DESC")` | Default `ASC`. Anything else is an error. |
| `limit(count, offset = 0)` | Whole numbers >= 0, otherwise an error. |
| `withJoin([rel, ...])` | Runs the chain with a LEFT JOIN per relation; related columns come back as `<rel>__<col>` and are nested as `row[rel]`. |
| `toSQL()` | The SQL and params the chain would run, without running it. |

The builder is cleared after every query, and after `toSQL()`. No condition,
order or limit carries over to the next query.

An unknown relation name is an error that lists the model's relations.

## SQL shape

- Columns and aliases are quoted. Table names after FROM and JOIN are not.
- `whereHas(rel)` with relation `{table, name, key}` (local column `name`,
  related column `key`) on a model whose table is `T` becomes:
  `EXISTS (SELECT 1 FROM <table> AS <table>__<depth> WHERE <table>__<depth>.<key> = T.<name> AND (<conditions>))`
  - `<depth>` is 1 for a `whereHas` on the query itself, and 2 inside that
    one's chain, and so on. Inside, `T` is the outer alias. The alias depends
    only on the chain, so the same chain always gives the same SQL.
  - Without conditions, the `AND (...)` part is left out.
- `withJoin` names the base table by itself (`FROM t \`t\``) and joins
  each relation as `` `r_<rel>` ``. Conditions, order and limit from the
  chain are qualified with the base table.

## Dialects

`sql` in the cases is the MySQL form. For PostgreSQL an adapter sends the
same query with `?` numbered `$1, $2, ...` and backticks as double quotes.
Text inside string literals and comments is not touched.

Drivers return the same shapes:
- writes give `{insertId, affectedRows}`;
- 64-bit integers come back as numbers;
- DECIMAL comes back as a string.

## Adding to the contract

Add a case to `query_cases.json`, and the step to every adapter's runner, in
the same change. A step that can't be written as data in the file shouldn't
be in the chain.
