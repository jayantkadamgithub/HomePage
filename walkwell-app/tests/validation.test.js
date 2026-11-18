/**
 * Validation tests for frontend + backend field rules.
 */
process.env.USE_MOCK_DB = 'true';
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const { app } = require('../src/server');

describe('Signup validation', function () {
  it('rejects too-short userId (<3)', async function () {
    const res = await request(app).post('/api/signup').send({ userId: 'ab', name: 'A', password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('rejects empty name', async function () {
    const res = await request(app).post('/api/signup').send({ userId: 'abcd', name: '', password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('rejects password shorter than 8', async function () {
    const res = await request(app).post('/api/signup').send({ userId: 'abcd', name: 'A', password: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('Login validation', function () {
  it('rejects missing userId', async function () {
    const res = await request(app).post('/api/login').send({ userId: '', password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('rejects missing password', async function () {
    const res = await request(app).post('/api/login').send({ userId: 'jdoe', password: '' });
    expect(res.status).toBe(400);
  });
});

describe('Frontend static files', function () {
  it('serves index.html at root', async function () {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  it('serves styles.css', async function () {
    const res = await request(app).get('/css/styles.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/css/);
  });

  it('serves app.js', async function () {
    const res = await request(app).get('/js/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
  });
});