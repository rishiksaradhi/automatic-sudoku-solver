const boardElement = document.querySelector('#board');
const messageElement = document.querySelector('#board-message');
const toastElement = document.querySelector('#toast');

let selectedIndex = 0;
let givenCells = new Set();
let sampleBoard = null;
let lastAttemptBoard = null;
let busy = false;
let toastTimer;

function getCells() {
  return [...boardElement.querySelectorAll('.sudoku-cell')];
}

function getBoard() {
  const cells = getCells();
  return Array.from({ length: 9 }, (_, row) =>
    Array.from({ length: 9 }, (_, column) =>
      Number(cells[row * 9 + column].textContent) || 0));
}

function drawBoard(board) {
  boardElement.replaceChildren();

  for (let index = 0; index < 81; index++) {
    const row = Math.floor(index / 9);
    const column = index % 9;
    const cell = document.createElement('button');
    const value = board[row][column];

    cell.type = 'button';
    cell.className = 'sudoku-cell';
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-label', `Row ${row + 1}, column ${column + 1}${value ? `, ${value}` : ', empty'}`);
    cell.setAttribute('aria-selected', 'false');
    cell.tabIndex = index === selectedIndex ? 0 : -1;
    cell.dataset.index = String(index);
    cell.textContent = value || '';

    if (givenCells.has(index)) {
      cell.classList.add('given');
    }

    cell.addEventListener('click', () => selectCell(index));
    boardElement.append(cell);
  }

  selectCell(Math.min(selectedIndex, 80));
}

function selectCell(index) {
  selectedIndex = index;
  const selectedRow = Math.floor(index / 9);
  const selectedColumn = index % 9;
  const cells = getCells();
  const selectedValue = cells[index].textContent;

  cells.forEach((cell, cellIndex) => {
    const row = Math.floor(cellIndex / 9);
    const column = cellIndex % 9;
    const sameBox = Math.floor(row / 3) === Math.floor(selectedRow / 3) &&
      Math.floor(column / 3) === Math.floor(selectedColumn / 3);

    cell.classList.toggle('selected', cellIndex === index);
    cell.classList.toggle('peer', row === selectedRow || column === selectedColumn || sameBox);
    cell.classList.toggle('same-value', Boolean(selectedValue) &&
      cell.textContent === selectedValue);
    cell.setAttribute('aria-selected', String(cellIndex === index));
    cell.tabIndex = cellIndex === index ? 0 : -1;
  });
}

function setMessage(message, type = '') {
  messageElement.textContent = message;
  messageElement.className = `board-message ${type}`.trim();
}

function showToast(message, isError = false) {
  toastElement.textContent = message;
  toastElement.className = `toast show${isError ? ' error-toast' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastElement.className = 'toast';
  }, 2600);
}

function clearConflictMarks() {
  getCells().forEach((cell) => cell.classList.remove('conflict'));
}

function findConflicts(board) {
  const conflicts = new Set();

  function checkGroup(indices) {
    const seen = new Map();
    for (const index of indices) {
      const value = board[Math.floor(index / 9)][index % 9];
      if (value === 0) continue;

      if (seen.has(value)) {
        conflicts.add(index);
        conflicts.add(seen.get(value));
      } else {
        seen.set(value, index);
      }
    }
  }

  for (let index = 0; index < 9; index++) {
    checkGroup(Array.from({ length: 9 }, (_, cell) => index * 9 + cell));
    checkGroup(Array.from({ length: 9 }, (_, cell) => cell * 9 + index));
  }

  for (let boxRow = 0; boxRow < 3; boxRow++) {
    for (let boxColumn = 0; boxColumn < 3; boxColumn++) {
      checkGroup(Array.from({ length: 9 }, (_, cell) =>
        (boxRow * 3 + Math.floor(cell / 3)) * 9 + boxColumn * 3 + cell % 3));
    }
  }

  return conflicts;
}

function markConflicts(conflicts) {
  clearConflictMarks();
  conflicts.forEach((index) => getCells()[index].classList.add('conflict'));
}

function setBusy(isBusy, status = isBusy ? 'RUNNING' : 'DONE') {
  busy = isBusy;
  ['#solve-button', '#reset-button', '#sample-button', '#validate-button']
    .forEach((selector) => {
      document.querySelector(selector).disabled = isBusy;
    });
  document.querySelectorAll('.pad-button').forEach((button) => {
    button.disabled = isBusy;
  });

  const metricsLabel = document.querySelector('#metrics-label');
  if (isBusy) {
    metricsLabel.textContent = status;
  } else if (status === 'READY' ||
      ['RUNNING', 'VALIDATING', 'LOADING SAMPLE'].includes(metricsLabel.textContent)) {
    metricsLabel.textContent = 'IDLE';
  }
  document.querySelector('#run-state').textContent = isBusy
    ? status
    : status === 'READY' ? 'READY' : 'DONE';
  document.querySelector('.metrics-status').classList.toggle('running', isBusy);
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error('Cannot reach the solver service. Check that the Node.js server is running.');
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`The server returned an invalid response (${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(result.error || `Request failed (${response.status}).`);
  }
  return result;
}

function postBoard(url, board) {
  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board })
  });
}

