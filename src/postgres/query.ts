// Running statements, as npm:pg does: the simple protocol (Query) when there
// are no parameters, which also allows several statements; otherwise the
// extended protocol (Parse, Describe, Bind, Execute, Sync), with prepared
// statements cached per connection as pgx does (statements.ts).

import { PostgresError, protocolError, serverError } from "./errors.ts";
import { B, enc, F, Reader, Writer } from "./protocol.ts";
import type { MessageSocket } from "./socket.ts";
import type { Prepared, StatementCache } from "./statements.ts";
import type { FieldDef, QueryResult, Row } from "./types.ts";
import { type Decode, decoder, encodeParam } from "./values.ts";

type Param = ReturnType<typeof encodeParam>;

/** A RowDescription body. */
export function parseRowDescription(body: Uint8Array): FieldDef[] {
  const r = new Reader(body);
  const n = r.i16();
  const fields: FieldDef[] = [];
  for (let i = 0; i < n; i++) {
    fields.push({
      name: r.cstr(),
      tableID: r.i32(),
      columnID: r.i16(),
      dataTypeID: r.i32(),
      dataTypeSize: r.i16(),
      dataTypeModifier: r.i32(),
      format: r.i16() === 0 ? "text" : "binary",
    });
  }
  return fields;
}

/** A DataRow body: int16 count, then per column int32 length (-1 NULL) + bytes. */
export function decodeRow(b: Uint8Array, names: string[], decs: Decode[]): Row {
  const row: Row = {};
  let pos = 2;
  for (let i = 0; i < names.length; i++) {
    const len = (b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) |
      b[pos + 3];
    pos += 4;
    if (len < 0) {
      row[names[i]] = null;
      continue;
    }
    row[names[i]] = decs[i](b, pos, pos + len);
    pos += len;
  }
  return row;
}

/** CommandComplete's tag ("INSERT 0 5", "UPDATE 2", "CREATE TABLE"). */
function commandTag(tag: string, result: QueryResult) {
  const m = /^([A-Za-z]+)(?: (\d+))?(?: (\d+))?/.exec(tag);
  if (!m) return;
  result.command = m[1];
  if (m[3]) {
    result.oid = Number(m[2]);
    result.rowCount = Number(m[3]);
  } else if (m[2]) {
    result.rowCount = Number(m[2]);
  }
}

function emptyResult(): QueryResult {
  return { command: null, rowCount: null, oid: null, rows: [], fields: [] };
}

/**
 * Read messages until ReadyForQuery, collecting one result per statement.
 * A server error is thrown only after ReadyForQuery, so the connection is
 * in step for the next query. `known` gives the columns of a cached
 * statement, whose rows come without a RowDescription.
 */
async function readResults(
  socket: MessageSocket,
  known?: Prepared,
): Promise<QueryResult[]> {
  const results: QueryResult[] = [];
  let current = emptyResult();
  let names: string[] = known?.names ?? [];
  let decs: Decode[] = known?.decoders ?? [];
  if (known) current.fields = known.fields;
  let error: PostgresError | null = null;
  while (true) {
    // Rows already in the buffer are parsed without an await each.
    const body = socket.bufferedMessage() ?? await socket.readMessage();
    switch (socket.type) {
      case B.DataRow:
        current.rows.push(decodeRow(body, names, decs));
        break;
      case B.RowDescription:
        current.fields = parseRowDescription(body);
        names = current.fields.map((f) => f.name);
        decs = current.fields.map((f) => decoder(f.dataTypeID));
        break;
      case B.CommandComplete:
        commandTag(new Reader(body).cstr(), current);
        results.push(current);
        current = emptyResult();
        if (known) current.fields = known.fields;
        break;
      case B.EmptyQueryResponse:
        results.push(current);
        current = emptyResult();
        break;
      case B.ErrorResponse:
        error ??= serverError(body);
        break;
      case B.ReadyForQuery:
        socket.txStatus = body[0];
        if (error) throw error;
        return results;
      case B.ParseComplete:
      case B.BindComplete:
      case B.CloseComplete:
      case B.NoData:
      case B.ParameterDescription:
      case B.NoticeResponse:
      case B.ParameterStatus:
      case B.NotificationResponse:
        break;
      case B.CopyInResponse:
      case B.CopyOutResponse:
        throw protocolError("COPY is not supported");
      default:
        throw protocolError(
          `unexpected message ${String.fromCharCode(socket.type)}`,
        );
    }
  }
}

/** Run SQL text with the simple protocol (no parameters). */
export async function simpleQuery(
  socket: MessageSocket,
  sql: string,
): Promise<QueryResult[]> {
  await socket.write(new Writer().start(F.Query).cstr(sql).done());
  return await readResults(socket);
}

/** Bind (with the parameters), Execute and Sync for a statement name. */
function bindExecute(w: Writer, statement: string, values: Param[]) {
  w.start(F.Bind).cstr("").cstr(statement);
  // Parameter formats: bytes go as binary (1), everything else as text (0).
  w.i16(values.length);
  for (const v of values) w.i16(v instanceof Uint8Array ? 1 : 0);
  w.i16(values.length);
  for (const v of values) {
    if (v === null) w.i32(-1);
    else {
      const bytes = typeof v === "string" ? enc.encode(v) : v;
      w.i32(bytes.length).bytes(bytes);
    }
  }
  w.i16(1).i16(0); // all results as text
  w.start(F.Execute).cstr("").i32(0); // all rows
  w.start(F.Sync);
}

/** Errors meaning a cached statement is gone or out of date. */
function isStale(e: unknown): boolean {
  if (!(e instanceof PostgresError)) return false;
  return e.code === "26000" || // prepared statement does not exist
    (e.code === "0A000" && /cached plan/.test(e.message)); // schema changed
}

/**
 * Run one statement with parameters ($1, $2, ...) through the extended
 * protocol. With a cache (as pgx does), each SQL text is prepared once per
 * connection; later runs send only Bind/Execute. Either way it is one round
 * trip.
 */
export async function extendedQuery(
  socket: MessageSocket,
  sql: string,
  params: unknown[],
  cache?: StatementCache,
): Promise<QueryResult[]> {
  const values = params.map(encodeParam);
  const w = new Writer();
  if (!cache) {
    w.start(F.Parse).cstr("").cstr(sql).i16(0); // unnamed; server infers types
    w.start(F.Describe).u8(0x53).cstr(""); // 'S': the statement
    bindExecute(w, "", values);
    await socket.write(w.done());
    return await readResults(socket);
  }

  for (const name of cache.takeClosed()) {
    w.start(F.Close).u8(0x53).cstr(name); // not an error if it is gone
  }
  const known = cache.get(sql);
  if (known) {
    bindExecute(w, known.name, values);
    await socket.write(w.done());
    try {
      return await readResults(socket, known);
    } catch (e) {
      // Prepared again below, unless a transaction has failed (the retry
      // would only fail too).
      if (!isStale(e) || socket.txStatus === 0x45) throw e;
      cache.drop(sql);
      return await extendedQuery(socket, sql, params, cache);
    }
  }

  const name = cache.newName();
  w.start(F.Parse).cstr(name).cstr(sql).i16(0);
  w.start(F.Describe).u8(0x53).cstr(name); // its columns, once
  bindExecute(w, name, values);
  await socket.write(w.done());
  let results: QueryResult[];
  try {
    results = await readResults(socket);
  } catch (e) {
    cache.closeLater(name); // if Parse got that far
    throw e;
  }
  cache.add(sql, name, results[0]?.fields ?? []);
  return results;
}
