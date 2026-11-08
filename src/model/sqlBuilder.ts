import { ident } from "../sql_dialect.ts";

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
  selectParts: string[];
};

export function buildSelectList(
  alias: string,
  cols: string[] = [],
  prefix?: string,
): string[] {
  if (!cols || cols.length === 0) {
    return [`${ident(alias)}.*`];
  }
  return cols.map((col) =>
    `${ident(alias)}.${ident(col)} AS ${
      ident(prefix ? `${prefix}__${col}` : col)
    }`
  );
}

/**
 * SELECT ... FROM base LEFT JOIN ... for Model.withJoin. Conditions, order
 * and limit come from the model's chain and are appended by the caller.
 */
export function buildJoinQuery(
  baseTable: string,
  baseAlias: string,
  baseCols: string[],
  joins: JoinSpec[],
): JoinQuery {
  const selectParts = buildSelectList(baseAlias, baseCols);
  let joinSQL = "";
  for (const join of joins) {
    selectParts.push(
      ...buildSelectList(join.alias, join.cols ?? [], join.prefix),
    );
    joinSQL += ` LEFT JOIN ${join.table} ${ident(join.alias)} ON ${
      ident(baseAlias)
    }.${ident(join.localKey)} = ${ident(join.alias)}.${ident(join.foreignKey)}`;
  }
  const sql = `SELECT ${selectParts.join(", ")} FROM ${baseTable} ${
    ident(baseAlias)
  }${joinSQL}`;
  return { sql, selectParts };
}
