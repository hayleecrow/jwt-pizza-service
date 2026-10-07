const request = require('supertest');
const app = require('../../service.js');
const { randomName, bearer, expectValidJwt, registerUser } = require('../testUtils.js');

let testUser;

beforeAll(async () => {
  testUser = await registerUser();
});

describe('register', () => {
  test('creates a diner and returns a token', async () => {
    const newUser = { name: randomName(), email: randomName() + '@test.com', password: 'a' };

    const res = await request(app).post('/api/auth').send(newUser);

    expect(res.status).toBe(200);
    expectValidJwt(res.body.token);
    expect(res.body.user).toMatchObject({ name: newUser.name, email: newUser.email, roles: [{ role: 'diner' }] });
    expect(res.body.user.password).toBeUndefined();
  });

  test.each([
    [{ email: 'a@test.com', password: 'a' }],
    [{ name: 'a', password: 'a' }],
    [{ name: 'a', email: 'a@test.com' }],
  ])('returns 400 when a field is missing: %j', async (body) => {
    const res = await request(app).post('/api/auth').send(body);

    expect(res.status).toBe(400);
  });

  // The same email should not be able to register twice.
  // test('rejects a duplicate email', async () => {
  //   const res = await request(app).post('/api/auth').send({ name: 'copy', email: testUser.email, password: 'a' });

  //   expect(res.status).toBeGreaterThanOrEqual(400);
  // });
});

describe('login', () => {
  test('returns the user and a token', async () => {
    const res = await request(app).put('/api/auth').send({ email: testUser.email, password: testUser.password });

    expect(res.status).toBe(200);
    expectValidJwt(res.body.token);
    expect(res.body.user).toMatchObject({ name: testUser.name, email: testUser.email, roles: [{ role: 'diner' }] });
    expect(res.body.user.password).toBeUndefined();
  });

  test('returns 404 for a wrong password', async () => {
    const res = await request(app).put('/api/auth').send({ email: testUser.email, password: 'wrong' });

    expect(res.status).toBe(404);
  });

  test('returns 404 for an unknown email', async () => {
    const res = await request(app).put('/api/auth').send({ email: 'nobody@test.com', password: 'a' });

    expect(res.status).toBe(404);
  });

  // Stack traces should not be sent to clients.
  // test('error responses do not include a stack trace', async () => {
  //   const res = await request(app).put('/api/auth').send({ email: 'nobody@test.com', password: 'a' });

  //   expect(res.body.stack).toBeUndefined();
  // });
});

describe('logout', () => {
  test('logs out and invalidates the token', async () => {
    const user = await registerUser();

    const logoutRes = await request(app).delete('/api/auth').set('Authorization', bearer(user.token));
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body).toEqual({ message: 'logout successful' });

    const meRes = await request(app).get('/api/user/me').set('Authorization', bearer(user.token));
    expect(meRes.status).toBe(401);
  });

  test('returns 401 without a token', async () => {
    const res = await request(app).delete('/api/auth');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('unauthorized');
  });

  test('returns 401 for a malformed token', async () => {
    const res = await request(app).delete('/api/auth').set('Authorization', bearer('not.a.jwt'));

    expect(res.status).toBe(401);
  });
});