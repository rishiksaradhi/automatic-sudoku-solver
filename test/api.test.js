const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { app, createApp, normalizePuzzle } = require('../server');

const puzzle = [
  [5, 3, 0, 0, 7, 0, 0, 0, 0],
  [6, 0, 0, 1, 9, 5, 0, 0, 0],
  [0, 9, 8, 0, 0, 0, 0, 6, 0],
  [8, 0, 0, 0, 6, 0, 0, 0, 3],
  [4, 0, 0, 8, 0, 3, 0, 0, 1],
  [7, 0, 0, 0, 2, 0, 0, 0, 6],
  [0, 6, 0, 0, 0, 0, 2, 8, 0],
  [0, 0, 0, 4, 1, 9, 0, 0, 5],
  [0, 0, 0, 0, 8, 0, 0, 7, 9]
];
const consistentUnsolvable = [
  '820000000',
  '003600000',
  '070090200',
  '050007000',
  '000045700',
  '000100030',
  '001000068',
  '008500010',
  '090000400'
].map((row) => [...row].map(Number));

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
});

async function postJson(route, body) {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function withTemporaryServer(serverApp, callback) {
  const temporaryServer = serverApp.listen(0);
  await new Promise((resolve) => temporaryServer.once('listening', resolve));
  const temporaryBaseUrl = `http://127.0.0.1:${temporaryServer.address().port}`;
  try {
    await callback(temporaryBaseUrl);
  } finally {
    await new Promise((resolve, reject) =>
      temporaryServer.close((error) => error ? reject(error) : resolve()));
  }
}

test('normalizes a 9 by 9 board for the C executable', () => {
  const normalized = normalizePuzzle(puzzle);
  assert.equal(normalized.length, 81);
  assert.equal(normalized[0], '5');
  assert.equal(normalized[2], '.');
});

test('health endpoint reports only the syllabus backtracking solver', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    solver: 'C11',
    algorithm: 'recursive-backtracking'
  });
});

test('solve endpoint sends the board to C and returns the solution and measured calls', async () => {
  const response = await postJson('/api/solve', { board: puzzle });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.algorithm, 'recursive-backtracking');
  assert.equal(result.solved, true);
  assert.equal(result.board.length, 9);
  assert.ok(result.board.every((row) => row.length === 9));
  assert.ok(result.recursiveCalls > 0);
  assert.ok(result.elapsedMs > 0);
  assert.ok(result.cpuTimeMs >= 0);
  assert.ok(result.processElapsedMs >= result.elapsedMs);
  assert.ok(Number.isFinite(result.processElapsedMs));
  for (let row = 0; row < 9; row++) {
    for (let column = 0; column < 9; column++) {
      if (puzzle[row][column] !== 0) {
        assert.equal(result.board[row][column], puzzle[row][column]);
      }
    }
  }
});

test('solve endpoint returns a structured error for duplicate clues', async () => {
  const invalid = puzzle.map((row) => row.slice());
  invalid[0][2] = 5;
  const response = await postJson('/api/solve', { board: invalid });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /duplicate|invalid/i);
});

test('validate endpoint reports duplicate clues as invalid without solving', async () => {
  const invalid = puzzle.map((row) => row.slice());
  invalid[0][2] = 5;
  const response = await postJson('/api/validate', { board: invalid });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.valid, false);
  assert.equal(result.solvable, false);
  assert.match(result.message, /duplicate|invalid/i);
});

test('validate endpoint reports clue consistency and solution availability', async () => {
  const response = await postJson('/api/validate', { board: puzzle });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.valid, true);
  assert.equal(result.solvable, true);
  assert.equal(result.algorithm, 'recursive-backtracking');
  assert.ok(result.recursiveCalls > 0);
  assert.ok(result.elapsedMs > 0);
  assert.ok(result.cpuTimeMs >= 0);
  assert.ok(result.processElapsedMs >= result.elapsedMs);
});

test('validate endpoint distinguishes consistent but unsolvable clues', async () => {
  const response = await postJson('/api/validate', { board: consistentUnsolvable });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.valid, true);
  assert.equal(result.solvable, false);
  assert.match(result.message, /no solution/i);
});

test('sample endpoint returns changing boards which are solvable by the C backend', async () => {
  const firstResponse = await fetch(`${baseUrl}/api/sample`);
  const secondResponse = await fetch(`${baseUrl}/api/sample`);
  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.headers.get('cache-control'), 'no-store');
  const first = await firstResponse.json();
  const second = await secondResponse.json();

  for (const sample of [first, second]) {
    assert.equal(sample.board.length, 9);
    assert.ok(sample.board.every((row) => row.length === 9));
    assert.equal(sample.board.flat().filter(Boolean).length, sample.clueCount);
    const solvedResponse = await postJson('/api/solve', { board: sample.board });
    const solved = await solvedResponse.json();
    assert.equal(solvedResponse.status, 200);
    assert.equal(solved.solved, true);
  }
  assert.notDeepEqual(first.board, second.board);
});

