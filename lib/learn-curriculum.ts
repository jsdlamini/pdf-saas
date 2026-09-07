export type LearnLanguage = "python" | "cpp";

export type LearnChallenge = {
  prompt: string; // markdown
  starter: string; // skeleton code loaded into the editor
  expectedOutput: string; // exact stdout (trimmed) a correct answer prints
  hint?: string;
};

export type LearnLesson = {
  id: string;
  language: LearnLanguage;
  order: number;
  title: string;
  explanation: string; // markdown
  example: string; // runnable example shown read-only
  challenge: LearnChallenge;
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
      "Your first program. `print()` writes text to the screen.\n\n- Python runs top to bottom, one line at a time.\n- Text (a **string**) goes inside quotes.\n- `print(\"Hi\")` shows `Hi`.",
    example: 'print("Hello, world!")\n',
    challenge: {
      prompt: "Write a program that prints the message `Eswatini is growing!` exactly.",
      starter: '# Print the required message below\n',
      expectedOutput: "Eswatini is growing!",
    },
  },
  {
    id: "py-vars",
    language: "python",
    order: 2,
    title: "Variables & Types",
    explanation:
      "A **variable** stores a value so you can reuse it.\n\nCommon types: `int` (whole numbers), `float` (decimals), `str` (text), `bool` (`True`/`False`).\n\nAssign with `=`: `age = 21`.",
    example: 'name = "Eswatini"\nage = 21\nprice = 12.50\nprint(name, age, price)\n',
    challenge: {
      prompt: "Create a variable `maize_yield` holding the decimal `3.5`, and a variable `farmers` holding the whole number `120`. Print them on one line — yield first.",
      starter: '# create the two variables, then print them\n',
      expectedOutput: "3.5 120",
    },
  },
  {
    id: "py-arithmetic",
    language: "python",
    order: 3,
    title: "Arithmetic",
    explanation:
      "Python does maths with `+ - * /`.\n\n- `//` is whole-number division (drops the remainder).\n- `%` is the remainder.\n- `**` is a power.\n\n`1250 // 50` → `25`.",
    example: 'bags = 1250 // 50\nleftover = 1250 % 50\nprint(bags, leftover)\n',
    challenge: {
      prompt: "A bag holds 50 kg of maize. Print the **whole number of bags** you get from 1250 kg, then print the leftover kg on the next line.",
      starter: 'total = 1250\nbag = 50\n# print whole bags, then leftover\n',
      expectedOutput: "25\n0",
    },
  },
  {
    id: "py-input",
    language: "python",
    order: 4,
    title: "Input & Conversion",
    explanation:
      "`input()` reads text the user types — and it **always returns a string**.\n\nConvert before doing maths:\n`age = int(input(\"Age? \"))`\n\n(The practice editor runs without a keyboard, so challenges use fixed values.)",
    example: 'age = int(input("Age? "))\nprint(age + 1)\n',
    challenge: {
      prompt: "Convert the string `\"42\"` into an integer, add `8`, and print the result.",
      starter: 'value = "42"\n# convert to int, add 8, print\n',
      expectedOutput: "50",
    },
  },
  {
    id: "py-if",
    language: "python",
    order: 5,
    title: "If / Elif / Else",
    explanation:
      "`if` makes decisions. `elif` adds more conditions, `else` catches everything left.\n\nIndentation (4 spaces) groups the lines of each block.\n\nComparisons: `>`, `<`, `>=`, `<=`, `==`, `!=`.",
    example: 'temp = 15\nif temp > 30:\n    print("Hot")\nelif temp > 20:\n    print("Warm")\nelse:\n    print("Cool")\n',
    challenge: {
      prompt: "Rainfall this season is `420` mm. Print `Drought risk` when it is below `500`, otherwise print `Normal`.",
      starter: 'rainfall = 420\n# print the correct message\n',
      expectedOutput: "Drought risk",
    },
  },
  {
    id: "py-for",
    language: "python",
    order: 6,
    title: "For Loops & Range",
    explanation:
      "A `for` loop repeats code over a sequence.\n\n`range(a, b)` gives the numbers `a` up to (but not including) `b`.\n\n`range(1, 6)` → 1, 2, 3, 4, 5.",
    example: 'total = 0\nfor i in range(1, 6):\n    total += i\nprint(total)\n',
    challenge: {
      prompt: "Use a `for` loop to print the numbers 1 to 10, one per line.",
      starter: '# loop from 1 to 10 and print each number\n',
      expectedOutput: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10",
    },
  },
  {
    id: "py-while",
    language: "python",
    order: 7,
    title: "While Loops",
    explanation:
      "A `while` loop repeats **while a condition is true**.\n\nMake sure the condition eventually becomes false, or you get an infinite loop.",
    example: 'n = 1\nwhile n <= 5:\n    print(n)\n    n += 1\n',
    challenge: {
      prompt: "Using a `while` loop, print the **even numbers from 2 to 10** (inclusive), one per line.",
      starter: 'n = 2\n# print even numbers up to 10\n',
      hint: "Increase `n` by 2 each time.",
      expectedOutput: "2\n4\n6\n8\n10",
    },
  },
  {
    id: "py-lists",
    language: "python",
    order: 8,
    title: "Lists",
    explanation:
      "A **list** holds several values in order.\n\nUseful helpers: `len()`, `sum()`, `max()`, `min()`.",
    example: 'yields = [2.1, 3.4, 1.8]\nprint(sum(yields))\nprint(max(yields))\n',
    challenge: {
      prompt: "Given the temperatures `[21, 25, 19, 28, 22]`, print the difference between the highest and the lowest.",
      starter: 'temps = [21, 25, 19, 28, 22]\n# print max - min\n',
      expectedOutput: "9",
    },
  },
  {
    id: "py-functions",
    language: "python",
    order: 9,
    title: "Functions",
    explanation:
      "A **function** packages reusable code.\n\n```python\ndef double(x):\n    return x * 2\n```\n\n`return` sends a result back to the caller.",
    example: 'def double(x):\n    return x * 2\n\nprint(double(21))\n',
    challenge: {
      prompt: "Define a function `area(length, width)` that returns `length * width`. Call it with `8` and `5` and print the result.",
      starter: '# define area(), then print area(8, 5)\n',
      hint: "The function body is `return length * width`.",
      expectedOutput: "40",
    },
  },
  {
    id: "py-fizzbuzz",
    language: "python",
    order: 10,
    title: "Challenge: FizzBuzz",
    explanation:
      "Now combine loops and conditions.\n\n`n % 3 == 0` is true when `n` is divisible by 3 (the `%` operator gives the remainder).\n\nThis classic exercise tests whether you can chain logic together.",
    example: 'for i in range(1, 8):\n    if i % 2 == 0:\n        print(i, "even")\n    else:\n        print(i, "odd")\n',
    challenge: {
      prompt: "For the numbers 1 to 15: print `Fizz` if divisible by 3, `Buzz` if divisible by 5, `FizzBuzz` if divisible by both, otherwise the number itself.",
      starter: 'for i in range(1, 16):\n    # your logic here\n',
      hint: "Check \"divisible by 3 AND 5\" first.",
      expectedOutput: "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz",
    },
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
    challenge: {
      prompt: "Write a program that prints `Eswatini is growing!` exactly.",
      starter: '#include <iostream>\nint main() {\n    // print the message here\n    return 0;\n}\n',
      expectedOutput: "Eswatini is growing!",
    },
  },
  {
    id: "cpp-vars",
    language: "cpp",
    order: 2,
    title: "Variables & Types",
    explanation:
      "C++ needs a **type** for every variable: `int`, `double`, `char`, `bool`.\n\nAssign with `=`: `int age = 21;`",
    example: '#include <iostream>\nint main() {\n    int age = 21;\n    double price = 12.50;\n    std::cout << age << " " << price << std::endl;\n    return 0;\n}\n',
    challenge: {
      prompt: "Create a `double` variable `maize_yield` holding `3.5`, and an `int` variable `farmers` holding `120`. Print them on one line — yield first.",
      starter: '#include <iostream>\nint main() {\n    // create and print the two variables\n    return 0;\n}\n',
      expectedOutput: "3.5 120",
    },
  },
  {
    id: "cpp-arithmetic",
    language: "cpp",
    order: 3,
    title: "Arithmetic",
    explanation:
      "C++ uses `+ - * /` for maths. Integer division drops the remainder, and `%` gives the remainder.\n\n`1250 / 50` → `25`, and `1250 % 50` → `0`.",
    example: '#include <iostream>\nint main() {\n    int bags = 1250 / 50;\n    int leftover = 1250 % 50;\n    std::cout << bags << std::endl << leftover << std::endl;\n    return 0;\n}\n',
    challenge: {
      prompt: "A bag holds 50 kg of maize. Print the whole number of bags you get from 1250 kg, then the leftover kg on the next line.",
      starter: '#include <iostream>\nint main() {\n    int total = 1250;\n    int bag = 50;\n    // print whole bags, then leftover\n    return 0;\n}\n',
      expectedOutput: "25\n0",
    },
  },
  {
    id: "cpp-input",
    language: "cpp",
    order: 4,
    title: "Input with cin",
    explanation:
      "`std::cin` reads typed input into a variable.\n\n`int age; std::cin >> age;` reads a whole number.\n\n(The practice editor runs without a keyboard, so challenges use fixed values.)",
    example: '#include <iostream>\nint main() {\n    int age;\n    std::cin >> age;\n    std::cout << "Age: " << age << std::endl;\n    return 0;\n}\n',
    challenge: {
      prompt: "Double the value `42` and print the result.",
      starter: '#include <iostream>\nint main() {\n    int number = 42;\n    // print number * 2\n    return 0;\n}\n',
      expectedOutput: "84",
    },
  },
  {
    id: "cpp-if",
    language: "cpp",
    order: 5,
    title: "If / Else If / Else",
    explanation:
      "`if`, `else if`, and `else` make decisions.\n\nConditions use `>`, `<`, `>=`, `<=`, `==`, `!=`.",
    example: '#include <iostream>\nint main() {\n    int temp = 15;\n    if (temp > 30) {\n        std::cout << "Hot" << std::endl;\n    } else if (temp > 20) {\n        std::cout << "Warm" << std::endl;\n    } else {\n        std::cout << "Cool" << std::endl;\n    }\n    return 0;\n}\n',
    challenge: {
      prompt: "Rainfall this season is `420` mm. Print `Drought risk` when it is below `500`, otherwise `Normal`.",
      starter: '#include <iostream>\nint main() {\n    int rainfall = 420;\n    // print the correct message\n    return 0;\n}\n',
      expectedOutput: "Drought risk",
    },
  },
  {
    id: "cpp-for",
    language: "cpp",
    order: 6,
    title: "For Loops",
    explanation:
      "A `for` loop has three parts: start, condition, update.\n\n`for (int i = 1; i <= 10; i++)` counts 1 to 10.",
    example: '#include <iostream>\nint main() {\n    int total = 0;\n    for (int i = 1; i <= 5; i++) {\n        total += i;\n    }\n    std::cout << total << std::endl;\n    return 0;\n}\n',
    challenge: {
      prompt: "Use a `for` loop to print the numbers 1 to 10, one per line.",
      starter: '#include <iostream>\nint main() {\n    // loop 1..10 and print each number\n    return 0;\n}\n',
      expectedOutput: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10",
    },
  },
  {
    id: "cpp-while",
    language: "cpp",
    order: 7,
    title: "While Loops",
    explanation:
      "A `while` loop repeats while a condition is true.\n\nUpdate the variable inside the loop so the condition eventually fails.",
    example: '#include <iostream>\nint main() {\n    int n = 1;\n    while (n <= 5) {\n        std::cout << n << std::endl;\n        n++;\n    }\n    return 0;\n}\n',
    challenge: {
      prompt: "Using a `while` loop, print the **even numbers from 2 to 10** (inclusive), one per line.",
      starter: '#include <iostream>\nint main() {\n    int n = 2;\n    // print even numbers up to 10\n    return 0;\n}\n',
      hint: "Increase `n` by 2 each time.",
      expectedOutput: "2\n4\n6\n8\n10",
    },
  },
  {
    id: "cpp-arrays",
    language: "cpp",
    order: 8,
    title: "Arrays",
    explanation:
      "An **array** holds a fixed number of values of the same type.\n\n`int nums[3] = {4, 8, 15};`\n\nLoop over it with an index: `nums[i]`.",
    example: '#include <iostream>\nint main() {\n    int nums[4] = {2, 4, 6, 8};\n    int total = 0;\n    for (int i = 0; i < 4; i++) total += nums[i];\n    std::cout << total << std::endl;\n    return 0;\n}\n',
    challenge: {
      prompt: "Given `{21, 25, 19, 28, 22}`, print the difference between the highest and the lowest value.",
      starter: '#include <iostream>\nint main() {\n    int temps[5] = {21, 25, 19, 28, 22};\n    // find max and min, print max - min\n    return 0;\n}\n',
      expectedOutput: "9",
    },
  },
  {
    id: "cpp-functions",
    language: "cpp",
    order: 9,
    title: "Functions",
    explanation:
      "A **function** packages reusable code. Declare it before `main`, then call it.\n\n```cpp\nint area(int length, int width) {\n    return length * width;\n}\n```",
    example: '#include <iostream>\nint area(int length, int width) {\n    return length * width;\n}\nint main() {\n    std::cout << area(8, 5) << std::endl;\n    return 0;\n}\n',
    challenge: {
      prompt: "Define a function `area(length, width)` that returns `length * width`. Call it with `8` and `5` and print the result.",
      starter: '#include <iostream>\n// define area() here\nint main() {\n    // print area(8, 5)\n    return 0;\n}\n',
      hint: "Return `length * width` and call `area(8, 5)` from `main`.",
      expectedOutput: "40",
    },
  },
  {
    id: "cpp-fizzbuzz",
    language: "cpp",
    order: 10,
    title: "Challenge: FizzBuzz",
    explanation:
      "Combine loops and conditions.\n\n`i % 3 == 0` is true when `i` is divisible by 3.\n\nThis tests whether you can chain the logic together.",
    example: '#include <iostream>\nint main() {\n    for (int i = 1; i <= 7; i++) {\n        if (i % 2 == 0) std::cout << i << " even" << std::endl;\n        else std::cout << i << " odd" << std::endl;\n    }\n    return 0;\n}\n',
    challenge: {
      prompt: "For the numbers 1 to 15: print `Fizz` if divisible by 3, `Buzz` if divisible by 5, `FizzBuzz` if divisible by both, otherwise the number itself.",
      starter: '#include <iostream>\nint main() {\n    for (int i = 1; i <= 15; i++) {\n        // your logic here\n    }\n    return 0;\n}\n',
      hint: "Check \"divisible by 3 AND 5\" first.",
      expectedOutput: "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz",
    },
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
