const resetTestDb = require('./resetTestDb.js');

// Runs once before all test files: start from an empty pizza_test database.
module.exports = async () => {
  await resetTestDb({ recreate: true });
};