test('API rejects malformed boards and malformed JSON', async () => {
  const malformedBoard = await postJson('/api/solve', { board: [[1, 2]] });
  assert.equal(malformedBoard.status, 400);
  assert.match((await malformedBoard.json()).error, /9 by 9/i);

  const malformedJson = await fetch(`${baseUrl}/api/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"board":'
  });
  assert.equal(malformedJson.status, 400);
  assert.deepEqual(await malformedJson.json(), {
    error: 'Request body must be valid JSON.'
  });
});

test('rejects missing boards, incorrect row lengths, and invalid board values', async () => {
  const missingBoard = await postJson('/api/solve', {});
  assert.equal(missingBoard.status, 400);
  assert.match((await missingBoard.json()).error, /board/i);

  const badRow = puzzle.map((row) => row.slice());
  badRow[0].pop();
  const incorrectRow = await postJson('/api/solve', { board: badRow });
  assert.equal(incorrectRow.status, 400);
  assert.match((await incorrectRow.json()).error, /9 by 9/i);

  for (const badValue of [-1, 1.5, 10, '5', null]) {
    const board = puzzle.map((row) => row.slice());
    board[0][0] = badValue;
    const response = await postJson('/api/solve', { board });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /integer from 0 to 9/i);
  }
});

test('returns JSON for unknown API routes and unsupported methods', async () => {
  const unknown = await fetch(`${baseUrl}/api/unknown`);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: 'API route not found.' });

  const unsupportedMethod = await fetch(`${baseUrl}/api/solve`, { method: 'GET' });
  assert.equal(unsupportedMethod.status, 404);
  assert.deepEqual(await unsupportedMethod.json(), { error: 'API route not found.' });
});

test('rejects an empty request body and oversized request JSON', async () => {
  const empty = await fetch(`${baseUrl}/api/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: ''
  });
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /board/i);

  const oversized = await fetch(`${baseUrl}/api/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board: 'x'.repeat(5000) })
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), {
    error: 'Request body exceeds the 4 KB limit.'
  });
});

test('handles concurrent C solver requests independently', async () => {
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => postJson('/api/solve', { board: puzzle })));
  const results = await Promise.all(responses.map(async (response) => {
    assert.equal(response.status, 200);
    return response.json();
  }));
  assert.ok(results.every((result) =>
    result.solved && result.algorithm === 'recursive-backtracking'));
  assert.ok(results.every((result) => result.recursiveCalls === results[0].recursiveCalls));
});

test('reports an unavailable C executable through health and solve APIs', async () => {
  await withTemporaryServer(createApp({
    solverPath: `${process.cwd()}\\missing-solver.exe`,
    logError: () => {}
  }),
    async (url) => {
      const health = await fetch(`${url}/api/health`);
      assert.equal(health.status, 503);
      assert.match((await health.json()).error, /compiled C solver is unavailable/i);

      const response = await fetch(`${url}/api/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: puzzle })
      });
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /unable to start the C solver/i);
    });
});

test('reports nonzero exit, invalid JSON, and invalid solver result shapes', async () => {
  const cases = [
    { solverArgs: ['-e', 'process.exit(7)'] },
    { solverArgs: ['-e', 'process.stdout.write("not-json")'] },
    { solverArgs: ['-e', 'process.stdout.write(JSON.stringify({ solved: true }))'] },
    {
      solverArgs: ['-e', `process.stdout.write(JSON.stringify({
        algorithm: 'recursive-backtracking',
        solved: true,
        recursiveCalls: 1,
        elapsedMs: 1,
        cpuTimeMs: 1,
        board: Array.from({ length: 9 }, () => Array(9).fill(1))
      }))`]
    }
  ];

  for (const options of cases) {
    await withTemporaryServer(createApp({
      solverPath: process.execPath,
      logError: () => {},
      ...options
    }), async (url) => {
      const response = await fetch(`${url}/api/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: puzzle })
      });
      assert.equal(response.status, 500);
      assert.equal(typeof (await response.json()).error, 'string');
    });
  }
});

test('rejects a C child process that exceeds the stdout response limit', async () => {
  await withTemporaryServer(createApp({
    solverPath: process.execPath,
    solverArgs: ['-e', 'process.stdout.write("x".repeat(20000))'],
    logError: () => {}
  }), async (url) => {
    const response = await fetch(`${url}/api/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: puzzle })
    });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /unexpectedly large response/i);
  });
});

test('terminates an over-time-limit solver process and returns a gateway timeout', async () => {
  await withTemporaryServer(createApp({
    solverPath: process.execPath,
    solverArgs: ['-e', 'setTimeout(() => {}, 1000)'],
    timeoutMs: 30,
    logError: () => {}
  }), async (url) => {
    const response = await fetch(`${url}/api/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: puzzle })
    });
    assert.equal(response.status, 504);
    assert.match((await response.json()).error, /timed out/i);
  });
});

test('rejects invalid board values in normalization', () => {
  for (const badValue of [-1, 1.5, 10, '5', null]) {
    const board = puzzle.map((row) => row.slice());
    board[0][0] = badValue;
    assert.throws(() => normalizePuzzle(board), /integer from 0 to 9/i);
  }
});
