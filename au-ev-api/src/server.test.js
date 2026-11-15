/**
 * Comprehensive API Test Suite for BuyersAgent-EV (Node.js 20+ built-in test runner)
 * -----------------------------------------------------------------------------------
 * Covers all routes in server.js:
 *   1. GET  /healthz          (Supabase configured vs unconfigured)
 *   2. GET  /api/v1/evs       (unconfigured, success + payload filtering, HTTP 502, network 500)
 *   3. POST /api/v1/evs       (400 validation, 503 unconfigured, 200 upsert, 502 upstream error)
 *   4. POST /api/v1/evs/seed  (400 empty/invalid body, 503 unconfigured, 200 bulk upsert, 502 error)
 *
 * Run with:
 *   node --test server.test.js
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, signAdminSession, SESSION_COOKIE } from './server.js';

const TEST_SECRET = 'test-session-secret';
const ADMIN_HEADERS = {
  'Content-Type': 'application/json',
  Cookie: `${SESSION_COOKIE}=${signAdminSession(TEST_SECRET)}`
};

let activeServer = null;

/**
 * Helper: Spins up an isolated Express instance on an ephemeral OS port (0)
 */
async function startTestServer(options = {}) {
  const app = createApp({ sessionSecret: TEST_SECRET, ...options });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      activeServer = server;
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(async () => {
  if (activeServer) {
    await new Promise((resolve) => activeServer.close(resolve));
    activeServer = null;
  }
});

// ============================================================================
// 1. GET /healthz
// ============================================================================
describe('GET /healthz', () => {
  it('returns 200 OK with supabaseConfigured: false when env vars are missing', async () => {
    const baseUrl = await startTestServer({ supabaseUrl: '', supabaseKey: '' });
    const res = await fetch(`${baseUrl}/healthz`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.supabaseConfigured, false);
    assert.ok(Date.parse(body.timestamp), 'timestamp should be valid ISO string');
  });

  it('returns 200 OK with supabaseConfigured: true when URL and key are provided', async () => {
    const baseUrl = await startTestServer({
      supabaseUrl: 'https://demo-project.supabase.co/',
      supabaseKey: 'service-role-secret'
    });
    const res = await fetch(`${baseUrl}/healthz`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.supabaseConfigured, true);
  });
});

// ============================================================================
// 2. GET /api/v1/evs
// ============================================================================
describe('GET /api/v1/evs', () => {
  it('returns supabaseConnected: false and empty array when Supabase is not configured', async () => {
    const baseUrl = await startTestServer({ supabaseUrl: '', supabaseKey: '' });
    const res = await fetch(`${baseUrl}/api/v1/evs`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, { supabaseConnected: false, vehicles: [] });
  });

  it('fetches rows from Supabase REST API, verifies headers, and filters invalid payloads', async () => {
    let capturedUrl = '';
    let capturedHeaders = {};

    const mockFetch = async (url, init) => {
      capturedUrl = url;
      capturedHeaders = init.headers;
      return new Response(
        JSON.stringify([
          { payload: { id: 'subaru-trailseeker-awd', make: 'Subaru', model: 'Trailseeker' } },
          { payload: null }, // Should be safely filtered out
          { payload: { make: 'MissingId' } }, // Should be safely filtered out
          { payload: { id: 'geely-ex5-inspire', make: 'Geely', model: 'EX5' } }
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const baseUrl = await startTestServer({
      supabaseUrl: 'https://demo.supabase.co///',
      supabaseKey: 'test-key-123',
      fetchImpl: mockFetch
    });

    const res = await fetch(`${baseUrl}/api/v1/evs`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(capturedUrl, 'https://demo.supabase.co/rest/v1/custom_evs?select=payload');
    assert.equal(capturedHeaders.apikey, 'test-key-123');
    assert.equal(capturedHeaders.Authorization, 'Bearer test-key-123');
    assert.equal(body.supabaseConnected, true);
    assert.equal(body.count, 2);
    assert.equal(body.vehicles.length, 2);
    assert.equal(body.vehicles[0].id, 'subaru-trailseeker-awd');
  });

  it('returns 502 Bad Gateway when Supabase responds with an HTTP error', async () => {
    const mockFetch = async () => new Response('Unauthorized', { status: 401 });

    const baseUrl = await startTestServer({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseKey: 'bad-key',
      fetchImpl: mockFetch
    });

    const res = await fetch(`${baseUrl}/api/v1/evs`);
    const body = await res.json();

    assert.equal(res.status, 502);
    assert.equal(body.supabaseConnected, false);
    assert.match(body.error, /HTTP 401/);
  });

  it('returns 500 Internal Server Error when fetch throws a network exception', async () => {
    const mockFetch = async () => {
      throw new Error('ECONNREFUSED');
    };

    const baseUrl = await startTestServer({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseKey: 'test-key',
      fetchImpl: mockFetch
    });

    const res = await fetch(`${baseUrl}/api/v1/evs`);
    const body = await res.json();

    assert.equal(res.status, 500);
    assert.equal(body.supabaseConnected, false);
    assert.equal(body.error, 'ECONNREFUSED');
  });
});

// ============================================================================
// 3. POST /api/v1/evs
// ============================================================================
describe('POST /api/v1/evs', () => {
  it('returns 400 Bad Request when required fields (id, make, model) are missing', async () => {
    const baseUrl = await startTestServer({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseKey: 'test-key'
    });

    const res = await fetch(`${baseUrl}/api/v1/evs`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ make: 'Tesla' }) // Missing id & model
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.match(body.error, /id, make, and model are required/i);
  });

  it('returns 503 Service Unavailable when Supabase env vars are not configured', async () => {
    const baseUrl = await startTestServer({ supabaseUrl: '', supabaseKey: '' });

    const res = await fetch(`${baseUrl}/api/v1/evs`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ id: 'byd-sealion-7', make: 'BYD', model: 'Sealion 7' })
    });
    const body = await res.json();

    assert.equal(res.status, 503);
    assert.match(body.error, /SUPABASE_URL/);
  });

  it('upserts a valid EV payload into Supabase with resolution=merge-duplicates', async () => {
    let capturedRequest = null;

    const mockFetch = async (url, init) => {
      capturedRequest = { url, method: init.method, headers: init.headers, body: JSON.parse(init.body) };
      return new Response('', { status: 201 });
    };

    const baseUrl = await startTestServer({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseKey: 'service-key',
      fetchImpl: mockFetch
    });

    const sampleVehicle = {
      id: 'zeekr-7x-perf',
      make: 'Zeekr',
      model: '7X',
      variant: 'Performance AWD',
      nswDriveAwayAud: 74900
    };

    const res = await fetch(`${baseUrl}/api/v1/evs`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify(sampleVehicle)
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, { ok: true, id: 'zeekr-7x-perf' });
    assert.equal(capturedRequest.url, 'https://demo.supabase.co/rest/v1/custom_evs');
    assert.equal(capturedRequest.method, 'POST');
    assert.equal(capturedRequest.headers.Prefer, 'resolution=merge-duplicates');
    assert.equal(capturedRequest.body.id, 'zeekr-7x-perf');
    assert.deepEqual(capturedRequest.body.payload, sampleVehicle);
    assert.ok(Date.parse(capturedRequest.body.updated_at));
  });

  it('returns 502 Bad Gateway when Supabase rejects the upsert', async () => {
    const mockFetch = async () => new Response('Relation custom_evs does not exist', { status: 404 });

    const baseUrl = await startTestServer({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseKey: 'service-key',
      fetchImpl: mockFetch
    });

    const res = await fetch(`${baseUrl}/api/v1/evs`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ id: 'kia-ev5', make: 'Kia', model: 'EV5' })
    });
    const body = await res.json();

    assert.equal(res.status, 502);
    assert.match(body.error, /HTTP 404/);
  });
});

