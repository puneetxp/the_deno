// Reading the answer to COM_QUERY: OK packets, result sets (column
// definitions, then rows in the text protocol), and multiple results.

import { serverError } from "./errors.ts";
import { dec, Reader, SERVER_MORE_RESULTS } from "./protocol.ts";
import type { PacketSocket } from "./socket.ts";
import type { Field, ResultSetHeader, Row } from "./types.ts";
import { type Cast, caster } from "./values.ts";

type OneResult = { rows: Row[] | ResultSetHeader; fields?: Field[] };

/** An OK packet: the result of a statement without rows. */
export function okPacket(p: Uint8Array): ResultSetHeader {
  const r = new Reader(p);
  r.u8(); // 0x00
  const affectedRows = r.lenenc() ?? 0;
  const insertId = r.lenenc() ?? 0;
  const serverStatus = r.done ? 0 : r.u16();
  const warningStatus = r.done ? 0 : r.u16();
  // The info text is length-prefixed on most servers, plain on some.
  let infoBytes = r.done ? new Uint8Array(0) : r.rest();
  if (infoBytes.length && infoBytes[0] === infoBytes.length - 1) {
    infoBytes = infoBytes.subarray(1);
  }
  const info = dec.decode(infoBytes);
  const changed = /\schanged:\s*(\d+)/i.exec(info);
  return {
    fieldCount: 0,
    affectedRows,
    insertId,
    info,
    serverStatus,
    warningStatus,
    changedRows: changed ? Number(changed[1]) : 0,
  };
}

/** A column definition packet (protocol 4.1). */
export function parseField(p: Uint8Array): Field {
  const r = new Reader(p);
  r.lenencStr(); // catalog
  const db = r.lenencStr();
  const table = r.lenencStr();
  const orgTable = r.lenencStr();
  const name = r.lenencStr();
  const orgName = r.lenencStr();
  r.lenenc(); // length of the fixed fields (0x0c)
  const characterSet = r.u16();
  const columnLength = r.u32();
  const type = r.u8();
  const flags = r.u16();
  const decimals = r.u8();
  return {
    db,
    table,
    orgTable,
    name,
    orgName,
    characterSet,
    columnLength,
    columnType: type,
    type,
    flags,
    decimals,
  };
}

/**
 * One text-protocol row: a length-encoded string (or 0xfb for NULL) per
 * column. Values are cast straight from the packet bytes.
 */
export function decodeRow(rp: Uint8Array, names: string[], casts: Cast[]): Row {
  const row: Row = {};
  let pos = 0;
  for (let i = 0; i < names.length; i++) {
    let len = rp[pos++];
    if (len === 0xfb) {
      row[names[i]] = null;
      continue;
    }
    if (len === 0xfc) {
      len = rp[pos] | (rp[pos + 1] << 8);
      pos += 2;
    } else if (len === 0xfd) {
      len = rp[pos] | (rp[pos + 1] << 8) | (rp[pos + 2] << 16);
      pos += 3;
    } else if (len === 0xfe) {
      len = (rp[pos] | (rp[pos + 1] << 8) | (rp[pos + 2] << 16)) +
        rp[pos + 3] * 0x1000000 +
        (rp[pos + 4] + rp[pos + 5] * 0x100 + rp[pos + 6] * 0x10000 +
            rp[pos + 7] * 0x1000000) * 0x100000000;
      pos += 8;
    }
    row[names[i]] = casts[i](rp, pos, pos + len);
    pos += len;
  }
  return row;
}

/** An EOF packet (0xfe, under 9 bytes) ends column definitions and rows. */
function isEOF(p: Uint8Array): boolean {
  return p[0] === 0xfe && p.length < 9;
}

/** Column definitions, then rows until EOF. Returns the rows and the status. */
async function readResultSet(
  socket: PacketSocket,
  header: Uint8Array,
): Promise<{ result: OneResult; status: number }> {
  const count = new Reader(header).lenenc() ?? 0;
  const fields: Field[] = [];
  for (let i = 0; i < count; i++) {
    fields.push(parseField(await socket.readPacket()));
  }
  await socket.readPacket(); // EOF after the column definitions

  const names = fields.map((f) => f.name);
  const casts = fields.map(caster);
  const rows: Row[] = [];
  while (true) {
    // Rows already in the buffer are parsed without an await each.
    const rp = socket.bufferedPacket() ?? await socket.readPacket();
    if (isEOF(rp)) {
      return { result: { rows, fields }, status: rp[3] | (rp[4] << 8) };
    }
    if (rp[0] === 0xff) throw serverError(rp);
    rows.push(decodeRow(rp, names, casts));
  }
}

/**
 * Everything the server sends for one COM_QUERY. Returns mysql2's shapes:
 * [rows, fields] for a SELECT, [ResultSetHeader, undefined] otherwise, and
 * arrays of each when a statement (CALL) gives several results.
 */
export async function readResults(
  socket: PacketSocket,
): Promise<[unknown, unknown]> {
  const results: OneResult[] = [];
  while (true) {
    const p = await socket.readPacket();
    if (p[0] === 0x00) {
      const ok = okPacket(p);
      results.push({ rows: ok });
      if (ok.serverStatus & SERVER_MORE_RESULTS) continue;
      break;
    }
    if (p[0] === 0xff) throw serverError(p);
    if (p[0] === 0xfb) {
      // LOCAL INFILE is not enabled; refuse it with an empty packet.
      await socket.writePacket(new Uint8Array(0));
      continue;
    }
    const { result, status } = await readResultSet(socket, p);
    results.push(result);
    if (!(status & SERVER_MORE_RESULTS)) break;
  }
  if (results.length === 1) return [results[0].rows, results[0].fields];
  return [results.map((x) => x.rows), results.map((x) => x.fields)];
}
