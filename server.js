const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomInt } = require('node:crypto');
const fs = require('node:fs/promises');
const express = require('express');

const PORT = Number(process.env.PORT) || 3000;
const SOLVER_PATH = path.join(__dirname, process.platform === 'win32' ? 'solver.exe' : 'solver');
const PUZZLE_PATTERN = /^[0-9.]{81}$/;
let previousSampleSignature = null;

function shuffle(values) {
  const shuffled = values.slice();
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function generateSample() {
  let sample;
  let signature;
  do {
    sample = createRandomSample();
    signature = sample.board.flat().join('');
  } while (signature === previousSampleSignature);

  previousSampleSignature = signature;
  return sample;
}

function createRandomSample() {
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const rows = shuffle([0, 1, 2]).flatMap((band) =>
    shuffle([0, 1, 2]).map((offset) => band * 3 + offset));
  const columns = shuffle([0, 1, 2]).flatMap((stack) =>
    shuffle([0, 1, 2]).map((offset) => stack * 3 + offset));
  const transpose = randomInt(2) === 1;
  const solution = rows.map((row) => columns.map((column) => {
    const sourceRow = transpose ? column : row;
    const sourceColumn = transpose ? row : column;
    const value = (sourceRow * 3 + Math.floor(sourceRow / 3) + sourceColumn) % 9;
    return digits[value];
  }));
  const board = solution.map((row) => row.slice());
  const cellsToRemove = randomInt(37, 43);
  for (const index of shuffle(Array.from({ length: 81 }, (_, cell) => cell)).slice(0, cellsToRemove)) {
    board[Math.floor(index / 9)][index % 9] = 0;
  }
  return {
    board,
    clueCount: 81 - cellsToRemove
  };
}

function normalizePuzzle(input) {
  if (!Array.isArray(input) || input.length !== 9 ||
      input.some((row) => !Array.isArray(row) || row.length !== 9)) {
    throw new Error('Board must be a 9 by 9 array.');
  }
  const cells = input.flat();
  if (cells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell > 9)) {
    throw new Error('Every cell must be an integer from 0 to 9.');
  }
  const puzzle = cells.map((cell) => cell === 0 ? '.' : String(cell)).join('');
  if (!PUZZLE_PATTERN.test(puzzle)) {
    throw new Error('Board must contain exactly 81 valid cells.');
  }
  return puzzle;
}

