// Programmatically generates a large set of graded coding challenges so the
// platform has a real problem library (100+ problems) beyond the hand-written
// seed. Each challenge carries deterministic hidden tests whose expected
// outputs are computed here in JS.

import type { ChallengeSeed } from "./challenges";

type Concept = {
  slug: string;
  difficulty: "easy" | "medium";
  points: number;
  statement: string;
  starterPy: string;
  starterCpp: string;
  genInput: (seed: number) => string;
  solve: (input: string) => string;
};

const ints = (s: string): number[] => s.trim().split(/\s+/).map(Number);

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function fibonacci(n: number): number {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) {
    [a, b] = [b, a + b];
  }
  return a;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function sumDigits(n: number): number {
  return String(Math.abs(n)).split("").reduce((s, d) => s + Number(d), 0);
}

const CONCEPTS: Concept[] = [
  {
    slug: "sum-two",
    difficulty: "easy",
    points: 10,
    statement: "Read two integers and print their sum.",
    starterPy: "a = int(input())\nb = int(input())\nprint(a + b)\n",
    starterCpp: "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<(a+b);return 0;}\n",
    genInput: (s) => `${s * 3 + 2}\n${s * 7 + 5}\n`,
    solve: (input) => { const [a, b] = ints(input); return String(a + b); },
  },
  {
    slug: "max-two",
    difficulty: "easy",
    points: 10,
    statement: "Read two integers and print the larger one.",
    starterPy: "a, b = map(int, input().split())\nprint(max(a, b))\n",
    starterCpp: "#include <iostream>\n#include <algorithm>\nint main(){int a,b;std::cin>>a>>b;std::cout<<std::max(a,b);return 0;}\n",
    genInput: (s) => `${s + 3} ${s * 2 + 1}\n`,
    solve: (input) => { const [a, b] = ints(input); return String(Math.max(a, b)); },
  },
  {
    slug: "factorial",
    difficulty: "medium",
    points: 15,
    statement: "Read an integer N (1 ≤ N ≤ 12) and print N!.",
    starterPy: "import math\nn = int(input())\nprint(math.factorial(n))\n",
    starterCpp: "#include <iostream>\nint main(){int n;std::cin>>n;long long f=1;for(int i=1;i<=n;i++)f*=i;std::cout<<f;return 0;}\n",
    genInput: (s) => `${(s % 12) + 1}\n`,
    solve: (input) => String(factorial(ints(input)[0])),
  },
  {
    slug: "fibonacci",
    difficulty: "medium",
    points: 20,
    statement: "Read an integer N (0 ≤ N ≤ 15) and print the N-th Fibonacci number (0-indexed).",
    starterPy: "n = int(input())\na, b = 0, 1\nfor _ in range(n):\n    a, b = b, a + b\nprint(a)\n",
    starterCpp: "#include <iostream>\nint main(){int n;std::cin>>n;int a=0,b=1;for(int i=0;i<n;i++){int t=a+b;a=b;b=t;}std::cout<<a;return 0;}\n",
    genInput: (s) => `${s % 16}\n`,
    solve: (input) => String(fibonacci(ints(input)[0])),
  },
  {
    slug: "gcd",
    difficulty: "medium",
    points: 15,
    statement: "Read two positive integers and print their greatest common divisor.",
    starterPy: "import math\na, b = map(int, input().split())\nprint(math.gcd(a, b))\n",
    starterCpp: "#include <iostream>\n#include <numeric>\nint main(){int a,b;std::cin>>a>>b;std::cout<<std::gcd(a,b);return 0;}\n",
    genInput: (s) => `${s * 7 + 3} ${s * 11 + 4}\n`,
    solve: (input) => { const [a, b] = ints(input); return String(gcd(a, b)); },
  },
  {
    slug: "sum-to-n",
    difficulty: "easy",
    points: 10,
    statement: "Read an integer N and print the sum of all integers from 1 to N.",
    starterPy: "n = int(input())\nprint(n * (n + 1) // 2)\n",
    starterCpp: "#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<(n*(n+1)/2);return 0;}\n",
    genInput: (s) => `${s + 5}\n`,
    solve: (input) => { const n = ints(input)[0]; return String((n * (n + 1)) / 2); },
  },
  {
    slug: "sum-digits",
    difficulty: "easy",
    points: 10,
    statement: "Read a non-negative integer and print the sum of its digits.",
    starterPy: "n = input().strip()\nprint(sum(int(d) for d in n))\n",
    starterCpp: "#include <iostream>\nint main(){int n;std::cin>>n;int s=0;while(n){s+=n%10;n/=10;}std::cout<<s;return 0;}\n",
    genInput: (s) => `${s * 123 + 45}\n`,
    solve: (input) => String(sumDigits(ints(input)[0])),
  },
  {
    slug: "square",
    difficulty: "easy",
    points: 5,
    statement: "Read an integer N and print its square.",
    starterPy: "n = int(input())\nprint(n * n)\n",
    starterCpp: "#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<(n*n);return 0;}\n",
    genInput: (s) => `${s + 2}\n`,
    solve: (input) => { const n = ints(input)[0]; return String(n * n); },
  },
  {
    slug: "even-odd",
    difficulty: "easy",
    points: 5,
    statement: "Read an integer and print `even` or `odd`.",
    starterPy: "n = int(input())\nprint(\"even\" if n % 2 == 0 else \"odd\")\n",
    starterCpp: "#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<(n%2==0?\"even\":\"odd\");return 0;}\n",
    genInput: (s) => `${s + 1}\n`,
    solve: (input) => (ints(input)[0] % 2 === 0 ? "even" : "odd"),
  },
  {
    slug: "count-to-n",
    difficulty: "easy",
    points: 10,
    statement: "Read an integer N and print the numbers 1 to N, one per line.",
    starterPy: "n = int(input())\nfor i in range(1, n + 1):\n    print(i)\n",
    starterCpp: "#include <iostream>\nint main(){int n;std::cin>>n;for(int i=1;i<=n;i++)std::cout<<i<<\"\\n\";return 0;}\n",
    genInput: (s) => `${(s % 5) + 1}\n`,
    solve: (input) => {
      const n = ints(input)[0];
      const lines: string[] = [];
      for (let i = 1; i <= n; i++) lines.push(String(i));
      return lines.join("\n");
    },
  },
];

export function generateChallenges(): ChallengeSeed[] {
  const out: ChallengeSeed[] = [];
  for (const c of CONCEPTS) {
    for (const lang of ["python", "cpp"] as const) {
      for (let v = 0; v < 5; v++) {
        const tests: { input: string; expected: string }[] = [];
        for (let t = 0; t < 3; t++) {
          const input = c.genInput(v * 3 + t);
          tests.push({ input, expected: c.solve(input) });
        }
        out.push({
          slug: `${lang === "python" ? "py" : "cpp"}-gen-${c.slug}-${v + 1}`,
          language: lang,
          difficulty: c.difficulty,
          points: c.points,
          statement_md: c.statement,
          starter_code: lang === "python" ? c.starterPy : c.starterCpp,
          test_mode: "io",
          sample_input: c.genInput(0),
          hidden_tests: tests,
        });
      }
    }
  }
  return out;
}