// ============================================================================
// 4. POST /api/v1/evs/seed
// ============================================================================
describe('POST /api/v1/evs/seed', () => {
  it('returns 400 Bad Request when vehicles array is empty or missing', async () => {
    const baseUrl = await startTestServer({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseKey: 'service-key'
    });

    const res = await fetch(`${baseUrl}/api/v1/evs/seed`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ vehicles: [] })
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.match(body.error, /non-empty vehicles array/i);
  });

  it('returns 503 Service Unavailable when Supabase is not configured', async () => {
    const baseUrl = await startTestServer({ supabaseUrl: '', supabaseKey: '' });

    const res = await fetch(`${baseUrl}/api/v1/evs/seed`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ vehicles: [{ id: 'mg4', make: 'MG', model: 'MG4' }] })
    });

    assert.equal(res.status, 503);
  });

  it('bulk upserts all vehicles in a single batch call and returns count', async () => {
    let sentRows = [];

    const mockFetch = async (_url, init) => {
      sentRows = JSON.parse(init.body);
      return new Response('', { status: 201 });
    };

    const baseUrl = await startTestServer({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseKey: 'service-key',
      fetchImpl: mockFetch
    });

    const batch = [
      { id: 'polestar-4', make: 'Polestar', model: 'Polestar 4' },
      { id: 'xpeng-g6', make: 'XPeng', model: 'G6' },
      { id: 'volvo-ex40', make: 'Volvo', model: 'EX40' }
    ];

    const res = await fetch(`${baseUrl}/api/v1/evs/seed`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ vehicles: batch })
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, { ok: true, count: 3 });
    assert.equal(sentRows.length, 3);
    assert.equal(sentRows[1].id, 'xpeng-g6');
    assert.deepEqual(sentRows[1].payload, batch[1]);
  });

  it('returns 502 Bad Gateway when Supabase bulk seed fails', async () => {
    const mockFetch = async () => new Response('Server Error', { status: 500 });

    const baseUrl = await startTestServer({
      supabaseUrl: 'https://demo.supabase.co',
      supabaseKey: 'service-key',
      fetchImpl: mockFetch
    });

    const res = await fetch(`${baseUrl}/api/v1/evs/seed`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ vehicles: [{ id: 'id4', make: 'VW', model: 'ID.4' }] })
    });
    const body = await res.json();

    assert.equal(res.status, 502);
    assert.match(body.error, /HTTP 500/);
  });
});