function runSolver(puzzle, {
  solverPath = SOLVER_PATH,
  solverArgs = [],
  timeoutMs = 10000
} = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = process.hrtime.bigint();
    const child = spawn(solverPath, solverArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(Object.assign(new Error(`Solver timed out after ${timeoutMs / 1000} seconds.`), {
          status: 504
        }));
      }
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 16384) {
        child.kill();
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('Solver returned an unexpectedly large response.'));
        }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(Object.assign(new Error(`Unable to start the C solver: ${error.message}`), { status: 503 }));
      }
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `C solver exited with code ${code}.`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          reject(Object.assign(new Error(result.error), {
            status: 400,
            code: 'INVALID_PUZZLE'
          }));
        } else {
          if (!isSolverResult(result, puzzle)) {
            reject(new Error('C solver returned a result with an invalid shape.'));
            return;
          }
          resolve({
            ...result,
            processElapsedMs: Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(3))
          });
        }
      } catch (error) {
        reject(new Error(`Invalid response from C solver: ${error.message}`));
      }
    });
    child.stdin.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Could not send puzzle to C solver: ${error.message}`));
      }
    });
    child.stdin.end(puzzle);
  });
}

function isSolverResult(result, puzzle) {
  const hasValidShape = result !== null &&
    typeof result === 'object' &&
    result.algorithm === 'recursive-backtracking' &&
    typeof result.solved === 'boolean' &&
    Number.isSafeInteger(result.recursiveCalls) &&
    result.recursiveCalls > 0 &&
    Number.isFinite(result.elapsedMs) &&
    result.elapsedMs >= 0 &&
    Number.isFinite(result.cpuTimeMs) &&
    result.cpuTimeMs >= 0 &&
    Array.isArray(result.board) &&
    result.board.length === 9 &&
    result.board.every((row) =>
      Array.isArray(row) &&
      row.length === 9 &&
      row.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 9));

  if (!hasValidShape) return false;
  const board = result.board;
  if (!result.solved) {
    return board.flat().join('') === [...puzzle]
      .map((cell) => cell === '.' ? '0' : cell)
      .join('');
  }

  for (let index = 0; index < 9; index++) {
    const rowValues = board[index];
    const columnValues = board.map((row) => row[index]);
    if (rowValues.includes(0) || columnValues.includes(0) ||
        new Set(rowValues).size !== 9 || new Set(columnValues).size !== 9) return false;
  }
  for (let boxRow = 0; boxRow < 9; boxRow += 3) {
    for (let boxColumn = 0; boxColumn < 9; boxColumn += 3) {
      const box = [];
      for (let row = boxRow; row < boxRow + 3; row++) {
        for (let column = boxColumn; column < boxColumn + 3; column++) {
          box.push(board[row][column]);
        }
      }
      if (box.includes(0) || new Set(box).size !== 9) return false;
    }
  }
  return [...puzzle].every((cell, index) =>
    cell === '.' || board[Math.floor(index / 9)][index % 9] === Number(cell));
}

function readRequest(req) {
  try {
    return { puzzle: normalizePuzzle(req.body?.board) };
  } catch (error) {
    error.status = 400;
    throw error;
  }
}

function createApp(solverOptions = {}) {
  const api = express();
  const configuredSolverPath = solverOptions.solverPath || SOLVER_PATH;
  const logError = solverOptions.logError || console.error;

  api.use(express.json({ limit: '4kb' }));
  api.use(express.static(path.join(__dirname, 'public')));

  api.get('/api/health', async (_req, res, next) => {
    try {
      await fs.access(configuredSolverPath);
      res.json({ status: 'ok', solver: 'C11', algorithm: 'recursive-backtracking' });
    } catch {
      next(Object.assign(new Error('Compiled C solver is unavailable. Run npm run build.'), {
        status: 503
      }));
    }
  });

  api.get('/api/sample', (_req, res) => {
    const { board, clueCount } = generateSample();
    res.set('Cache-Control', 'no-store').json({ board, clueCount });
  });

  api.post('/api/solve', async (req, res, next) => {
    try {
      const { puzzle } = readRequest(req);
      const result = await runSolver(puzzle, solverOptions);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  api.post('/api/validate', async (req, res, next) => {
    try {
      const { puzzle } = readRequest(req);
      let result;
      try {
        result = await runSolver(puzzle, solverOptions);
      } catch (error) {
        if (error.code !== 'INVALID_PUZZLE') throw error;
        res.json({
          valid: false,
          solvable: false,
          message: 'Puzzle contains duplicate or invalid clues.'
        });
        return;
      }

      res.json({
        valid: true,
        solvable: result.solved,
        message: result.solved
          ? 'Puzzle has consistent clues and a solution.'
          : 'Clues are consistent, but the puzzle has no solution.',
        algorithm: result.algorithm,
        recursiveCalls: result.recursiveCalls,
        elapsedMs: result.elapsedMs,
        cpuTimeMs: result.cpuTimeMs,
        processElapsedMs: result.processElapsedMs
      });
    } catch (error) {
      next(error);
    }
  });

  api.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  api.use((error, _req, res, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) logError(error);
    let message = error.message || 'Internal server error.';
    if (error.type === 'entity.parse.failed') message = 'Request body must be valid JSON.';
    if (error.type === 'entity.too.large') message = 'Request body exceeds the 4 KB limit.';
    res.status(status).json({ error: message });
  });

  return api;
}

const app = createApp();

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sudoku Solver listening on 0.0.0.0:${PORT}`);
  });
}

module.exports = { app, createApp, generateSample, isSolverResult, normalizePuzzle, runSolver };
