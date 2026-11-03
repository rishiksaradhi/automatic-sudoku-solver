const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const executable = path.join(__dirname, '..', process.platform === 'win32' ? 'solver.exe' : 'solver');
const easyPuzzle =
  '530070000' +
  '600195000' +
  '098000060' +
  '800060003' +
  '400803001' +
  '700020006' +
  '060000280' +
  '000419005' +
  '000080079';
const mediumPuzzle =
  '8........' +
  '..36.....' +
  '.7..9.2..' +
  '.5...7...' +
  '....457..' +
  '...1...3.' +
  '..1....68' +
  '..85...1.' +
  '.9....4..';
const difficultPuzzle =
  '1....7.9.' +
  '.3..2...8' +
  '..96..5..' +
  '..53..9..' +
  '.1..8...2' +
  '6....4...' +
  '3......1.' +
  '.4......7' +
  '..7...3..';
const extremelyDifficultPuzzle =
  '100007090' +
  '030020008' +
  '009600500' +
  '005300900' +
  '010080002' +
  '600004000' +
  '300000010' +
  '040000007' +
  '007000300';
const unsolvablePuzzle =
  '82.........36......7..9.2...5...7.......457.....1...3...1....68..85...1..9....4..';
const invalidPuzzle = `11${'.'.repeat(79)}`;
const completedPuzzle =
  '534678912' +
  '672195348' +
  '198342567' +
  '859761423' +
  '426853791' +
  '713924856' +
  '961537284' +
  '287419635' +
  '345286179';

function runSolver(puzzle) {
  return spawnSync(executable, [], {
    input: puzzle,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true
  });
}

function parseSolverResult(process) {
  assert.equal(process.status, 0, process.stderr);
  return JSON.parse(process.stdout);
}

function assertSolvedBoard(result, puzzle) {
  assert.equal(result.algorithm, 'recursive-backtracking');
  assert.equal(result.solved, true);
  assert.equal(result.board.length, 9);
  assert.ok(result.board.every((row) => row.length === 9));
  assert.ok(result.recursiveCalls > 0);
  assert.ok(result.elapsedMs > 0);
  assert.ok(Number.isFinite(result.cpuTimeMs));

  for (let row = 0; row < 9; row++) {
    assert.deepEqual([...result.board[row]].sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (let column = 0; column < 9; column++) {
      const given = Number(puzzle[row * 9 + column]) || 0;
      if (given) assert.equal(result.board[row][column], given);
    }
  }
  for (let column = 0; column < 9; column++) {
    assert.deepEqual(result.board.map((row) => row[column]).sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  }
  for (let boxRow = 0; boxRow < 9; boxRow += 3) {
    for (let boxColumn = 0; boxColumn < 9; boxColumn += 3) {
      const values = [];
      for (let row = boxRow; row < boxRow + 3; row++) {
        for (let column = boxColumn; column < boxColumn + 3; column++) {
          values.push(result.board[row][column]);
        }
      }
      assert.deepEqual(values.sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
  }
}

test('solves an easy Sudoku using standard recursive backtracking', () => {
  const process = runSolver(easyPuzzle);
  assertSolvedBoard(parseSolverResult(process), easyPuzzle);
  assert.match(process.stderr, /\+-------\+-------\+-------\+/);
});

test('solves a medium Sudoku using standard recursive backtracking', () => {
  assertSolvedBoard(parseSolverResult(runSolver(mediumPuzzle)), mediumPuzzle);
});

test('solves a difficult Sudoku using standard recursive backtracking', () => {
  const result = parseSolverResult(runSolver(difficultPuzzle));
  assertSolvedBoard(result, difficultPuzzle);
  const emptyCells = [...difficultPuzzle].filter((value) => value === '.' || value === '0').length;
  assert.ok(result.recursiveCalls > emptyCells + 1,
    'the difficult puzzle should require at least one failed guess and backtrack');
});

test('solves an extremely difficult Sudoku using standard recursive backtracking', () => {
  const result = parseSolverResult(runSolver(extremelyDifficultPuzzle));
  assertSolvedBoard(result, extremelyDifficultPuzzle);
  assert.ok(result.recursiveCalls > 1000);
});

test('solves an empty Sudoku within the test process limit', () => {
  const emptyPuzzle = '.'.repeat(81);
  assertSolvedBoard(parseSolverResult(runSolver(emptyPuzzle)), emptyPuzzle);
});

test('finds a valid solution for a multiple-solution puzzle', () => {
  const multipleSolutionPuzzle = `1${'.'.repeat(80)}`;
  assertSolvedBoard(parseSolverResult(runSolver(multipleSolutionPuzzle)), multipleSolutionPuzzle);
});

test('rejects row, column, and 3 by 3 box clue duplicates', () => {
  const setCell = (source, index, value) =>
    `${source.slice(0, index)}${value}${source.slice(index + 1)}`;
  const invalidCases = [
    setCell(easyPuzzle, 2, '5'),
    setCell(easyPuzzle, 54, '5'),
    setCell(easyPuzzle, 11, '3')
  ];

  for (const invalid of invalidCases) {
    const result = parseSolverResult(runSolver(invalid));
    assert.match(result.error, /duplicate|invalid/i);
  }
});

test('returns the original board after an unsolvable search backtracks', () => {
  const result = parseSolverResult(runSolver(unsolvablePuzzle));
  assert.equal(result.solved, false);
  assert.equal(result.recursiveCalls > 0, true);
  assert.deepEqual(
    result.board.flat().join(''),
    unsolvablePuzzle.replaceAll('.', '0')
  );
});

test('accepts an already completed Sudoku without changing it', () => {
  const result = parseSolverResult(runSolver(completedPuzzle));
  assertSolvedBoard(result, completedPuzzle);
  assert.equal(result.recursiveCalls, 1);
  assert.equal(result.board.flat().join(''), completedPuzzle);
});

test('rejects malformed characters and incorrect puzzle length', () => {
  const malformed = runSolver(`x${'.'.repeat(80)}`);
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /only digits/i);

  const short = runSolver('.'.repeat(80));
  assert.equal(short.status, 2);
  assert.match(short.stderr, /exactly 81/i);

  const trailing = runSolver(`${'.'.repeat(81)}garbage`);
  assert.equal(trailing.status, 2);
  assert.match(trailing.stderr, /exactly 81/i);
});
