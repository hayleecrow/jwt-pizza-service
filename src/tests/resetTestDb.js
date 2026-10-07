const mysql = require('mysql2/promise');

// Drops pizza_test, and optionally recreates it empty. Refuses to touch any other database.
// The app creates the tables itself the first time it connects.
module.exports = async function resetTestDb({ recreate }) {
  process.env.DB_NAME = 'pizza_test';
  const config = require('../config.js');
  const { database, host, user, password, connectTimeout } = config.db.connection;
  if (database !== 'pizza_test') {
    throw new Error(`Refusing to reset database "${database}"; tests must use pizza_test`);
  }

  const connection = await mysql.createConnection({ host, user, password, connectTimeout });
  try {
    await connection.query('DROP DATABASE IF EXISTS pizza_test');
    if (recreate) {
      await connection.query('CREATE DATABASE pizza_test');
    }
  } finally {
    await connection.end();
  }
};
