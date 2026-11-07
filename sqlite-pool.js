/**
 * mysql2-shaped wrapper over sql.js so the store can run without MySQL.
 * Enabled when SQLITE_FILE is set.
 */
const fs = require("fs");
const path = require("path");

let native = null;
let filePath = null;
let txDepth = 0;

function convertSql(sql) {
  let s = String(sql);
  s = s.replace(/ENGINE\s*=\s*InnoDB[^;]*/gi, "");
  s = s.replace(/DEFAULT CHARSET\s*=\s*\w+/gi, "");
  s = s.replace(/COLLATE\s+\w+/gi, "");
  const autoCols = [];
  s = s.replace(/(\w+)\s+INT(?:EGER)?\s+NOT\s+NULL\s+AUTO_INCREMENT/gi, (_, col) => {
    autoCols.push(col);
    return col + " INTEGER PRIMARY KEY AUTOINCREMENT";
  });
  for (const col of autoCols) {
    s = s.replace(new RegExp(",\\s*PRIMARY KEY\\s*\\(\\s*" + col + "\\s*\\)", "gi"), "");
  }
  s = s.replace(/\bINT\b(?!EGER)/gi, "INTEGER");
  s = s.replace(/\bDECIMAL\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, "REAL");
  s = s.replace(/\s+FOR UPDATE\b/gi, "");
  s = s.replace(/INSERT IGNORE/gi, "INSERT OR IGNORE");
  s = s.replace(/UNIQUE KEY\s+\w+\s*\(([^)]+)\)/gi, "UNIQUE($1)");
  return s;
}

function persist() {
  if (!native || !filePath) return;
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const data = native.export();
  fs.writeFileSync(filePath, Buffer.from(data));
}

function rowsFromStmt(stmt) {
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  const converted = convertSql(sql);
  const stmt = native.prepare(converted);
  if (params && params.length) {
    stmt.bind(params);
  }
  const isQuery = /^\s*(SELECT|PRAGMA|SHOW|WITH)\b/i.test(converted);
  if (isQuery) {
    const rows = rowsFromStmt(stmt);
    return [rows, []];
  }
  // consume any leftover (shouldn't step on INSERT/CREATE)
  try {
    while (stmt.step()) {
      /* drain */
    }
  } finally {
    stmt.free();
  }
  // Capture before the last_insert_rowid() query. A later statement
  // resets sql.js's change count, which would hide a successful UPDATE.
  const changes = native.getRowsModified();
  const insertId = Number(
    native.exec("SELECT last_insert_rowid() AS id")[0].values[0][0]
  );
  // sql.js refuses to export while a write transaction is open.
  if (txDepth === 0) persist();
  return [{ affectedRows: changes, insertId }, []];
}

/**
 * One sql.js database cannot host overlapping transactions. Queue every
 * connection and statement so concurrent checkouts actually serialize.
 */
function makeMutex() {
  let chain = Promise.resolve();
  return function acquire() {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const prev = chain;
    chain = prev.then(() => gate, () => gate);
    return prev.then(() => release);
  };
}

function makeConnection() {
  return {
    async query(sql, params) {
      return run(sql, params || []);
    },
    async execute(sql, params) {
      return run(sql, params || []);
    },
    async beginTransaction() {
      native.run("BEGIN");
      txDepth += 1;
    },
    async commit() {
      native.run("COMMIT");
      txDepth = Math.max(0, txDepth - 1);
      persist();
    },
    async rollback() {
      native.run("ROLLBACK");
      txDepth = Math.max(0, txDepth - 1);
    },
    release() {},
  };
}

async function createSqlitePool(sqliteFile) {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  filePath = path.resolve(sqliteFile);
  if (fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    native = new SQL.Database(buf);
  } else {
    native = new SQL.Database();
    persist();
  }

  const acquire = makeMutex();

  async function lockedRun(sql, params) {
    const release = await acquire();
    try {
      return run(sql, params || []);
    } finally {
      release();
    }
  }

  const pool = {
    async query(sql, params) {
      return lockedRun(sql, params);
    },
    async execute(sql, params) {
      return lockedRun(sql, params);
    },
    async getConnection() {
      const release = await acquire();
      let released = false;
      const conn = makeConnection();
      conn.release = () => {
        if (released) return;
        released = true;
        release();
      };
      return conn;
    },
    async end() {
      const release = await acquire();
      try {
        persist();
        if (native) native.close();
        native = null;
      } finally {
        release();
      }
    },
    __sqlite: true,
  };
  return pool;
}

module.exports = { createSqlitePool, convertSql };