function formatMilliseconds(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return '—';
  return milliseconds > 0 && milliseconds < 1
    ? milliseconds.toFixed(6)
    : milliseconds.toFixed(3);
}

function displayMetrics(result) {
  document.querySelector('#metric-time').textContent = formatMilliseconds(result.elapsedMs);
  document.querySelector('#metric-calls').textContent =
    Number(result.recursiveCalls).toLocaleString();
  document.querySelector('#metrics-label').textContent = 'BACKTRACKING';
}

function clearMetrics() {
  document.querySelector('#metric-time').textContent = '—';
  document.querySelector('#metric-calls').textContent = '—';
  document.querySelector('#metrics-label').textContent = 'IDLE';
  document.querySelector('#run-state').textContent = 'READY';
}

function enterNumber(number) {
  if (busy) return;
  if (givenCells.has(selectedIndex)) {
    setMessage('Given clue cells are locked. Select an editable cell to enter a number.', 'error');
    return;
  }

  const cell = getCells()[selectedIndex];
  cell.textContent = number === 0 ? '' : String(number);
  cell.classList.remove('solved-cell');
  cell.setAttribute('aria-label',
    `Row ${Math.floor(selectedIndex / 9) + 1}, column ${selectedIndex % 9 + 1}${number ? `, ${number}` : ', empty'}`);

  clearConflictMarks();
  selectCell(selectedIndex);
  clearMetrics();
  lastAttemptBoard = null;
  document.querySelector('#difficulty-label').textContent = 'CUSTOM';
  setMessage('Grid updated. Check it or run the solver.');
}

async function solvePuzzle() {
  if (busy) return;

  const board = getBoard();
  lastAttemptBoard = board.map((row) => row.slice());
  const conflicts = findConflicts(board);
  markConflicts(conflicts);

  setBusy(true);
  setMessage('Running recursive backtracking in the C engine…');

  try {
    const result = await postBoard('/api/solve', board);
    displayMetrics(result);

    if (!result.solved) {
      setMessage('This puzzle has no solution. The original entries were restored.', 'error');
      showToast('No solution exists for this puzzle.', true);
      return;
    }

    await animateSolution(result.board, board);
    setMessage(`Solved with recursive backtracking in ${formatMilliseconds(result.elapsedMs)} ms.`, 'success');
    showToast('Puzzle solved by the C backtracking solver.');
  } catch (error) {
    if (/duplicate|invalid clues/i.test(error.message)) {
      markConflicts(conflicts);
    }
    setMessage(error.message, 'error');
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function validatePuzzle() {
  if (busy) return;

  const board = getBoard();
  markConflicts(findConflicts(board));
  setBusy(true, 'VALIDATING');
  setMessage('Validating this puzzle with the C solver…');

  try {
    const result = await postBoard('/api/validate', board);
    if (result.algorithm) displayMetrics(result);

    if (!result.valid) {
      setMessage(result.message, 'error');
      showToast(result.message, true);
    } else if (!result.solvable) {
      setMessage(result.message, 'error');
      showToast(result.message, true);
    } else {
      setMessage(result.message, 'success');
      showToast('Puzzle validated by the C solver.');
    }
  } catch (error) {
    setMessage(error.message, 'error');
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function loadSample() {
  if (busy) return;

  setBusy(true, 'LOADING SAMPLE');
  setMessage('Generating a fresh Sudoku puzzle…');

  try {
    const result = await requestJson('/api/sample', { cache: 'no-store' });
    const { board, clueCount } = result;
    if (!Array.isArray(board) || board.length !== 9 ||
        board.some((row) => !Array.isArray(row) || row.length !== 9 ||
          row.some((value) => !Number.isInteger(value) || value < 0 || value > 9)) ||
        !Number.isInteger(clueCount) || clueCount !== board.flat().filter(Boolean).length) {
      throw new Error('The server returned an invalid sample puzzle.');
    }

    givenCells = new Set();
    sampleBoard = board.map((row) => row.slice());
    lastAttemptBoard = null;
    board.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
      if (value) givenCells.add(rowIndex * 9 + columnIndex);
    }));
    selectedIndex = 0;
    drawBoard(board);
    clearMetrics();
    document.querySelector('#difficulty-label').textContent = `${clueCount} CLUES`;
    setMessage(`Fresh puzzle loaded with ${clueCount} clues. Solve it when ready.`, 'success');
  } catch (error) {
    setMessage(error.message, 'error');
    showToast(error.message, true);
  } finally {
    setBusy(false, 'READY');
  }
}

function resetBoard() {
  if (busy) return;
  const board = sampleBoard || lastAttemptBoard ||
    Array.from({ length: 9 }, () => Array(9).fill(0));
  lastAttemptBoard = null;
  givenCells = new Set();
  board.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    if (value) givenCells.add(rowIndex * 9 + columnIndex);
  }));
  selectedIndex = 0;
  drawBoard(board.map((row) => row.slice()));
  clearMetrics();
  document.querySelector('#difficulty-label').textContent =
    sampleBoard && board.every((row, rowIndex) =>
      row.every((value, columnIndex) => value === sampleBoard[rowIndex][columnIndex]))
      ? `${board.flat().filter(Boolean).length} CLUES`
      : 'CUSTOM';
  setMessage('Board restored to the original puzzle.');
}

