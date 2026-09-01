/**
 * mysql2-shaped wrapper over sql.js so the store can run without MySQL.
 * Enabled when SQLITE_FILE is set.
 */
const fs = require("fs");
const path = require("path");

let native = null;
let filePath = null;

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
  const insertId = Number(
    native.exec("SELECT last_insert_rowid() AS id")[0].values[0][0]
  );
  const changes = native.getRowsModified();
  persist();
  return [{ affectedRows: changes, insertId }, []];
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
    },
    async commit() {
      native.run("COMMIT");
      persist();
    },
    async rollback() {
      native.run("ROLLBACK");
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

  const pool = {
    async query(sql, params) {
      return run(sql, params || []);
    },
    async execute(sql, params) {
      return run(sql, params || []);
    },
    async getConnection() {
      return makeConnection();
    },
    async end() {
      persist();
      native.close();
      native = null;
    },
    __sqlite: true,
  };
  return pool;
}

module.exports = { createSqlitePool, convertSql };
