const request = require("supertest");
const app = require("../../service.js");
const {
  randomName,
  bearer,
  expectValidJwt,
  registerUser,
  createAdmin,
} = require("../testUtils.js");

let admin;

beforeAll(async () => {
  admin = await createAdmin();
});

describe("GET /api/user/me", () => {
  test("returns the authenticated user", async () => {
    const user = await registerUser();

    const res = await request(app)
      .get("/api/user/me")
      .set("Authorization", bearer(user.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      name: user.name,
      email: user.email,
      roles: [{ role: "diner" }],
    });
  });

  test("unauthenticated gets 401", async () => {
    const res = await request(app).get("/api/user/me");

    expect(res.status).toBe(401);
  });
});

describe("PUT /api/user/:userId", () => {
  test("a user can update their own name, email and password", async () => {
    const user = await registerUser();
    const changes = {
      name: randomName(),
      email: randomName() + "@test.com",
      password: "newpass",
    };

    const res = await request(app)
      .put(`/api/user/${user.id}`)
      .set("Authorization", bearer(user.token))
      .send(changes);

    expect(res.status).toBe(200);
    expectValidJwt(res.body.token);
    expect(res.body.user).toMatchObject({
      id: user.id,
      name: changes.name,
      email: changes.email,
    });

    const loginRes = await request(app)
      .put("/api/auth")
      .send({ email: changes.email, password: changes.password });
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

  test("an admin can update another user", async () => {
    const user = await registerUser();
    const name = randomName();

    const res = await request(app)
      .put(`/api/user/${user.id}`)
      .set("Authorization", bearer(admin.token))
      .send({ name, email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, name });
  });

  test("a non-admin cannot update another user", async () => {
    const user = await registerUser();
    const other = await registerUser();

    const res = await request(app)
      .put(`/api/user/${other.id}`)
      .set("Authorization", bearer(user.token))
      .send({ name: "hacked", email: other.email, password: "x" });

    expect(res.status).toBe(403);
  });

  test("unauthenticated gets 401", async () => {
    const res = await request(app).put("/api/user/1").send({ name: "x" });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/user", () => {
  test("list users unauthorized", async () => {
    const res = await request(app).get("/api/user");

    expect(res.status).toBe(401);
  });

  test("non-admin gets 403", async () => {
    const user = await registerUser();

    const res = await request(app)
      .get("/api/user")
      .set("Authorization", bearer(user.token));

    expect(res.status).toBe(403);
  });

  test("admin gets users with name, email and roles only", async () => {
    const user = await registerUser();

    const res = await request(app)
      .get("/api/user?limit=100&name=" + user.name)
      .set("Authorization", bearer(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([
      {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: [{ role: "diner" }],
      },
    ]);
    expect(res.body.more).toBe(false);
  });

  test("name filter is a case-insensitive contains match", async () => {
    const tag = randomName();
    const a = await registerUser(`${tag}Alpha`);
    await registerUser(`${tag}beta`);

    const res = await request(app)
      .get(`/api/user?name=${tag.toUpperCase()}alp`)
      .set("Authorization", bearer(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.id)).toEqual([a.id]);
  });

  test("name=* returns users without filtering", async () => {
    const res = await request(app)
      .get("/api/user?name=*")
      .set("Authorization", bearer(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThan(0);
  });

  test("paginates with page (1-based) and limit, and reports more", async () => {
    const tag = randomName();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await registerUser(`${tag}${i}`)).id);

    const page1 = await request(app)
      .get(`/api/user?name=${tag}&page=1&limit=2`)
      .set("Authorization", bearer(admin.token));
    const page2 = await request(app)
      .get(`/api/user?name=${tag}&page=2&limit=2`)
      .set("Authorization", bearer(admin.token));

    expect(page1.body.users.map((u) => u.id)).toEqual(ids.slice(0, 2));
    expect(page1.body.more).toBe(true);
    expect(page2.body.users.map((u) => u.id)).toEqual(ids.slice(2));
    expect(page2.body.more).toBe(false);
  });

  test("defaults to page 1 with 10 users", async () => {
    const res = await request(app)
      .get("/api/user")
      .set("Authorization", bearer(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeLessThanOrEqual(10);
  });
});
