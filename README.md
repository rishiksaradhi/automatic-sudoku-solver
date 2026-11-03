# Automatic Sudoku Puzzle Solver

A DAA college project that solves Sudoku with the standard recursive backtracking algorithm in C11. The Express server is only a communication layer: it validates the HTTP request, passes the 81-cell puzzle to the compiled C program, and returns the C program's JSON result. The browser interface uses the existing HTML, CSS, and vanilla JavaScript dashboard.

## Algorithm

The solver follows the row-major recursive backtracking method taught in introductory DAA:

1. Find the first empty cell (`0`) by scanning rows from top to bottom and columns from left to right.
2. Try digits 1 through 9 in that cell.
3. Use `isSafe()` to check the row, column, and 3 × 3 subgrid.
4. If a digit is safe, place it and call `solveSudoku()` recursively.
5. If that recursive call cannot complete the puzzle, restore the cell to `0` and try the next digit.
6. If there are no empty cells, the puzzle is solved. If no candidate works, return failure to the previous call.

There are no MRV or other search optimizations, bitmasks, dynamic programming, greedy decisions, or external solving libraries. GCC is asked to compile with `-O0` so the code stays easy to inspect and explain.

## C functions

All Sudoku data is stored in a `9 × 9` integer array; `0` means empty.

- `isSafe(sudoku, row, column, number)`: returns true only when the number is absent from that row, column, and 3 × 3 box.
- `findEmptyCell(sudoku, &row, &column)`: locates the first zero in row-major order. Returns false if the board has no empty cells.
- `validateSudoku(sudoku)`: checks that all clues are in range and that no two clues violate a Sudoku row, column, or box constraint.
- `solveSudoku(sudoku)`: recursively fills the first empty cell, tries values 1–9, increments `recursiveCalls` for each call, and restores a failed guess to zero before returning.
- `displaySudoku(sudoku)`: prints the solved grid in a readable form to standard error. JSON remains the only content on standard output for the API.

## Requirements

- Node.js 18 or newer.
- GCC with C11 support.

Check the toolchain:

```powershell
node --version
npm --version
gcc --version
```

## Build, test, and run (Windows PowerShell)

Run these commands from the `DAA_FINAL_PROJECT` directory:

```powershell
npm install
npm run build
npm test
npm start
```

