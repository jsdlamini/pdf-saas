// Coding challenges: hand-written seed data, grading, and seeding.
import { db, ensureMigrated } from "./db";

export type HiddenTest = { input: string; expected: string };

export type UnitTestSpec = { test_file: string; test_file_path: string };

export type ChallengeSeed = {
  slug: string;
  language: "python" | "cpp";
  difficulty: "easy" | "medium" | "hard";
  points: number;
  statement_md: string;
  starter_code: string;
  test_mode?: "io" | "pytest" | "doctest";
  hidden_tests: HiddenTest[] | UnitTestSpec;
};

export const CHALLENGE_SEED: ChallengeSeed[] = [
  // ── Python ──────────────────────────────────────────────────────
  {
    slug: "py-hello",
    language: "python",
    difficulty: "easy",
    points: 10,
    statement_md:
      "Write a program that prints exactly:\n\n```\nHello, WiserFiles!\n```\n\nNo input is given.",
    starter_code: "# print the greeting here\n",
    hidden_tests: [{ input: "", expected: "Hello, WiserFiles!" }],
  },
  {
    slug: "py-sum-two",
    language: "python",
    difficulty: "easy",
    points: 10,
    statement_md:
      "Read **two integers**, each on its own line, from standard input. Print their sum.",
    starter_code: "a = int(input())\nb = int(input())\n# print a + b\n",
    hidden_tests: [
      { input: "5\n7\n", expected: "12" },
      { input: "-3\n10\n", expected: "7" },
      { input: "0\n0\n", expected: "0" },
    ],
  },
  {
    slug: "py-fizzbuzz",
    language: "python",
    difficulty: "easy",
    points: 15,
    statement_md:
      "Read an integer `N`. For every number from `1` to `N` inclusive, print one line:\n\n- `Fizz` if the number is divisible by 3\n- `Buzz` if divisible by 5\n- `FizzBuzz` if divisible by both\n- otherwise the number itself",
    starter_code: "n = int(input())\n# loop from 1 to n\n",
    hidden_tests: [
      {
        input: "15\n",
        expected: "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz",
      },
      { input: "5\n", expected: "1\n2\nFizz\n4\nBuzz" },
    ],
  },
  {
    slug: "py-palindrome",
    language: "python",
    difficulty: "medium",
    points: 20,
    statement_md:
      "Read a single word (no spaces) from standard input. Print `yes` if it is a palindrome (reads the same forwards and backwards, ignoring case), otherwise print `no`.",
    starter_code: "s = input().strip().lower()\n# check if s == reversed(s)\n",
    hidden_tests: [
      { input: "Racecar\n", expected: "yes" },
      { input: "hello\n", expected: "no" },
      { input: "Abba\n", expected: "yes" },
    ],
  },
  {
    slug: "py-word-count",
    language: "python",
    difficulty: "medium",
    points: 20,
    statement_md:
      "Read all of standard input until end-of-file, then print the total number of whitespace-separated words.",
    starter_code: "import sys\ntext = sys.stdin.read()\n# count the words\n",
    hidden_tests: [
      { input: "the quick brown fox\n", expected: "4" },
      { input: "one\ntwo three\n", expected: "3" },
      { input: "", expected: "0" },
    ],
  },

  // ── C++ ─────────────────────────────────────────────────────────
  {
    slug: "cpp-hello",
    language: "cpp",
    difficulty: "easy",
    points: 10,
    statement_md:
      "Print exactly:\n\n```\nHello, WiserFiles!\n```\n\nNo input is given.",
    starter_code: '#include <iostream>\nint main() {\n  // print the greeting\n  return 0;\n}\n',
    hidden_tests: [{ input: "", expected: "Hello, WiserFiles!" }],
  },
  {
    slug: "cpp-sum-two",
    language: "cpp",
    difficulty: "easy",
    points: 10,
    statement_md:
      "Read **two integers** from standard input and print their sum.",
    starter_code: '#include <iostream>\nint main() {\n  int a, b;\n  std::cin >> a >> b;\n  // print a + b\n  return 0;\n}\n',
    hidden_tests: [
      { input: "5 7\n", expected: "12" },
      { input: "-3 10\n", expected: "7" },
      { input: "0 0\n", expected: "0" },
    ],
  },
  {
    slug: "cpp-even-odd",
    language: "cpp",
    difficulty: "easy",
    points: 15,
    statement_md:
      "Read an integer `N`. Print `even` if it is even, otherwise `odd`.",
    starter_code: '#include <iostream>\nint main() {\n  int n;\n  std::cin >> n;\n  // print even or odd\n  return 0;\n}\n',
    hidden_tests: [
      { input: "4\n", expected: "even" },
      { input: "7\n", expected: "odd" },
      { input: "0\n", expected: "even" },
    ],
  },
  {
    slug: "cpp-max-three",
    language: "cpp",
    difficulty: "medium",
    points: 20,
    statement_md:
      "Read **three integers** from standard input and print the largest one.",
    starter_code: '#include <iostream>\nint main() {\n  int a, b, c;\n  std::cin >> a >> b >> c;\n  // print the max\n  return 0;\n}\n',
    hidden_tests: [
      { input: "1 5 3\n", expected: "5" },
      { input: "10 10 2\n", expected: "10" },
      { input: "-1 -5 -3\n", expected: "-1" },
    ],
  },
  {
    slug: "cpp-reverse",
    language: "cpp",
    difficulty: "medium",
    points: 20,
    statement_md:
      "Read a single word (no spaces) from standard input and print it reversed.",
    starter_code: '#include <iostream>\n#include <string>\nint main() {\n  std::string s;\n  std::cin >> s;\n  // print s reversed\n  return 0;\n}\n',
    hidden_tests: [
      { input: "hello\n", expected: "olleh" },
      { input: "abc\n", expected: "cba" },
    ],
  },

  // ── Unit-test challenges ────────────────────────────────────────
  {
    slug: "py-unittest",
    language: "python",
    difficulty: "medium",
    points: 25,
    statement_md:
      "Write a function `add(a, b)` in `solution.py` that returns the sum of its two arguments. Do not read input or print anything — a hidden test file imports your function and checks it.",
    starter_code: "def add(a, b):\n    # return a + b\n    pass\n",
    test_mode: "pytest",
    hidden_tests: {
      test_file_path: "test_solution.py",
      test_file: "from solution import add\n\ndef test_add():\n    assert add(2, 3) == 5\n    assert add(-1, 1) == 0\n    assert add(0, 0) == 0\n",
    },
  },
  {
    slug: "cpp-unittest",
    language: "cpp",
    difficulty: "medium",
    points: 25,
    statement_md:
      "Write a function `int max_of_three(int a, int b, int c)` in `solution.cpp` (no `main` function) that returns the largest of the three arguments. A hidden test file includes your solution and checks it.",
    starter_code: "int max_of_three(int a, int b, int c) {\n  // return the largest\n  return 0;\n}\n",
    test_mode: "doctest",
    hidden_tests: {
      test_file_path: "test.cpp",
      test_file: "#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN\n#include \"doctest.h\"\n#include \"solution.cpp\"\n\nTEST_CASE(\"max_of_three\") {\n  CHECK(max_of_three(1, 5, 3) == 5);\n  CHECK(max_of_three(10, 10, 2) == 10);\n  CHECK(max_of_three(-1, -5, -3) == -1);\n}\n",
    },
  },
];

