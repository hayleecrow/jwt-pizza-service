const request = require('supertest');
const app = require('../../service.js');
const { randomName, bearer, registerUser, createAdmin, createFranchise, dropTestDb } = require('../testUtils.js');

let admin;
let franchisee;
let otherUser;

beforeAll(async () => {
  admin = await createAdmin();
  franchisee = await registerUser();
  otherUser = await registerUser();
});

afterAll(dropTestDb);

async function listFranchises(query) {
  return request(app).get(`/api/franchise?${query}`);
}

describe('GET /api/franchise', () => {
  test('lists franchises without authentication, filtered by name', async () => {
    const franchise = await createFranchise(admin.token, franchisee.email);

    const res = await listFranchises(`name=${franchise.name}`);

    expect(res.status).toBe(200);
    expect(res.body.franchises).toHaveLength(1);
    expect(res.body.franchises[0]).toMatchObject({ id: franchise.id, name: franchise.name, stores: [] });
    expect(res.body.more).toBe(false);
  });

  test('pages results and reports when there are more', async () => {
    const prefix = randomName();
    await createFranchise(admin.token, franchisee.email, prefix + 'a');
    await createFranchise(admin.token, franchisee.email, prefix + 'b');

    const res = await listFranchises(`page=0&limit=1&name=${prefix}*`);

    expect(res.status).toBe(200);
    expect(res.body.franchises).toHaveLength(1);
    expect(res.body.more).toBe(true);
  });

  test('an admin also sees the franchise admins', async () => {
    const franchise = await createFranchise(admin.token, franchisee.email);

    const res = await request(app).get(`/api/franchise?name=${franchise.name}`).set('Authorization', bearer(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.franchises[0].admins).toMatchObject([{ id: franchisee.id, email: franchisee.email }]);
  });
});

describe('GET /api/franchise/:userId', () => {
  test('a franchisee can list their own franchises', async () => {
    const franchise = await createFranchise(admin.token, franchisee.email);

    const res = await request(app).get(`/api/franchise/${franchisee.id}`).set('Authorization', bearer(franchisee.token));

    expect(res.status).toBe(200);
    expect(res.body.map((f) => f.id)).toContain(franchise.id);
  });

  test('an admin can list another user\'s franchises', async () => {
    const franchise = await createFranchise(admin.token, franchisee.email);

    const res = await request(app).get(`/api/franchise/${franchisee.id}`).set('Authorization', bearer(admin.token));

    expect(res.body.map((f) => f.id)).toContain(franchise.id);
  });

  test('a non-admin gets an empty list for another user', async () => {
    await createFranchise(admin.token, franchisee.email);

    const res = await request(app).get(`/api/franchise/${franchisee.id}`).set('Authorization', bearer(otherUser.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app).get(`/api/franchise/${franchisee.id}`);

    expect(res.status).toBe(401);
  });
});

describe('POST /api/franchise', () => {
  test('admin can create a franchise', async () => {
    const name = randomName();

    const res = await request(app).post('/api/franchise').set('Authorization', bearer(admin.token)).send({ name, admins: [{ email: franchisee.email }] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name, admins: [{ email: franchisee.email, id: franchisee.id }] });
    expect(res.body.id).toEqual(expect.any(Number));
  });

  test('returns 404 for an unknown admin email', async () => {
    const res = await request(app).post('/api/franchise').set('Authorization', bearer(admin.token)).send({ name: randomName(), admins: [{ email: 'nobody@test.com' }] });

    expect(res.status).toBe(404);
  });

  test('non-admin gets 403', async () => {
    const res = await request(app).post('/api/franchise').set('Authorization', bearer(otherUser.token)).send({ name: randomName(), admins: [{ email: otherUser.email }] });

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app).post('/api/franchise').send({ name: randomName(), admins: [] });

    expect(res.status).toBe(401);
  });
});

// The docs say deleting a franchise requires auth. Unauthenticated and non-admin requests are tested before the admin one.
describe('DELETE /api/franchise/:franchiseId', () => {
  // test('unauthenticated gets 401', async () => {
  //   const franchise = await createFranchise(admin.token, franchisee.email);

  //   const res = await request(app).delete(`/api/franchise/${franchise.id}`);

  //   expect(res.status).toBe(401);
  // });

  // test('non-admin gets 403', async () => {
  //   const franchise = await createFranchise(admin.token, franchisee.email);

  //   const res = await request(app).delete(`/api/franchise/${franchise.id}`).set('Authorization', bearer(otherUser.token));

  //   expect(res.status).toBe(403);
  // });

  test('admin can delete a franchise', async () => {
    const franchise = await createFranchise(admin.token, franchisee.email);

    const res = await request(app).delete(`/api/franchise/${franchise.id}`).set('Authorization', bearer(admin.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'franchise deleted' });
    const listRes = await listFranchises(`name=${franchise.name}`);
    expect(listRes.body.franchises).toEqual([]);
  });
});

describe('POST /api/franchise/:franchiseId/store', () => {
  test('a franchisee can create a store', async () => {
    const franchise = await createFranchise(admin.token, franchisee.email);
    const name = randomName();

    const res = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', bearer(franchisee.token)).send({ name });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name, franchiseId: franchise.id });
    const listRes = await listFranchises(`name=${franchise.name}`);
    expect(listRes.body.franchises[0].stores).toMatchObject([{ id: res.body.id, name }]);
  });

  test('an admin can create a store', async () => {
    const franchise = await createFranchise(admin.token, franchisee.email);

    const res = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', bearer(admin.token)).send({ name: randomName() });

    expect(res.status).toBe(200);
  });

  test('someone who is not an admin of the franchise gets 403', async () => {
    const franchise = await createFranchise(admin.token, franchisee.email);

    const res = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', bearer(otherUser.token)).send({ name: randomName() });

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app).post('/api/franchise/1/store').send({ name: randomName() });

    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/franchise/:franchiseId/store/:storeId', () => {
  async function createStore(franchise) {
    const res = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', bearer(franchisee.token)).send({ name: randomName() });
    return res.body;
  }

  test('a franchisee can delete a store', async () => {
    const franchise = await createFranchise(admin.token, franchisee.email);
    const store = await createStore(franchise);

    const res = await request(app).delete(`/api/franchise/${franchise.id}/store/${store.id}`).set('Authorization', bearer(franchisee.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'store deleted' });
    const listRes = await listFranchises(`name=${franchise.name}`);
    expect(listRes.body.franchises[0].stores).toEqual([]);
  });

  test('someone who is not an admin of the franchise gets 403', async () => {
    const franchise = await createFranchise(admin.token, franchisee.email);
    const store = await createStore(franchise);

    const res = await request(app).delete(`/api/franchise/${franchise.id}/store/${store.id}`).set('Authorization', bearer(otherUser.token));

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app).delete('/api/franchise/1/store/1');

    expect(res.status).toBe(401);
  });
});