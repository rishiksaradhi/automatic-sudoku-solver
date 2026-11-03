#ifndef _WIN32
#define _POSIX_C_SOURCE 200809L
#endif

#include <stdio.h>
#include <string.h>
#include <time.h>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

#define SIZE 9

static unsigned long long recursiveCalls = 0;

static int getTimeMilliseconds(double *timeMilliseconds) {
#ifdef _WIN32
    LARGE_INTEGER frequency;
    LARGE_INTEGER counter;

    if (!QueryPerformanceFrequency(&frequency) ||
        !QueryPerformanceCounter(&counter)) {
        return 0;
    }

    *timeMilliseconds = 1000.0 * (double)counter.QuadPart /
                        (double)frequency.QuadPart;
#else
    struct timespec currentTime;

    if (clock_gettime(CLOCK_MONOTONIC, &currentTime) != 0) {
        return 0;
    }

    *timeMilliseconds = 1000.0 * (double)currentTime.tv_sec +
                        (double)currentTime.tv_nsec / 1000000.0;
#endif

    return 1;
}

int isSafe(int sudoku[SIZE][SIZE], int row, int column, int number) {
    if (sudoku == NULL || row < 0 || row >= SIZE ||
        column < 0 || column >= SIZE || number < 1 || number > SIZE) {
        return 0;
    }

    for (int index = 0; index < SIZE; index++) {
        if (sudoku[row][index] == number ||
            sudoku[index][column] == number) {
            return 0;
        }
    }

    int startRow = row - row % 3;
    int startColumn = column - column % 3;

    for (int currentRow = startRow; currentRow < startRow + 3; currentRow++) {
        for (int currentColumn = startColumn;
             currentColumn < startColumn + 3;
             currentColumn++) {
            if (sudoku[currentRow][currentColumn] == number) {
                return 0;
            }
        }
    }

    return 1;
}

int findEmptyCell(int sudoku[SIZE][SIZE], int *emptyRow, int *emptyColumn) {
    if (sudoku == NULL || emptyRow == NULL || emptyColumn == NULL) {
        return 0;
    }

    for (int row = 0; row < SIZE; row++) {
        for (int column = 0; column < SIZE; column++) {
            if (sudoku[row][column] == 0) {
                *emptyRow = row;
                *emptyColumn = column;
                return 1;
            }
        }
    }

    return 0;
}

int validateSudoku(int sudoku[SIZE][SIZE]) {
    if (sudoku == NULL) {
        return 0;
    }

    for (int row = 0; row < SIZE; row++) {
        for (int column = 0; column < SIZE; column++) {
            int number = sudoku[row][column];

            if (number < 0 || number > 9) {
                return 0;
            }

            if (number != 0) {
                sudoku[row][column] = 0;
                int safe = isSafe(sudoku, row, column, number);
                sudoku[row][column] = number;

                if (!safe) {
                    return 0;
                }
            }
        }
    }

    return 1;
}

int solveSudoku(int sudoku[SIZE][SIZE]) {
    if (sudoku == NULL) {
        return 0;
    }

    recursiveCalls++;

    int row;
    int column;

    if (!findEmptyCell(sudoku, &row, &column)) {
        return 1;
    }

    for (int number = 1; number <= SIZE; number++) {
        if (isSafe(sudoku, row, column, number)) {
            sudoku[row][column] = number;

            if (solveSudoku(sudoku)) {
                return 1;
            }

            sudoku[row][column] = 0;
        }
    }

    return 0;
}

void displaySudoku(int sudoku[SIZE][SIZE]) {
    if (sudoku == NULL) {
        return;
    }

    fprintf(stderr, "+-------+-------+-------+\n");

    for (int row = 0; row < SIZE; row++) {
        fprintf(stderr, "| ");
        for (int column = 0; column < SIZE; column++) {
            fprintf(stderr, "%d ", sudoku[row][column]);
            if ((column + 1) % 3 == 0) {
                fprintf(stderr, "| ");
            }
        }
        fprintf(stderr, "\n");

        if ((row + 1) % 3 == 0) {
            fprintf(stderr, "+-------+-------+-------+\n");
        }
    }
}

static void printJsonBoard(int sudoku[SIZE][SIZE]) {
    printf("[");
    for (int row = 0; row < SIZE; row++) {
        if (row > 0) {
            printf(",");
        }

        printf("[");
        for (int column = 0; column < SIZE; column++) {
            if (column > 0) {
                printf(",");
            }
            printf("%d", sudoku[row][column]);
        }
        printf("]");
    }
    printf("]");
}

int main(void) {
    int sudoku[SIZE][SIZE] = {{0}};
    char input[SIZE * SIZE + 3];

    if (fgets(input, sizeof(input), stdin) == NULL) {
        fprintf(stderr, "Expected exactly 81 puzzle characters on stdin.\n");
        return 2;
    }

    size_t inputLength = strcspn(input, "\r\n");
    if (inputLength != SIZE * SIZE || fgetc(stdin) != EOF) {
        fprintf(stderr, "Expected exactly 81 puzzle characters on stdin.\n");
        return 2;
    }

    for (int index = 0; index < SIZE * SIZE; index++) {
        char character = input[index];
        if (character != '.' && character != '0' &&
            (character < '1' || character > '9')) {
            fprintf(stderr, "Puzzle must contain only digits 1-9, zero, or dots.\n");
            return 2;
        }

        sudoku[index / SIZE][index % SIZE] =
            (character == '.' || character == '0') ? 0 : character - '0';
    }

    if (!validateSudoku(sudoku)) {
        printf("{\"error\":\"Puzzle contains duplicate or invalid clues.\"}\n");
        return 0;
    }

    double startMilliseconds;
    double endMilliseconds;
    clock_t cpuStart = clock();

    if (cpuStart == (clock_t)-1 || !getTimeMilliseconds(&startMilliseconds)) {
        fprintf(stderr, "Unable to start solver timers.\n");
        return 3;
    }

    int solved = solveSudoku(sudoku);
    clock_t cpuEnd = clock();

    if (cpuEnd == (clock_t)-1 || !getTimeMilliseconds(&endMilliseconds)) {
        fprintf(stderr, "Unable to read solver timers.\n");
        return 3;
    }

    double elapsedMilliseconds = endMilliseconds - startMilliseconds;
    double cpuTimeMilliseconds =
        1000.0 * (double)(cpuEnd - cpuStart) / CLOCKS_PER_SEC;

    if (solved) {
        displaySudoku(sudoku);
    }

    printf("{\"algorithm\":\"recursive-backtracking\","
           "\"solved\":%s,\"recursiveCalls\":%llu,"
           "\"elapsedMs\":%.9f,\"cpuTimeMs\":%.6f,\"board\":",
           solved ? "true" : "false",
           recursiveCalls,
           elapsedMilliseconds,
           cpuTimeMilliseconds);
    printJsonBoard(sudoku);
    printf("}\n");

    return 0;
}