document.querySelectorAll('.pad-button').forEach((button) => {
  button.addEventListener('click', () => {
    enterNumber(Number(button.dataset.value));
    getCells()[selectedIndex].focus();
  });
});
document.querySelector('#sample-button').addEventListener('click', loadSample);
document.querySelector('#reset-button').addEventListener('click', resetBoard);
document.querySelector('#validate-button').addEventListener('click', validatePuzzle);
document.querySelector('#solve-button').addEventListener('click', solvePuzzle);

document.addEventListener('keydown', (event) => {
  const activeCell = event.target instanceof Element
    ? event.target.closest('.sudoku-cell')
    : null;
  if (!activeCell) return;

  if (/^[1-9]$/.test(event.key)) {
    enterNumber(Number(event.key));
    return;
  }

  if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
    event.preventDefault();
    enterNumber(0);
    return;
  }

  const movement = {
    ArrowUp: -9,
    ArrowDown: 9,
    ArrowLeft: -1,
    ArrowRight: 1
  }[event.key];

  if (movement !== undefined) {
    event.preventDefault();
    selectCell(Math.max(0, Math.min(80, selectedIndex + movement)));
    getCells()[selectedIndex].focus();
  }
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function animateSolution(solution, startingBoard) {
  const cells = getCells();
  const emptyCells = [];

  for (let row = 0; row < 9; row++) {
    for (let column = 0; column < 9; column++) {
      if (startingBoard[row][column] === 0) {
        emptyCells.push(row * 9 + column);
      }
    }
  }

  for (const index of emptyCells) {
    const row = Math.floor(index / 9);
    const column = index % 9;
    cells[index].textContent = String(solution[row][column]);
    cells[index].classList.add('solved-cell');
    cells[index].setAttribute('aria-label',
      `Row ${row + 1}, column ${column + 1}, ${solution[row][column]}`);

    if (emptyCells.length <= 45) {
      await delay(20);
    }
  }
}

drawBoard(Array.from({ length: 9 }, () => Array(9).fill(0)));

requestJson('/api/health')
  .then((health) => {
    if (health.status !== 'ok' || health.solver !== 'C11' ||
        health.algorithm !== 'recursive-backtracking') {
      throw new Error('The C backtracking solver is not ready.');
    }
    const status = document.querySelector('#engine-status');
    status.classList.remove('engine-offline');
    status.replaceChildren(
      document.createElement('span'),
      document.createTextNode(' C ENGINE ONLINE')
    );
  })
  .catch((error) => {
    const status = document.querySelector('#engine-status');
    status.classList.add('engine-offline');
    status.replaceChildren(
      document.createElement('span'),
      document.createTextNode(' C ENGINE OFFLINE')
    );
    setMessage(error.message, 'error');
  });