const SANDBOX_URL = process.env.SANDBOX_URL || "http://sandbox:3100";

// Resolve the user's cohort id (their joined cohort, or the default "general").
export async function resolveCohortId(userId: string): Promise<number> {
  await ensureMigrated();
  const joined = await db.query(
    `SELECT cohort_id FROM wiserfiles_leaderboard_opt_in WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  if (joined.rows.length) return Number(joined.rows[0].cohort_id);
  const general = await db.query(`SELECT id FROM wiserfiles_cohorts WHERE join_code = 'general' LIMIT 1`);
  return general.rows.length ? Number(general.rows[0].id) : 0;
}

export async function activeSeasonId(): Promise<number> {
  await ensureMigrated();
  const res = await db.query(`SELECT id FROM wiserfiles_seasons WHERE is_active = TRUE ORDER BY id LIMIT 1`);
  return res.rows.length ? Number(res.rows[0].id) : 0;
}

// Seed the challenges and a default season + cohort so the panel works out of
// the box. Idempotent.
export async function seedChallenges(): Promise<void> {
  await ensureMigrated();

  const seasonRes = await db.query(`SELECT id FROM wiserfiles_seasons WHERE is_active = TRUE LIMIT 1`);
  let seasonId: number;
  if (seasonRes.rows.length) {
    seasonId = seasonRes.rows[0].id;
  } else {
    const start = new Date();
    const end = new Date();
    end.setMonth(end.getMonth() + 6);
    const ins = await db.query(
      `INSERT INTO wiserfiles_seasons (name, starts_at, ends_at, is_active) VALUES ($1, $2, $3, TRUE) RETURNING id`,
      ["Default Season", start.toISOString(), end.toISOString()]
    );
    seasonId = ins.rows[0].id;
  }

  const cohortRes = await db.query(`SELECT id FROM wiserfiles_cohorts WHERE join_code = 'general' LIMIT 1`);
  if (!cohortRes.rows.length) {
    await db.query(
      `INSERT INTO wiserfiles_cohorts (name, join_code, season_id, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (join_code) DO NOTHING`,
      ["General", "general", seasonId, "system"]
    );
  }

  for (const c of CHALLENGE_SEED) {
    await db.query(
      `INSERT INTO wiserfiles_challenges (slug, language, difficulty, statement_md, starter_code, hidden_tests, points, test_mode, season_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       ON CONFLICT (slug) DO UPDATE SET
         statement_md = EXCLUDED.statement_md,
         starter_code = EXCLUDED.starter_code,
         hidden_tests = EXCLUDED.hidden_tests,
         points = EXCLUDED.points,
         difficulty = EXCLUDED.difficulty,
         test_mode = EXCLUDED.test_mode`,
      [c.slug, c.language, c.difficulty, c.statement_md, c.starter_code, JSON.stringify(c.hidden_tests), c.points, c.test_mode || "io", seasonId]
    );
  }
}

// Run a submission against the hidden IO tests. Each test feeds its input on
// stdin and compares trimmed stdout.
export async function gradeIoSubmission(
  language: "python" | "cpp",
  files: { path: string; content: string }[],
  mainPath: string,
  tests: HiddenTest[]
) {
  const results: { ok: boolean; input: string; expected: string; actual: string; exitCode?: number; error?: string }[] = [];
  let passed = 0;

  for (const test of tests) {
    let actual = "";
    let exitCode: number | undefined;
    let error: string | undefined;
    try {
      const res = await fetch(`${SANDBOX_URL}/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, files, mainPath, stdin: test.input }),
      });
      const data = (await res.json().catch(() => null)) as { output?: string; error?: string; exitCode?: number } | null;
      actual = (data?.output || "").trim();
      exitCode = data?.exitCode;
      error = data?.error;
    } catch (e) {
      error = e instanceof Error ? e.message : "sandbox unavailable";
    }
    const expected = (test.expected || "").trim();
    const ok = exitCode === 0 && actual === expected;
    if (ok) passed += 1;
    results.push({ ok, input: test.input, expected, actual, exitCode, error });
  }

  return { passed, total: tests.length, results };
}

// Run a unit-test submission (pytest or doctest) in the sandbox. Exit code 0
// means all hidden tests passed.
export async function gradeUnitSubmission(
  mode: "pytest" | "doctest",
  files: { path: string; content: string }[],
  testFilePath: string,
  testFileContent: string
) {
  let output = "";
  let error: string | undefined;
  let exitCode: number | undefined;
  try {
    const res = await fetch(`${SANDBOX_URL}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, files, testFilePath, testFileContent }),
    });
    const data = (await res.json().catch(() => null)) as { output?: string; error?: string; exitCode?: number } | null;
    output = data?.output || "";
    error = data?.error;
    exitCode = data?.exitCode;
  } catch (e) {
    error = e instanceof Error ? e.message : "sandbox unavailable";
  }
  const ok = exitCode === 0;
  return {
    passed: ok ? 1 : 0,
    total: 1,
    results: [{ ok, input: "", expected: "all hidden tests pass", actual: output || error || "(no output)", exitCode, error }],
  };
}