Open [http://localhost:3000](http://localhost:3000). Set `$env:PORT = "4000"` before `npm start` to use another port. The same npm commands work on macOS/Linux when GCC is installed.

`npm test` builds the C11 program first. The automated tests cover easy, medium, difficult and extremely difficult puzzles; empty, multiple-solution, invalid, unsolvable and already-completed puzzles; and API input validation, concurrency, timing, sample generation, and C-process failure handling.

## Deploy on Vercel with Container Runtime

The root `Dockerfile.vercel` selects Vercel's Container preset ahead of Express framework detection. The image uses Node.js 24 on Debian Bookworm Slim, installs GCC and the C compilation headers, runs `npm ci`, then runs `npm test`. That test command compiles `solver.c` inside the Linux image and fails the image build if the C build or any automated test fails. The prebuilt Windows `solver.exe` and any local `solver` binary are excluded by `.dockerignore`.

The container sets `NODE_ENV=production` and `PORT=80`, exposes port 80, and starts the existing Express app with `npm start`. Express binds to `0.0.0.0`; its solver path resolves to `/app/solver` on Linux. No Vercel serverless functions or JavaScript Sudoku solver are used.

### Deploy from GitHub

1. Create an empty repository on GitHub (do not initialize it with a README or license), then run these commands from this project directory in PowerShell. Replace the example remote with your repository's URL:

   ```powershell
   git init
   git branch -M main
   git add .
   git commit -m "Prepare Sudoku solver for Vercel containers"
   git remote add origin https://github.com/<OWNER>/<REPOSITORY>.git
   git push -u origin main
   ```

   GitHub authentication may prompt you to sign in. The existing `.gitignore` and `.dockerignore` exclude dependency folders and compiled solver binaries.
2. In Vercel, choose **Add New → Project**, import that GitHub repository, and select the project root as the Root Directory.
3. Keep the detected **Container** framework/preset. `Dockerfile.vercel` is Vercel's explicit container-detection filename and takes precedence over Express framework detection. Do not override it with Express, a Node.js serverless preset, a custom output directory, or a Vercel build command.
4. Deploy. Vercel builds `Dockerfile.vercel`; the build must pass `npm test` before the deployment can start receiving traffic.
5. After deployment, open `https://<your-deployment-domain>/api/health`. Confirm it reports `status: "ok"`, `solver: "C11"`, and `algorithm: "recursive-backtracking"`. Then load the homepage and test the sample/solve/validate controls.

### Deploy with the Vercel CLI

Install the CLI and authenticate, then run these commands from the project root:

```powershell
npm install --global vercel
vercel login
vercel link
vercel deploy
vercel deploy --prod
```

Use the preview URL printed by `vercel deploy` for smoke tests before promoting to production. The first production deployment may ask to link or confirm the project; follow the CLI prompts. Container Runtime is currently in Beta; confirm it is enabled and available for the Vercel team/project.

Vercel's runtime documentation: [Container Runtime](https://vercel.com/docs/functions/runtimes/container).

### Build and run the same image locally

With Docker Desktop (Linux containers) installed, from the project root:

```powershell
docker build --file Dockerfile.vercel --tag automatic-sudoku-solver .
docker run --rm --publish 8080:80 automatic-sudoku-solver
```

Open `http://localhost:8080/api/health` and `http://localhost:8080/`. The build executes `npm test` and compiles the Linux C executable inside the image; no Windows executable is copied into the container.

## C program input and output

The executable reads exactly 81 characters from standard input: `1`–`9` for clues, and `0` or `.` for empty cells. It emits one JSON result to standard output:

```json
{
  "algorithm": "recursive-backtracking",
  "solved": true,
  "recursiveCalls": 52,
  "elapsedMs": 0.031,
  "cpuTimeMs": 0.0,
  "board": [[1,2,3,4,5,6,7,8,9]]
}
```

The example's board is shortened for readability; actual results contain nine rows with nine values each. An invalid clue arrangement returns an `error` field. A valid but unsolvable board returns `solved: false`; because failed guesses are reset, the returned board is restored to the original clues.

## Express API

Puzzle endpoints accept a JSON `board` containing nine rows of nine integers, where zero is empty.

- `GET /api/health` — verifies the compiled C executable is present and reports the active algorithm.
- `GET /api/sample` — returns a newly randomized, solvable sample board, guaranteed to differ from the immediately previous sample served by this process, and its clue count.
- `POST /api/solve` — invokes the C backtracking executable and returns the solved board, recursive call count, and timing metrics.
- `POST /api/validate` — invokes the same C solver and reports whether the clues are conflict-free and solvable.

Example solve request:

```json
{
  "board": [
    [5,3,0,0,7,0,0,0,0],
    [6,0,0,1,9,5,0,0,0],
    [0,9,8,0,0,0,0,6,0],
    [8,0,0,0,6,0,0,0,3],
    [4,0,0,8,0,3,0,0,1],
    [7,0,0,0,2,0,0,0,6],
    [0,6,0,0,0,0,2,8,0],
    [0,0,0,4,1,9,0,0,5],
    [0,0,0,0,8,0,0,7,9]
  ]
}
```

The Node server uses `spawn()` with a fixed executable path and no shell. It enforces a request-size limit and a 10-second solver timeout. Before returning a result, it checks the C response shape, solution constraints and original clues; an unsolved result must contain the restored input board.

## DAA complexity

If there are `m` empty cells, each can have at most nine candidate digits. The simple upper bound for the search time is **O(9^m)**. The recursion depth is at most `m`, so auxiliary recursion space is **O(m)**. Each candidate check examines at most nine row cells, nine column cells, and nine subgrid cells.

`recursiveCalls` includes every invocation of `solveSudoku()`, including the final successful or failing call. `elapsedMs` measures the algorithm with a high-resolution monotonic timer; `cpuTimeMs` reports C CPU time, and `processElapsedMs` includes launching the native executable.

## Project layout

```text
solver.c          C11 recursive backtracking and Sudoku helper functions
build.js          GCC build helper
server.js         Express API and safe C process integration
public/
  index.html      Dashboard markup
  styles.css      Existing responsive dark design
  app.js          Grid editing, API calls, and solve animation
test/
  solver.test.js  Puzzle difficulty, validity, restoration, and malformed-input tests
  api.test.js     API validation, concurrency, and child-process failure tests
```
