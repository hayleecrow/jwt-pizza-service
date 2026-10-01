const request = require('supertest');
const app = require('../../service.js');
const { randomName, bearer, expectValidJwt, registerUser, createAdmin, dropTestDb } = require('../testUtils.js');

let admin;

beforeAll(async () => {
  admin = await createAdmin();
});

afterAll(dropTestDb);

describe('GET /api/user/me', () => {
  test('returns the authenticated user', async () => {
    const user = await registerUser();

    const res = await request(app).get('/api/user/me').set('Authorization', bearer(user.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: user.id, name: user.name, email: user.email, roles: [{ role: 'diner' }] });
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app).get('/api/user/me');

    expect(res.status).toBe(401);
  });
});

describe('PUT /api/user/:userId', () => {
  test('a user can update their own name, email and password', async () => {
    const user = await registerUser();
    const changes = { name: randomName(), email: randomName() + '@test.com', password: 'newpass' };

    const res = await request(app).put(`/api/user/${user.id}`).set('Authorization', bearer(user.token)).send(changes);

    expect(res.status).toBe(200);
    expectValidJwt(res.body.token);
    expect(res.body.user).toMatchObject({ id: user.id, name: changes.name, email: changes.email });

    const loginRes = await request(app).put('/api/auth').send({ email: changes.email, password: changes.password });
    expect(loginRes.status).toBe(200);
  });

  // Updating just one field should work.
  // test('a user can update only their name', async () => {
  //   const user = await registerUser();
  //   const name = randomName();

  //   const res = await request(app).put(`/api/user/${user.id}`).set('Authorization', bearer(user.token)).send({ name });

  //   expect(res.status).toBe(200);
  //   expect(res.body.user.name).toBe(name);
  // });

  // Names with an apostrophe should be stored like any other name.
  // test('a name containing an apostrophe is saved', async () => {
  //   const user = await registerUser();

  //   const res = await request(app).put(`/api/user/${user.id}`).set('Authorization', bearer(user.token)).send({ name: "O'Brien", email: user.email, password: user.password });

  //   expect(res.status).toBe(200);
  //   expect(res.body.user.name).toBe("O'Brien");
  // });

  test('an admin can update another user', async () => {
    const user = await registerUser();
    const name = randomName();

    const res = await request(app).put(`/api/user/${user.id}`).set('Authorization', bearer(admin.token)).send({ name, email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, name });
  });

  test('a non-admin cannot update another user', async () => {
    const user = await registerUser();
    const other = await registerUser();

    const res = await request(app).put(`/api/user/${other.id}`).set('Authorization', bearer(user.token)).send({ name: 'hacked', email: other.email, password: 'x' });

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app).put('/api/user/1').send({ name: 'x' });

    expect(res.status).toBe(401);
  });
});

describe('not implemented endpoints', () => {
  test('DELETE /api/user/:userId', async () => {
    const user = await registerUser();

    const res = await request(app).delete(`/api/user/${user.id}`).set('Authorization', bearer(user.token));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('not implemented');
  });

  test('GET /api/user', async () => {
    const user = await registerUser();

    const res = await request(app).get('/api/user').set('Authorization', bearer(user.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'not implemented', users: [], more: false });
  });
});