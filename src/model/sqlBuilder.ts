type JoinSpec = {
  alias: string;
  table: string;
  localKey: string;
  foreignKey: string;
  cols?: string[];
  prefix?: string;
};

type JoinQuery = {
  sql: string;
  placeholders: Array<string | number>;
  selectParts: string[];
};

export function buildSelectList(
  alias: string,
  cols: string[] = [],
  prefix?: string,
): string[] {
  if (!cols || cols.length === 0) {
    return [`${alias}.*`];
  }
  return cols.map((col) =>
    `${alias}.\`${col}\` AS ${prefix ? `${prefix}__${col}` : col}`
  );
}

export function buildJoinQuery(
  baseTable: string,
  baseAlias: string,
  baseCols: string[],
  joins: JoinSpec[],
  where?: Record<string, any>,
): JoinQuery {
  const selectParts = buildSelectList(baseAlias, baseCols);

  let joinSQL = "";
  for (const join of joins) {
    const relSelect = buildSelectList(
      join.alias,
      join.cols ?? [],
      join.prefix,
    );
    selectParts.push(...relSelect);
    joinSQL += ` LEFT JOIN ${join.table} ${join.alias} ON ${baseAlias}.\`${join.localKey}\` = ${join.alias}.\`${join.foreignKey}\``;
  }

  const whereClauses: string[] = [];
  const placeholders: Array<string | number> = [];
  if (where) {
    for (const [col, val] of Object.entries(where)) {
      if (Array.isArray(val)) {
        whereClauses.push(
          `${baseAlias}.\`${col}\` IN (${val.map(() => "?").join(",")})`,
        );
        placeholders.push(...val);
      } else {
        whereClauses.push(`${baseAlias}.\`${col}\` = ?`);
        placeholders.push(val);
      }
    }
  }

  const whereSQL = whereClauses.length > 0
    ? ` WHERE ${whereClauses.join(" AND ")}`
    : "";

  const sql =
    `SELECT ${selectParts.join(", ")} FROM ${baseTable} ${baseAlias}${joinSQL}${whereSQL}`;

  return { sql, placeholders, selectParts };
}