// ============================================================================
// 5. Admin authentication & write protection
// ============================================================================
describe('Admin auth & write protection', () => {
  const supabase = { supabaseUrl: 'https://demo.supabase.co', supabaseKey: 'service-key' };
  const jsonPost = (baseUrl, p, body, headers = {}) => fetch(`${baseUrl}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const pinFromResendCall = (init) => JSON.parse(init.body).subject.match(/(\d{6})/)[1];

  it('rejects POST /api/v1/evs without a session cookie (401) and never calls Supabase', async () => {
    let called = false;
    const baseUrl = await startTestServer({
      ...supabase,
      fetchImpl: async () => {
        called = true;
        return new Response('', { status: 201 });
      }
    });

    const res = await jsonPost(baseUrl, '/api/v1/evs', { id: 'kia-ev5', make: 'Kia', model: 'EV5' });
    assert.equal(res.status, 401);
    assert.equal(called, false);
  });

  it('rejects POST /api/v1/evs/seed without a session cookie (401)', async () => {
    const baseUrl = await startTestServer(supabase);
    const res = await jsonPost(baseUrl, '/api/v1/evs/seed', { vehicles: [{ id: 'mg4', make: 'MG', model: 'MG4' }] });
    assert.equal(res.status, 401);
  });

  it('rejects a session signed with a different secret', async () => {
    const baseUrl = await startTestServer(supabase);
    const res = await jsonPost(baseUrl, '/api/v1/evs', { id: 'kia-ev5', make: 'Kia', model: 'EV5' }, {
      Cookie: `${SESSION_COOKIE}=${signAdminSession('attacker-secret')}`
    });
    assert.equal(res.status, 401);
  });

  it('rejects an expired session', async () => {
    const baseUrl = await startTestServer(supabase);
    const res = await jsonPost(baseUrl, '/api/v1/evs', { id: 'kia-ev5', make: 'Kia', model: 'EV5' }, {
      Cookie: `${SESSION_COOKIE}=${signAdminSession(TEST_SECRET, -1000)}`
    });
    assert.equal(res.status, 401);
  });

  it('rejects ids containing HTML/script characters (400)', async () => {
    const baseUrl = await startTestServer(supabase);
    const res = await fetch(`${baseUrl}/api/v1/evs`, {
      method: 'POST',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ id: '"><img src=x onerror=alert(1)>', make: 'Kia', model: 'EV5' })
    });
    assert.equal(res.status, 400);
  });

  it('GET /api/v1/admin/session reports admin=false without cookie and true with one', async () => {
    const baseUrl = await startTestServer({ adminEmail: 'owner@example.com' });
    const anon = await (await fetch(`${baseUrl}/api/v1/admin/session`)).json();
    assert.deepEqual(anon, { admin: false, loginEnabled: true });
    const admin = await (await fetch(`${baseUrl}/api/v1/admin/session`, { headers: ADMIN_HEADERS })).json();
    assert.equal(admin.admin, true);
  });

  it('full OTP flow: other emails are rejected (403), correct code issues HttpOnly cookie that unlocks writes', async () => {
    let emailedPin = null;
    let resendCalls = 0;
    const mockFetch = async (url, init) => {
      if (url === 'https://api.resend.com/emails') {
        resendCalls += 1;
        emailedPin = pinFromResendCall(init);
        return new Response('{}', { status: 200 });
      }
      return new Response('', { status: 201 });
    };
    const baseUrl = await startTestServer({
      ...supabase,
      adminEmail: 'Owner@Example.com',
      resendApiKey: 're_test',
      fetchImpl: mockFetch
    });

    const wrong = await jsonPost(baseUrl, '/api/v1/admin/send-otp', { email: 'someone@else.com' });
    assert.equal(wrong.status, 403);
    assert.match((await wrong.json()).error, /not authorised/);
    assert.equal(resendCalls, 0, 'no email sent for non-admin address');

    const sent = await jsonPost(baseUrl, '/api/v1/admin/send-otp', { email: 'owner@example.com' });
    assert.equal(sent.status, 200);
    assert.equal(resendCalls, 1);
    assert.match(emailedPin, /^\d{6}$/);

    const again = await jsonPost(baseUrl, '/api/v1/admin/send-otp', { email: 'owner@example.com' });
    assert.equal(again.status, 429, 'cooldown between codes');

    const otherEmailVerify = await jsonPost(baseUrl, '/api/v1/admin/verify-otp', { email: 'someone@else.com', pin: emailedPin });
    assert.equal(otherEmailVerify.status, 403, 'a valid code cannot be used with another email');

    const wrongPin = emailedPin === '000000' ? '111111' : '000000';
    const bad = await jsonPost(baseUrl, '/api/v1/admin/verify-otp', { email: 'owner@example.com', pin: wrongPin });
    assert.equal(bad.status, 401);

    const ok = await jsonPost(baseUrl, '/api/v1/admin/verify-otp', { email: 'owner@example.com', pin: emailedPin });
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get('set-cookie');
    assert.match(setCookie, new RegExp(`^${SESSION_COOKIE}=`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);

    const reuse = await jsonPost(baseUrl, '/api/v1/admin/verify-otp', { email: 'owner@example.com', pin: emailedPin });
    assert.equal(reuse.status, 401, 'code is single-use');

    const cookie = setCookie.split(';')[0];
    const write = await jsonPost(baseUrl, '/api/v1/evs', { id: 'kia-ev5', make: 'Kia', model: 'EV5' }, { Cookie: cookie });
    assert.equal(write.status, 200);
  });

  it('locks out after too many wrong codes', async () => {
    let pin = null;
    const baseUrl = await startTestServer({
      adminEmail: 'owner@example.com',
      resendApiKey: 're_test',
      fetchImpl: async (_url, init) => {
        pin = pinFromResendCall(init);
        return new Response('{}', { status: 200 });
      }
    });

    await jsonPost(baseUrl, '/api/v1/admin/send-otp', { email: 'owner@example.com' });
    const wrongPin = pin === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await jsonPost(baseUrl, '/api/v1/admin/verify-otp', { email: 'owner@example.com', pin: wrongPin });
    }
    const sixth = await jsonPost(baseUrl, '/api/v1/admin/verify-otp', { email: 'owner@example.com', pin });
    assert.equal(sixth.status, 429);
  });

  it('admin login is disabled when ADMIN_EMAIL is not configured', async () => {
    const baseUrl = await startTestServer({ adminEmail: '', resendApiKey: 're_test' });
    const res = await jsonPost(baseUrl, '/api/v1/admin/send-otp', { email: 'x@y.com' });
    assert.equal(res.status, 503);
  });

  it('old public pages (index1-4.html) are no longer served', async () => {
    const baseUrl = await startTestServer();
    const text = await (await fetch(`${baseUrl}/index4.html`)).text();
    assert.doesNotMatch(text, /Admin PIN/);
  });
});
// ============================================================================
// 6. GET /api/v1/catalog
// ============================================================================
describe('GET /api/v1/catalog', () => {
  it('serves the built catalog JSON', async () => {
    const baseUrl = await startTestServer();
    const res = await fetch(`${baseUrl}/api/v1/catalog`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.vehicles) && body.vehicles.length > 100);
    assert.ok(body.states.NSW && body.states.VIC);
  });

  it('returns 503 when the catalog file is missing', async () => {
    const baseUrl = await startTestServer({ catalogPath: '/nonexistent/catalog.json' });
    const res = await fetch(`${baseUrl}/api/v1/catalog`);
    assert.equal(res.status, 503);
  });
});
