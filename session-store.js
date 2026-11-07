/**
 * Server-side session store. The cookie only carries the session id.
 * Each request loads that id from the database and ignores unknown ids.
 */
const session = require("express-session");
const db = require("./db");

class DbSessionStore extends session.Store {
  get(sid, callback) {
    db.getSession(sid)
      .then((sess) => callback(null, sess || null))
      .catch(callback);
  }

  set(sid, sess, callback) {
    db.saveSession(sid, sess)
      .then(() => callback(null))
      .catch(callback);
  }

  destroy(sid, callback) {
    db.destroySession(sid)
      .then(() => callback(null))
      .catch(callback);
  }

  touch(sid, sess, callback) {
    db.touchSession(sid, sess)
      .then(() => callback(null))
      .catch(callback);
  }
}

module.exports = DbSessionStore;
