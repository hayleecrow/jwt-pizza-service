const request = require('supertest');
const app = require('../../service.js');
const { randomName, bearer, registerUser, createAdmin } = require('../testUtils.js');

let admin;
let diner;
const originalFetch = global.fetch;

beforeAll(async () => {
  admin = await createAdmin();
  diner = await registerUser();
});

beforeEach(() => {
  // The pizza factory is an external service, so it is the only thing mocked here.
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ jwt: 'factory.jwt.token', reportUrl: 'http://report' }) });
});

afterEach(() => {
  global.fetch = originalFetch;
});

async function addMenuItem() {
  const item = { title: randomName(), description: 'test pizza', image: 'pizza.png', price: 0.05 };
  const res = await request(app).put('/api/order/menu').set('Authorization', bearer(admin.token)).send(item);
  return { res, item, saved: res.body.find?.((m) => m.title === item.title) };
}

async function placeOrder(token) {
  const { item, saved } = await addMenuItem();
  const order = { franchiseId: 1, storeId: 1, items: [{ menuId: saved.id, description: item.title, price: item.price }] };
  const res = await request(app).post('/api/order').set('Authorization', bearer(token)).send(order);
  return { res, order };
}

describe('menu', () => {
  test('anyone can get the menu', async () => {
    const res = await request(app).get('/api/order/menu');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('admin can add a menu item', async () => {
    const { res, item, saved } = await addMenuItem();

    expect(res.status).toBe(200);
    expect(saved).toMatchObject({ title: item.title, description: item.description, image: item.image, price: item.price });
  });

  test('non-admin gets 403', async () => {
    const res = await request(app).put('/api/order/menu').set('Authorization', bearer(diner.token)).send({ title: 'x', description: 'x', image: 'x.png', price: 1 });

    expect(res.status).toBe(403);
  });

  test('unauthenticated gets 401', async () => {
    const res = await request(app).put('/api/order/menu').send({ title: 'x', description: 'x', image: 'x.png', price: 1 });

    expect(res.status).toBe(401);
  });
});

describe('orders', () => {
  test('creating an order returns the order and the factory jwt', async () => {
    const { res, order } = await placeOrder(diner.token);

    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject(order);
    expect(res.body.order.id).toEqual(expect.any(Number));
    expect(res.body.jwt).toBe('factory.jwt.token');
    expect(res.body.followLinkToEndChaos).toBe('http://report');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('returns 500 when the factory rejects the order', async () => {
    global.fetch.mockResolvedValue({ ok: false, json: async () => ({ reportUrl: 'http://report' }) });

    const { res } = await placeOrder(diner.token);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to fulfill order at factory');
  });

  test('unauthenticated create gets 401', async () => {
    const res = await request(app).post('/api/order').send({ franchiseId: 1, storeId: 1, items: [] });

    expect(res.status).toBe(401);
  });

  test('a new user has no orders', async () => {
    const user = await registerUser();

    const res = await request(app).get('/api/order').set('Authorization', bearer(user.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dinerId: user.id, orders: [], page: 1 });
  });

  test('lists the orders the user placed, with their items', async () => {
    const user = await registerUser();
    const { res: created, order } = await placeOrder(user.token);

    const res = await request(app).get('/api/order').set('Authorization', bearer(user.token));

    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].id).toBe(created.body.order.id);
    expect(res.body.orders[0].items[0]).toMatchObject(order.items[0]);
  });

  test('unauthenticated list gets 401', async () => {
    const res = await request(app).get('/api/order');

    expect(res.status).toBe(401);
  });
});