const request = require('supertest');
const app = require('../service.js');
const { DB, Role } = require('../database/database.js');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

function bearer(token) {
  return `Bearer ${token}`;
}

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

// Registers a new diner through the API.
async function registerUser() {
  const user = { name: randomName(), email: randomName() + '@test.com', password: 'a' };
  const res = await request(app).post('/api/auth').send(user);
  expectValidJwt(res.body.token);
  return { ...user, id: res.body.user.id, token: res.body.token };
}

// Inserts an admin straight into the database, then logs in through the API.
async function createAdmin() {
  const admin = { name: randomName(), email: randomName() + '@test.com', password: 'admin', roles: [{ role: Role.Admin }] };
  await DB.addUser(admin);
  const res = await request(app).put('/api/auth').send({ email: admin.email, password: admin.password });
  expectValidJwt(res.body.token);
  return { ...admin, id: res.body.user.id, token: res.body.token };
}

// Creates a franchise (as an admin) whose franchisee is the user with the given email.
async function createFranchise(adminToken, franchiseeEmail, name = randomName()) {
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', bearer(adminToken))
    .send({ name, admins: [{ email: franchiseeEmail }] });
  return res.body;
}

module.exports = { randomName, bearer, expectValidJwt, registerUser, createAdmin, createFranchise };