const resetTestDb = require('./resetTestDb.js');

// Runs once after all test files: drop pizza_test so nothing is left behind.
module.exports = async () => {
  await resetTestDb({ recreate: false });
};
