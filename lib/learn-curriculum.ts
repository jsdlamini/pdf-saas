export type LearnLanguage = "python" | "cpp";

export type LearnLesson = {
  id: string;
  language: LearnLanguage;
  order: number;
  title: string;
  explanation: string; // markdown
  example: string; // runnable example shown read-only
  task: string; // exercise instruction (markdown)
  starter: string; // initial code in the practice editor
  expectedOutput?: string; // hint for the student
};

export type LearnSection = {
  language: LearnLanguage;
  title: string;
  lessons: LearnLesson[];
};

export const LEARN_LESSONS: LearnLesson[] = [
  // ─────────────────────────── Python ───────────────────────────
  {
    id: "py-hello",
    language: "python",
    order: 1,
    title: "Hello, World",
    explanation:
      "Your first program. `print()` writes text to the screen.\n\n- Python runs top to bottom, one line at a time.\n- Text (a **string**) goes inside quotes.\n- `print(\"Hello\")` shows `Hello`.",
    example: 'print("Hello, world!")\n',
    task: "Run the starter code, then change the message to greet yourself by name.",
    starter: 'print("Hello, world!")\n',
    expectedOutput: "Hello, world!",
  },
  {
    id: "py-vars",
    language: "python",
    order: 2,
    title: "Variables & Types",
    explanation:
      "A **variable** stores a value so you can reuse it.\n\nCommon types: `int` (whole numbers), `float` (decimals), `str` (text), `bool` (`True`/`False`).\n\nUse `=` to assign: `age = 21`.",
    example: 'name = "Eswatini"\nage = 21\nprice = 12.50\nis_hot = True\nprint(name, age, price, is_hot)\n',
    task: "Create a variable holding a maize yield (a decimal number) and print it.",
    starter: '# Store a maize yield and print it\nmaize_yield = 3.5\nprint(maize_yield)\n',
    expectedOutput: "3.5",
  },
  {
    id: "py-input",
    language: "python",
    order: 3,
    title: "Input & Conversion",
    explanation:
      "`input()` reads text the user types. It **always returns a string**.\n\nConvert with `int()` or `float()` before doing maths:\n`age = int(input(\"Age? \"))`\n\n(The practice editor runs without a keyboard, so exercises use fixed values — the example shows the input pattern.)",
    example: 'name = input("Your name? ")\nprint("Hello", name)\n',
    task: "Convert the string `\"42\"` to an integer, double it, and print the result.",
    starter: 'number = int("42")\nprint(number * 2)\n',
    expectedOutput: "84",
  },
  {
    id: "py-if",
    language: "python",
    order: 4,
    title: "If / Elif / Else",
    explanation:
      "Use `if` to make decisions. `elif` adds more conditions, `else` catches everything left.\n\nIndentation (4 spaces) defines which lines belong to each block.",
    example: 'temp = 15\nif temp > 30:\n    print("Hot")\nelif temp > 20:\n    print("Warm")\nelse:\n    print("Cool")\n',
    task: "Print `Drought risk` when rainfall is below 500 mm, otherwise print `Normal`.",
    starter: 'rainfall = 420\nif rainfall < 500:\n    print("Drought risk")\nelse:\n    print("Normal")\n',
    expectedOutput: "Drought risk",
  },
  {
    id: "py-loops",
    language: "python",
    order: 5,
    title: "For Loops & Range",
    explanation:
      "A `for` loop repeats code. `range(a, b)` gives the numbers `a` up to (but not including) `b`.\n\n`range(1, 11)` → 1, 2, …, 10.",
    example: 'total = 0\nfor i in range(1, 6):\n    total = total + i\nprint(total)\n',
    task: "Use a loop to print the numbers 1 to 10, one per line.",
    starter: 'for i in range(1, 11):\n    print(i)\n',
    expectedOutput: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10",
  },
  {
    id: "py-lists",
    language: "python",
    order: 6,
    title: "Lists & Mini-Challenge",
    explanation:
      "A **list** holds several values in order. Useful helpers: `len()`, `sum()`, `max()`, `min()`.\n\nChallenge: print the average of the list below (sum divided by count).",
    example: 'yields = [2.1, 3.4, 1.8, 2.9]\nprint(sum(yields))\nprint(len(yields))\n',
    task: "Print the average (mean) of `yields` to 1 decimal place.",
    starter: 'yields = [2.1, 3.4, 1.8, 2.9]\nprint(round(sum(yields) / len(yields), 1))\n',
    expectedOutput: "2.6",
  },

  // ─────────────────────────── C++ ───────────────────────────
  {
    id: "cpp-hello",
    language: "cpp",
    order: 1,
    title: "Hello, World",
    explanation:
      "A C++ program needs `#include <iostream>`, a `main` function, and `std::cout` to print.\n\n`std::endl` (or `\\n`) moves to a new line.",
    example: '#include <iostream>\nint main() {\n    std::cout << "Hello, world!" << std::endl;\n    return 0;\n}\n',
    task: "Run the starter code, then change the message to greet yourself by name.",
    starter: '#include <iostream>\nint main() {\n    std::cout << "Hello, world!" << std::endl;\n    return 0;\n}\n',
    expectedOutput: "Hello, world!",
  },
  {
    id: "cpp-vars",
    language: "cpp",
    order: 2,
    title: "Variables & Types",
    explanation:
      "C++ needs a **type** for every variable: `int`, `double`, `char`, `bool`.\n\nAssign with `=`: `int age = 21;`",
    example: '#include <iostream>\nint main() {\n    int age = 21;\n    double price = 12.50;\n    char grade = \'A\';\n    std::cout << age << " " << price << " " << grade << std::endl;\n    return 0;\n}\n',
    task: "Store a maize yield as a `double` and print it.",
    starter: '#include <iostream>\nint main() {\n    double maize_yield = 3.5;\n    std::cout << maize_yield << std::endl;\n    return 0;\n}\n',
    expectedOutput: "3.5",
  },
  {
    id: "cpp-input",
    language: "cpp",
    order: 3,
    title: "Input with cin",
    explanation:
      "`std::cin` reads typed input into a variable.\n\n`int age; std::cin >> age;` reads a whole number.\n\n(The practice editor runs without a keyboard, so exercises use fixed values.)",
    example: '#include <iostream>\nint main() {\n    int age;\n    std::cin >> age;\n    std::cout << "Age: " << age << std::endl;\n    return 0;\n}\n',
    task: "Double the value 42 and print the result.",
    starter: '#include <iostream>\nint main() {\n    int number = 42;\n    std::cout << number * 2 << std::endl;\n    return 0;\n}\n',
    expectedOutput: "84",
  },
  {
    id: "cpp-if",
    language: "cpp",
    order: 4,
    title: "If / Else If / Else",
    explanation:
      "`if`, `else if`, and `else` make decisions. Conditions use `>`, `<`, `>=`, `<=`, `==`, `!=`.",
    example: '#include <iostream>\nint main() {\n    int temp = 15;\n    if (temp > 30) {\n        std::cout << "Hot" << std::endl;\n    } else if (temp > 20) {\n        std::cout << "Warm" << std::endl;\n    } else {\n        std::cout << "Cool" << std::endl;\n    }\n    return 0;\n}\n',
    task: "Print `Drought risk` when rainfall is below 500 mm, otherwise `Normal`.",
    starter: '#include <iostream>\nint main() {\n    int rainfall = 420;\n    if (rainfall < 500) {\n        std::cout << "Drought risk" << std::endl;\n    } else {\n        std::cout << "Normal" << std::endl;\n    }\n    return 0;\n}\n',
    expectedOutput: "Drought risk",
  },
  {
    id: "cpp-loops",
    language: "cpp",
    order: 5,
    title: "For Loops",
    explanation:
      "A `for` loop has three parts: start, condition, update.\n\n`for (int i = 1; i <= 10; i++)` counts 1..10.",
    example: '#include <iostream>\nint main() {\n    int total = 0;\n    for (int i = 1; i <= 5; i++) {\n        total += i;\n    }\n    std::cout << total << std::endl;\n    return 0;\n}\n',
    task: "Use a loop to print the numbers 1 to 10, one per line.",
    starter: '#include <iostream>\nint main() {\n    for (int i = 1; i <= 10; i++) {\n        std::cout << i << std::endl;\n    }\n    return 0;\n}\n',
    expectedOutput: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10",
  },
  {
    id: "cpp-arrays",
    language: "cpp",
    order: 6,
    title: "Arrays & Mini-Challenge",
    explanation:
      "An **array** holds a fixed number of values of the same type.\n\n`int nums[3] = {4, 8, 15};`\n\nChallenge: sum the array below and print the total.",
    example: '#include <iostream>\nint main() {\n    int nums[4] = {2, 4, 6, 8};\n    int total = 0;\n    for (int i = 0; i < 4; i++) total += nums[i];\n    std::cout << total << std::endl;\n    return 0;\n}\n',
    task: "Sum the array and print the total.",
    starter: '#include <iostream>\nint main() {\n    int nums[4] = {2, 4, 6, 8};\n    int total = 0;\n    for (int i = 0; i < 4; i++) total += nums[i];\n    std::cout << total << std::endl;\n    return 0;\n}\n',
    expectedOutput: "20",
  },
];

export const LEARN_SECTIONS: LearnSection[] = [
  {
    language: "python",
    title: "Python",
    lessons: LEARN_LESSONS.filter((l) => l.language === "python").sort((a, b) => a.order - b.order),
  },
  {
    language: "cpp",
    title: "C++",
    lessons: LEARN_LESSONS.filter((l) => l.language === "cpp").sort((a, b) => a.order - b.order),
  },
];
