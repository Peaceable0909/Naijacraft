// Adapts Node's built-in SQLite to the subset of the Durable Object `sql.exec()` API that the cores use
// (exec(query, ...bindings) -> cursor with toArray()/one()), so server logic can be unit-tested without workerd.
import { DatabaseSync } from 'node:sqlite';

const toBindable = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);

export function memorySql() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    exec(query, ...params) {
      const stmt = db.prepare(query);
      const args = params.map(toBindable);
      if (/^\s*(select|pragma|with)/i.test(query)) {
        const rows = stmt.all(...args).map((r) => ({ ...r }));
        return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('expected one row'); return rows[0]; }, [Symbol.iterator]: () => rows[Symbol.iterator]() };
      }
      stmt.run(...args);
      return { toArray: () => [], one: () => { throw new Error('no rows'); }, [Symbol.iterator]: () => [][Symbol.iterator]() };
    },
  };
}
