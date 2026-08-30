// Coding challenges: hand-written seed data, grading, and seeding.
import { db, ensureMigrated } from "./db";
import { generateChallenges } from "./challenge-generator";

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
  sample_input?: string;
  hints?: string[];
  hint_cost?: number;
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
    sample_input: "5\n7\n",
    hints: ["Read each number with int(input()) and store them in two variables.", "Print a + b — no other output."],
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
    sample_input: "15\n",
    hints: ["Check divisibility by 3 and by 5 separately, then both.", "Order matters: test the both case before the individual cases."],
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
    sample_input: "Racecar\n",
    hints: ["Compare the string to its own reverse."],
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
    sample_input: "the quick brown fox\n",
    hints: ["Split the text on whitespace and count the pieces."],
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
    sample_input: "5 7\n",
    hints: ["std::cin >> a >> b reads both values; print a + b."],
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
    sample_input: "4\n",
    hints: ["Use n % 2 == 0 to test for evenness."],
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
    sample_input: "1 5 3\n",
    hints: ["Compare a and b, then compare the larger one with c."],
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
    sample_input: "hello\n",
    hints: ["Iterate the string from the last character to the first."],
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

  // Programmatically generated library (100 additional graded problems).
  ...generateChallenges(),
];

const SANDBOX_URL = process.env.SANDBOX_URL || "http://sandbox:3100";

// Resolve the user's current cohort id: their most recent active enrollment,
// or the default "general" cohort. Enrollment is now a separate record from
// leaderboard consent, so a user can hold multiple enrollments.
export async function resolveCohortId(userId: string): Promise<number> {
  await ensureMigrated();
  const enrolled = await db.query(
    `SELECT cohort_id FROM wiserfiles_enrollments WHERE user_id = $1 AND status = 'active' ORDER BY joined_at DESC LIMIT 1`,
    [userId]
  );
  if (enrolled.rows.length) return Number(enrolled.rows[0].cohort_id);
  const general = await db.query(`SELECT id FROM wiserfiles_cohorts WHERE join_code = 'general' LIMIT 1`);
  return general.rows.length ? Number(general.rows[0].id) : 0;
}

export async function activeSeasonId(): Promise<number> {
  await ensureMigrated();
  const res = await db.query(`SELECT id FROM wiserfiles_seasons WHERE is_active = TRUE ORDER BY id LIMIT 1`);
  return res.rows.length ? Number(res.rows[0].id) : 0;
}

// If a contest is team-based, return the user's team id within it; otherwise
// return null (individual contests).
export async function resolveTeamId(userId: string, cohortId: number): Promise<number | null> {
  await ensureMigrated();
  const contest = await db.query(`SELECT team_mode FROM wiserfiles_cohorts WHERE id = $1`, [cohortId]);
  if (!contest.rows.length || !contest.rows[0].team_mode) return null;
  const team = await db.query(
    `SELECT tm.team_id FROM wiserfiles_team_members tm
     JOIN wiserfiles_teams t ON t.id = tm.team_id
     WHERE t.contest_id = $1 AND tm.user_id = $2 LIMIT 1`,
    [cohortId, userId]
  );
  return team.rows.length ? Number(team.rows[0].team_id) : null;
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
      `INSERT INTO wiserfiles_challenges (slug, language, difficulty, statement_md, starter_code, hidden_tests, points, test_mode, sample_input, hints, hint_cost, season_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11, $12)
       ON CONFLICT (slug) DO UPDATE SET
         statement_md = EXCLUDED.statement_md,
         starter_code = EXCLUDED.starter_code,
         hidden_tests = EXCLUDED.hidden_tests,
         points = EXCLUDED.points,
         difficulty = EXCLUDED.difficulty,
         test_mode = EXCLUDED.test_mode,
         sample_input = EXCLUDED.sample_input,
         hints = EXCLUDED.hints,
         hint_cost = EXCLUDED.hint_cost`,
      [c.slug, c.language, c.difficulty, c.statement_md, c.starter_code, JSON.stringify(c.hidden_tests), c.points, c.test_mode || "io", c.sample_input || "", JSON.stringify(c.hints || []), c.hint_cost ?? 5, seasonId]
    );
  }

  await seedDemoContest();
}

// Seed a public demo contest with three competitors who each solved several
// problems, so the contest page and leaderboard are populated out of the box.
export async function seedDemoContest(): Promise<void> {
  await ensureMigrated();
  const seasonId = await activeSeasonId();

  const existing = await db.query(`SELECT id FROM wiserfiles_cohorts WHERE slug = 'demo-sprint'`);
  let contestId: number;
  if (existing.rows.length) {
    contestId = Number(existing.rows[0].id);
  } else {
    const ins = await db.query(
      `INSERT INTO wiserfiles_cohorts (name, join_code, slug, description, starts_at, ends_at, scoring_mode, is_public, prizes, season_id, created_by)
       VALUES ($1, $2, 'demo-sprint', $3, $4, $5, 'solve', TRUE, $6::jsonb, $7, 'system') RETURNING id`,
      [
        "Demo Sprint — Coding Contest",
        "DEMO2024",
        "A public demo contest with three seeded competitors.",
        new Date(Date.now() - 3600_000).toISOString(),
        new Date(Date.now() + 7 * 86_400_000).toISOString(),
        JSON.stringify([{ place: 1, label: "1st — $100" }, { place: 2, label: "2nd — $50" }, { place: 3, label: "3rd — $25" }]),
        seasonId || null,
      ]
    );
    contestId = Number(ins.rows[0].id);
  }

  // Assign the first ten challenges to the contest.
  const challenges = await db.query(`SELECT id, points FROM wiserfiles_challenges ORDER BY id LIMIT 10`);
  for (let i = 0; i < challenges.rows.length; i++) {
    await db.query(
      `INSERT INTO wiserfiles_contest_challenges (contest_id, challenge_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [contestId, challenges.rows[i].id, i]
    );
  }

  // Seed three competitors who each solved at least three problems.
  const players = [
    { id: "demo-player-alice", name: "Alice" },
    { id: "demo-player-bob", name: "Bob" },
    { id: "demo-player-charlie", name: "Charlie" },
  ];
  for (let p = 0; p < players.length; p++) {
    const player = players[p];
    await db.query(
      `INSERT INTO wiserfiles_enrollments (user_id, cohort_id, role, status) VALUES ($1, $2, 'student', 'active') ON CONFLICT DO NOTHING`,
      [player.id, contestId]
    );
    await db.query(
      `INSERT INTO wiserfiles_leaderboard_opt_in (user_id, cohort_id, display_name, opted_in) VALUES ($1, $2, $3, TRUE) ON CONFLICT DO NOTHING`,
      [player.id, contestId, player.name]
    );
    for (let c = 0; c < 4; c++) {
      const challenge = challenges.rows[c];
      if (!challenge) continue;
      await db.query(
        `INSERT INTO wiserfiles_challenge_solves (user_id, challenge_id, cohort_id, points, solved_at)
         VALUES ($1, $2, $3, $4, NOW() - make_interval(mins => $5::int))
         ON CONFLICT DO NOTHING`,
        [player.id, challenge.id, contestId, challenge.points, (p * 4 + c) * 3 + 5]
      );
    }
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
