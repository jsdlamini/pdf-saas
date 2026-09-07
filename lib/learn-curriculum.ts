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
  challenges: LearnChallenge[];
};

export type LearnSection = {
  language: LearnLanguage;
  title: string;
  lessons: LearnLesson[];
};

function py(prompt: string, expectedOutput: string, starter?: string): LearnChallenge {
  return { prompt, starter: starter ?? "# Write your solution here\n", expectedOutput };
}

function cpp(prompt: string, expectedOutput: string, starter?: string): LearnChallenge {
  return {
    prompt,
    starter: starter ?? '#include <iostream>\nint main() {\n    // your code here\n    return 0;\n}\n',
    expectedOutput,
  };
}

export const LEARN_LESSONS: LearnLesson[] = [
  // ─────────────────────────── Python ───────────────────────────
  {
    id: "py-hello",
    language: "python",
    order: 1,
    title: "Hello, World",
    explanation:
      "Every program does three things: takes input, does work, and writes output. We start with output.\n\nIn Python, `print()` writes text to the screen. Text inside quotes is a **string**. You can print several things in one `print` by separating them with commas — Python adds a space between them. Each new `print()` starts on a new line.\n\n`print(\"Hello\")` → `Hello`",
    example: 'print("Hello, world!")\nprint("Farmers", "plant", "maize")\n',
    challenges: [
      py("Print the word `Hello` exactly.", "Hello"),
      py("Print `Learning to code is fun!` exactly.", "Learning to code is fun!"),
      py("Print the number `2025` exactly.", "2025"),
      py("Print the decimal `3.5` exactly.", "3.5"),
      py("Print `Good` and `morning` on one line using a single print with a comma.", "Good morning"),
      py("Print the sentence `Farmers plant maize in October.`", "Farmers plant maize in October."),
      py("Print the word `Fizz` on its own.", "Fizz"),
      py("Print `one` then `two` on separate lines (two prints).", "one\ntwo"),
      py("Print `A`, `B` and `C` each on its own line (three prints).", "A\nB\nC"),
      py("Print `Line 1`, `Line 2` and `Line 3` each on its own line.", "Line 1\nLine 2\nLine 3"),
    ],
  },
  {
    id: "py-vars",
    language: "python",
    order: 2,
    title: "Variables & Types",
    explanation:
      "Printing fixed text is limited — programs need to remember values. A **variable** is a named box that stores a value.\n\nYou create one with `name = value` (read the `=` as \"becomes\"). Python works out the type for you:\n\n- whole numbers → `int`\n- decimals → `float`\n- text → `str`\n- true/false → `bool`\n\nYou can reuse a variable as often as you like, and overwrite it by assigning again: `count = 1` then `count = 2`.",
    example: 'name = "Sam"\nage = 21\nprice = 12.50\nis_hot = True\nprint(name, age, price, is_hot)\n',
    challenges: [
      py("Create `age = 21` and print it.", "21", "age = 21\n# print age\n"),
      py("Create `price = 12.5` and print it.", "12.5"),
      py("Create `name = 'Sam'` and print it.", "Sam"),
      py("Create `maize_yield = 3.5` and `farmers = 120`, then print both on one line (yield first).", "3.5 120"),
      py("Create `a = 10` and `b = 20`, print both on one line.", "10 20"),
      py("Create `first = 'Alpha'` and `second = 'Beta'`, print both on one line.", "Alpha Beta"),
      py("Create `is_hot = True` and print it.", "True"),
      py("Create `count = 1`, then change it to `2`, then print it.", "2"),
      py("Create `total = 10`, then `total = total + 5`, then print `total`.", "15"),
      py("Create `x = 4`, `y = 7` and `z = 12`, print all three on one line.", "4 7 12"),
    ],
  },
  {
    id: "py-arithmetic",
    language: "python",
    order: 3,
    title: "Arithmetic",
    explanation:
      "Programs compute. Python uses `+ - * /` like a calculator, plus three extras:\n\n- `//` — whole-number division (drops the remainder)\n- `%` — the remainder\n- `**` — a power\n\nOrder of operations (brackets, powers, then ×÷, then +−) applies; use parentheses to be explicit. Store the result in a variable or print it directly.",
    example: 'bags = 1250 // 50\nleftover = 1250 % 50\nprint(bags, leftover)\nprint((2 + 3) * 4)\n',
    challenges: [
      py("Print the value of `7 + 3`.", "10"),
      py("Print the value of `1250 // 50`.", "25"),
      py("Print the value of `1250 % 50`.", "0"),
      py("Print `84 + 91 + 76`.", "251"),
      py("Print `(84 + 91 + 76) // 3` (whole-number average).", "83"),
      py("Print `2 ** 10` (two to the power of ten).", "1024"),
      py("Print `100 - 37`.", "63"),
      py("Print `7 * 6`.", "42"),
      py("Print `100 / 8` exactly as Python prints it.", "12.5"),
      py("Print `(20 + 30) * 2 - 15`.", "85"),
    ],
  },
  {
    id: "py-input",
    language: "python",
    order: 4,
    title: "Input & Conversion",
    explanation:
      "Programs that never change are boring. `input()` pauses and reads what the user types — but it **always returns a string**.\n\nBefore doing maths on it you must convert:\n\n- `int(\"42\")` → `42`\n- `float(\"3.5\")` → `3.5`\n- `str(42)` → `\"42\"`\n\n(The practice editor runs without a keyboard, so challenges use fixed values — the example shows the input pattern.)",
    example: 'age = int(input("Age? "))\nprint(age + 1)\n',
    challenges: [
      py("Convert `\"42\"` to an integer and print it.", "42", 'value = "42"\n# convert and print\n'),
      py("Convert `\"42\"` to an integer, add `8`, and print the result.", "50", 'value = "42"\n# convert, add 8, print\n'),
      py("Convert `\"3.5\"` to a float and print it.", "3.5"),
      py("Convert `\"3.5\"` to a float, double it, print the result.", "7.0"),
      py("Convert `\"100\"` to an int, subtract `25`, print the result.", "75"),
      py("Convert `\"7\"` and `\"8\"` to ints and print their sum.", "15"),
      py("Convert `\"12\"` to an int and print `12 * 12`.", "144"),
      py("Convert `\"50\"` to an int and print its whole-number half (`// 2`).", "25"),
      py("Convert `\"9\"` to an int and print `9 ** 2`.", "81"),
      py("Convert `\"2024\"` to an int, add `1`, print the result.", "2025"),
    ],
  },
  {
    id: "py-if",
    language: "python",
    order: 5,
    title: "If / Elif / Else",
    explanation:
      "Real programs choose. `if` runs a block only when a condition is true; `elif` checks more conditions in order; `else` catches everything left over.\n\nIndentation (4 spaces) groups the lines of each block. Comparisons: `==` equal, `!=` not equal, `>`, `<`, `>=`, `<=`.\n\nChain them to build a decision ladder.",
    example: 'temp = 15\nif temp > 30:\n    print("Hot")\nelif temp > 20:\n    print("Warm")\nelse:\n    print("Cool")\n',
    challenges: [
      py("Rainfall is `420`. Print `Drought risk` if it is below `500`, else `Normal`.", "Drought risk", 'rainfall = 420\n# print the right message\n'),
      py("Rainfall is `620`. Print `Drought risk` if below `500`, else `Normal`.", "Normal", 'rainfall = 620\n'),
      py("`temp = 35`. Print `Hot` if above `30`, else `OK`.", "Hot", 'temp = 35\n'),
      py("`age = 17`. Print `Adult` if `age >= 18`, else `Minor`.", "Minor", 'age = 17\n'),
      py("`score = 85`. Print `Pass` if `score >= 50`, else `Fail`.", "Pass", 'score = 85\n'),
      py("`temp = 15`. Print `Hot` (>30), `Warm` (>20), otherwise `Cool`.", "Cool", 'temp = 15\n'),
      py("`temp = 25`. Print `Hot` (>30), `Warm` (>20), otherwise `Cool`.", "Warm", 'temp = 25\n'),
      py("`n = 7`. Print `Even` if `n % 2 == 0`, else `Odd`.", "Odd", 'n = 7\n'),
      py("`n = 10`. Print `Even` if `n % 2 == 0`, else `Odd`.", "Even", 'n = 10\n'),
      py("`maize = 1200` and `threshold = 1000`. Print `Above` if `maize > threshold`, else `Below`.", "Above", 'maize = 1200\nthreshold = 1000\n'),
    ],
  },
  {
    id: "py-for",
    language: "python",
    order: 6,
    title: "For Loops & Range",
    explanation:
      "Repetition is what makes code powerful. A `for` loop runs a block once for each item in a sequence.\n\n`range(a, b)` gives `a, a+1, …, b-1`, so `range(1, 11)` is 1..10. The loop variable (`i` below) takes each value in turn. Use it inside the block to do something with each number.",
    example: 'total = 0\nfor i in range(1, 6):\n    total = total + i\nprint(total)\n',
    challenges: [
      py("Print the numbers 1 to 5, one per line.", "1\n2\n3\n4\n5", "for i in range(1, 6):\n    # print i\n"),
      py("Print the numbers 1 to 10, one per line.", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10"),
      py("Print the numbers 0 to 4, one per line (use range(5)).", "0\n1\n2\n3\n4"),
      py("Print the even numbers 2, 4, 6, 8, 10, one per line (use range with a step).", "2\n4\n6\n8\n10"),
      py("Print the sum of the numbers 1 to 10.", "55"),
      py("Print the sum of the numbers 1 to 100.", "5050"),
      py("Print `2 * i` for `i` from 1 to 5 (i.e. 2,4,6,8,10).", "2\n4\n6\n8\n10"),
      py("Print the squares `i*i` for `i` from 1 to 5.", "1\n4\n9\n16\n25"),
      py("Count down: print 5, 4, 3, 2, 1 (one per line).", "5\n4\n3\n2\n1"),
      py("Print the sum of even numbers from 2 to 20.", "110"),
    ],
  },
  {
    id: "py-while",
    language: "python",
    order: 7,
    title: "While Loops",
    explanation:
      "A `while` loop repeats **as long as a condition stays true** — useful when you don't know the count in advance.\n\nYou must update the condition's variable inside the loop, or it runs forever.\n\n```python\nn = 1\nwhile n <= 5:\n    print(n)\n    n = n + 1\n```",
    example: 'n = 1\nwhile n <= 5:\n    print(n)\n    n = n + 1\n',
    challenges: [
      py("Using `while`, print the numbers 1 to 5, one per line.", "1\n2\n3\n4\n5", 'n = 1\nwhile n <= 5:\n    print(n)\n    n = n + 1\n'),
      py("Using `while`, print the even numbers 2 to 10, one per line.", "2\n4\n6\n8\n10", 'n = 2\n# print even numbers up to 10\n'),
      py("Using `while`, print the numbers 10 down to 1, one per line.", "10\n9\n8\n7\n6\n5\n4\n3\n2\n1"),
      py("Using `while`, print 5, 10, 15, 20, 25 (one per line).", "5\n10\n15\n20\n25"),
      py("Using `while`, print the squares 1, 4, 9, 16 (one per line).", "1\n4\n9\n16"),
      py("Using `while`, sum the numbers 1 to 10 and print the total.", "55"),
      py("Start `n = 1`; keep doubling it until it exceeds 100, printing each value.", "1\n2\n4\n8\n16\n32\n64\n128"),
      py("Print `3 * n` for n = 1..4 using `while`.", "3\n6\n9\n12"),
      py("Print the odd numbers 1 to 9 using `while`.", "1\n3\n5\n7\n9"),
      py("Using `while`, print 20, 15, 10, 5, 0 (count down by 5).", "20\n15\n10\n5\n0"),
    ],
  },
  {
    id: "py-lists",
    language: "python",
    order: 8,
    title: "Lists",
    explanation:
      "A **list** holds many values in one variable, in order: `[a, b, c]`.\n\nAccess an item by index (starting at 0): `nums[0]` is the first. Helpers do the common work:\n\n- `len()` — how many items\n- `sum()` — total\n- `max()` / `min()` — biggest / smallest\n\nLists let you process a whole collection instead of one value at a time.",
    example: 'yields = [2.1, 3.4, 1.8]\nprint(sum(yields))\nprint(max(yields))\n',
    challenges: [
      py("Print `len([10, 20, 30])`.", "3", "nums = [10, 20, 30]\n# print the length\n"),
      py("Print `sum([10, 20, 30])`.", "60"),
      py("Print `max([21, 25, 19, 28, 22])`.", "28"),
      py("Print `min([21, 25, 19, 28, 22])`.", "19"),
      py("Print `max([21, 25, 19, 28, 22]) - min([21, 25, 19, 28, 22])`.", "9"),
      py("Print `sum([2.1, 3.4, 1.8])` as Python prints it.", "7.3"),
      py("Print the first item of `nums = [4, 8, 15, 16]` (index 0).", "4", "nums = [4, 8, 15, 16]\n# print nums[0]\n"),
      py("Print the last item of `nums = [4, 8, 15, 16]` (index -1).", "16"),
      py("Print `len([4, 8, 15, 16, 23, 42])`.", "6"),
      py("Print the average (sum / len) of `[10, 20, 30, 40]` as a whole number.", "25"),
    ],
  },
  {
    id: "py-functions",
    language: "python",
    order: 9,
    title: "Functions",
    explanation:
      "Functions give a block of code a name so you can call it repeatedly.\n\n`def name(args):` starts a function; `return` sends a result back to the caller.\n\n```python\ndef double(x):\n    return x * 2\n```\n\n`print(double(21))` → `42`. Functions are the heart of abstraction: you decide **what** a thing does once, then use it anywhere.",
    example: 'def double(x):\n    return x * 2\n\nprint(double(21))\n',
    challenges: [
      py("Define `double(x)` returning `x * 2`; print `double(21)`.", "42", 'def double(x):\n    return x * 2\n\n# print double(21)\n'),
      py("Define `area(length, width)` returning `length * width`; print `area(8, 5)`.", "40"),
      py("Define `square(x)` returning `x * x`; print `square(9)`.", "81"),
      py("Define `add(a, b)` returning `a + b`; print `add(12, 30)`.", "42"),
      py("Define `triple(x)` returning `x * 3`; print `triple(14)`.", "42"),
      py("Define `greet(name)` returning `\"Hello \" + name`; print `greet(\"Sam\")`.", "Hello Sam"),
      py("Define `average(a, b)` returning `(a + b) / 2`; print `average(10, 20)`.", "15.0"),
      py("Define `is_even(n)` returning `n % 2 == 0`; print `is_even(10)`.", "True"),
      py("Define `is_even(n)` returning `n % 2 == 0`; print `is_even(7)`.", "False"),
      py("Define `c_to_f(c)` returning `c * 9 / 5 + 32`; print `c_to_f(100)`.", "212.0"),
    ],
  },
  {
    id: "py-fizzbuzz",
    language: "python",
    order: 10,
    title: "Challenge: FizzBuzz",
    explanation:
      "Time to combine loops and conditions. `n % 3 == 0` is true when `n` is divisible by 3 (the `%` operator gives the remainder).\n\nFizzBuzz asks you to chain three rules into one small algorithm — checking the most specific rule (divisible by 3 **and** 5) first. This is a classic interview question because it tests whether you can hold several conditions in your head at once.",
    example: 'for i in range(1, 8):\n    if i % 2 == 0:\n        print(i, "even")\n    else:\n        print(i, "odd")\n',
    challenges: [
      py("For 1..15: print `Fizz` if divisible by 3, `Buzz` if by 5, `FizzBuzz` if both, else the number.", "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz", 'for i in range(1, 16):\n    # your logic here\n'),
      py("For 1..15: print `Even` for even numbers and `Odd` for odd numbers.", "Odd\nEven\nOdd\nEven\nOdd\nEven\nOdd\nEven\nOdd\nEven\nOdd\nEven\nOdd\nEven\nOdd"),
      py("Print the sum of all multiples of 3 below 20.", "63"),
      py("Print `YES` for each number 1..20 divisible by 4, and the number otherwise.", "1\n2\n3\nYES\n5\n6\n7\nYES\n9\n10\n11\nYES\n13\n14\n15\nYES\n17\n18\n19\nYES"),
      py("For 1..10: print `high` if the number is above 5, else `low`.", "low\nlow\nlow\nlow\nlow\nhigh\nhigh\nhigh\nhigh\nhigh"),
      py("Print the sum of squares of 1..5 (1 + 4 + 9 + 16 + 25).", "55"),
      py("For 1..12: print the number only if it is a multiple of 3 (skip others).", "3\n6\n9\n12"),
      py("Print `boom` for each number 1..20 that is a multiple of 7.", "boom\nboom"),
      py("For 1..10: print `fizz` for multiples of 3, else the number.", "1\n2\nfizz\n4\n5\nfizz\n7\n8\nfizz\n10"),
      py("Print the product of the numbers 1..5 (1*2*3*4*5).", "120"),
    ],
  },

  // ─────────────────────────── C++ ───────────────────────────
  {
    id: "cpp-hello",
    language: "cpp",
    order: 1,
    title: "Hello, World",
    explanation:
      "Every program takes input, does work, and writes output. In C++ you print with `std::cout << ...`.\n\nEvery C++ program needs:\n\n- `#include <iostream>` (the input/output library)\n- `int main() { ... }` (where execution starts)\n- `return 0;` (\"success\")\n\n`std::endl` (or `\\n`) moves to a new line. Statements end with a semicolon `;`.",
    example: '#include <iostream>\nint main() {\n    std::cout << "Hello, world!" << std::endl;\n    return 0;\n}\n',
    challenges: [
      cpp("Print `Hello` exactly.", "Hello"),
      cpp("Print `Learning to code is fun!` exactly.", "Learning to code is fun!"),
      cpp("Print the number `2025` exactly.", "2025"),
      cpp("Print the decimal `3.5` exactly.", "3.5"),
      cpp("Print `Good morning` on one line.", "Good morning"),
      cpp("Print `Farmers plant maize in October.`", "Farmers plant maize in October."),
      cpp("Print `Fizz` on its own.", "Fizz"),
      cpp("Print `one` then `two` on separate lines.", "one\ntwo"),
      cpp("Print `A`, `B` and `C` each on its own line.", "A\nB\nC"),
      cpp("Print `Line 1`, `Line 2` and `Line 3` each on its own line.", "Line 1\nLine 2\nLine 3"),
    ],
  },
  {
    id: "cpp-vars",
    language: "cpp",
    order: 2,
    title: "Variables & Types",
    explanation:
      "A **variable** is a named box that stores a value. Unlike Python, C++ requires you to declare a **type** for every variable:\n\n- `int` — whole numbers\n- `double` — decimals\n- `char` — a single character\n- `bool` — true/false\n\nAssign with `=`: `int age = 21;`. You can overwrite a variable later with another assignment.",
    example: '#include <iostream>\nint main() {\n    int age = 21;\n    double price = 12.50;\n    std::cout << age << " " << price << std::endl;\n    return 0;\n}\n',
    challenges: [
      cpp("Create `int age = 21;` and print it.", "21"),
      cpp("Create `double price = 12.5;` and print it.", "12.5"),
      cpp("Create `int farmers = 120;` and print it.", "120"),
      cpp("Create `double maize_yield = 3.5;` and `int farmers = 120;`, print both on one line (yield first).", "3.5 120"),
      cpp("Create `int a = 10; int b = 20;`, print both on one line.", "10 20"),
      cpp("Create `int count = 1;`, then `count = 2;`, then print it.", "2"),
      cpp("Create `int total = 10;`, then `total = total + 5;`, then print it.", "15"),
      cpp("Create `int x = 4; int y = 7; int z = 12;`, print all three on one line.", "4 7 12"),
      cpp("Create `double pi = 3.14;` and print it.", "3.14"),
      cpp("Create `bool ok = true;` and print it (prints `1`).", "1"),
    ],
  },
  {
    id: "cpp-arithmetic",
    language: "cpp",
    order: 3,
    title: "Arithmetic",
    explanation:
      "C++ uses `+ - * /` for maths. With integers, `/` drops the remainder, and `%` gives the remainder.\n\n`1250 / 50` → `25`, `1250 % 50` → `0`.\n\nUse parentheses to control order. Results can be stored in a variable or printed directly with `std::cout <<`.",
    example: '#include <iostream>\nint main() {\n    int bags = 1250 / 50;\n    int leftover = 1250 % 50;\n    std::cout << bags << std::endl << leftover << std::endl;\n    return 0;\n}\n',
    challenges: [
      cpp("Print the value of `7 + 3`.", "10"),
      cpp("Print the value of `1250 / 50`.", "25"),
      cpp("Print the value of `1250 % 50`.", "0"),
      cpp("Print `84 + 91 + 76`.", "251"),
      cpp("Print `(84 + 91 + 76) / 3` (integer average).", "83"),
      cpp("Print `100 - 37`.", "63"),
      cpp("Print `7 * 6`.", "42"),
      cpp("Print `100 / 8` using a `double` (so you get `12.5`).", "12.5"),
      cpp("Print `(20 + 30) * 2 - 15`.", "85"),
      cpp("Print `11 % 3` (the remainder of 11 divided by 3).", "2"),
    ],
  },
  {
    id: "cpp-input",
    language: "cpp",
    order: 4,
    title: "Input with cin",
    explanation:
      "`std::cin` reads typed input into a variable:\n\n```cpp\nint age;\nstd::cin >> age;\n```\n\nReads a whole number. For decimals use `double`, for text use `std::string`.\n\n(The practice editor runs without a keyboard, so challenges use fixed values.)",
    example: '#include <iostream>\nint main() {\n    int age;\n    std::cin >> age;\n    std::cout << "Age: " << age << std::endl;\n    return 0;\n}\n',
    challenges: [
      cpp("Create `int number = 42;` and print it.", "42", '#include <iostream>\nint main() {\n    int number = 42;\n    // print it\n    return 0;\n}\n'),
      cpp("Print `42 + 8`.", "50"),
      cpp("Print `42 * 2`.", "84"),
      cpp("Print `100 - 25`.", "75"),
      cpp("Print the sum of `7` and `8`.", "15"),
      cpp("Print `12 * 12`.", "144"),
      cpp("Print `50 / 2`.", "25"),
      cpp("Print `9 * 9`.", "81"),
      cpp("Print `2024 + 1`.", "2025"),
      cpp("Print the whole-number average of 84, 91 and 76.", "83"),
    ],
  },
  {
    id: "cpp-if",
    language: "cpp",
    order: 5,
    title: "If / Else If / Else",
    explanation:
      "`if`, `else if`, and `else` make decisions.\n\n```cpp\nif (cond) { ... }\nelse if (cond) { ... }\nelse { ... }\n```\n\nConditions use `>`, `<`, `>=`, `<=`, `==`, `!=`. Braces `{}` group each block.",
    example: '#include <iostream>\nint main() {\n    int temp = 15;\n    if (temp > 30) {\n        std::cout << "Hot" << std::endl;\n    } else if (temp > 20) {\n        std::cout << "Warm" << std::endl;\n    } else {\n        std::cout << "Cool" << std::endl;\n    }\n    return 0;\n}\n',
    challenges: [
      cpp("`rainfall = 420`. Print `Drought risk` if below 500, else `Normal`.", "Drought risk", '#include <iostream>\nint main() {\n    int rainfall = 420;\n    // your logic here\n    return 0;\n}\n'),
      cpp("`rainfall = 620`. Print `Drought risk` if below 500, else `Normal`.", "Normal"),
      cpp("`temp = 35`. Print `Hot` if above 30, else `OK`.", "Hot"),
      cpp("`age = 17`. Print `Adult` if `age >= 18`, else `Minor`.", "Minor"),
      cpp("`score = 85`. Print `Pass` if `score >= 50`, else `Fail`.", "Pass"),
      cpp("`temp = 15`. Print `Hot` (>30), `Warm` (>20), else `Cool`.", "Cool"),
      cpp("`temp = 25`. Print `Hot` (>30), `Warm` (>20), else `Cool`.", "Warm"),
      cpp("`n = 7`. Print `Even` if `n % 2 == 0`, else `Odd`.", "Odd"),
      cpp("`n = 10`. Print `Even` if `n % 2 == 0`, else `Odd`.", "Even"),
      cpp("`maize = 1200`, `threshold = 1000`. Print `Above` if `maize > threshold`, else `Below`.", "Above"),
    ],
  },
  {
    id: "cpp-for",
    language: "cpp",
    order: 6,
    title: "For Loops",
    explanation:
      "A `for` loop has three parts: start, condition, update.\n\n```cpp\nfor (int i = 1; i <= 10; i++) { ... }\n```\n\nReads: \"start at 1; keep going while i ≤ 10; add 1 each time.\" Use the loop variable `i` inside the block.",
    example: '#include <iostream>\nint main() {\n    int total = 0;\n    for (int i = 1; i <= 5; i++) {\n        total += i;\n    }\n    std::cout << total << std::endl;\n    return 0;\n}\n',
    challenges: [
      cpp("Print the numbers 1 to 5, one per line.", "1\n2\n3\n4\n5", '#include <iostream>\nint main() {\n    for (int i = 1; i <= 5; i++) {\n        // print i\n    }\n    return 0;\n}\n'),
      cpp("Print the numbers 1 to 10, one per line.", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10"),
      cpp("Print the even numbers 2, 4, 6, 8, 10, one per line.", "2\n4\n6\n8\n10"),
      cpp("Print the sum of the numbers 1 to 10.", "55"),
      cpp("Print the sum of the numbers 1 to 100.", "5050"),
      cpp("Print `2 * i` for i from 1 to 5.", "2\n4\n6\n8\n10"),
      cpp("Print the squares `i*i` for i from 1 to 5.", "1\n4\n9\n16\n25"),
      cpp("Print 5, 4, 3, 2, 1 (count down).", "5\n4\n3\n2\n1"),
      cpp("Print the sum of even numbers from 2 to 20.", "110"),
      cpp("Print the numbers 0 to 4 (start at 0).", "0\n1\n2\n3\n4"),
    ],
  },
  {
    id: "cpp-while",
    language: "cpp",
    order: 7,
    title: "While Loops",
    explanation:
      "A `while` loop repeats while a condition is true.\n\n```cpp\nint n = 1;\nwhile (n <= 5) {\n    std::cout << n << std::endl;\n    n++;\n}\n```\n\nUpdate the variable inside the loop (`n++`) so the condition eventually fails.",
    example: '#include <iostream>\nint main() {\n    int n = 1;\n    while (n <= 5) {\n        std::cout << n << std::endl;\n        n++;\n    }\n    return 0;\n}\n',
    challenges: [
      cpp("Using `while`, print the numbers 1 to 5, one per line.", "1\n2\n3\n4\n5", '#include <iostream>\nint main() {\n    int n = 1;\n    while (n <= 5) {\n        std::cout << n << std::endl;\n        n++;\n    }\n    return 0;\n}\n'),
      cpp("Using `while`, print the even numbers 2 to 10.", "2\n4\n6\n8\n10"),
      cpp("Using `while`, print 10 down to 1, one per line.", "10\n9\n8\n7\n6\n5\n4\n3\n2\n1"),
      cpp("Using `while`, print 5, 10, 15, 20, 25.", "5\n10\n15\n20\n25"),
      cpp("Using `while`, sum the numbers 1 to 10 and print the total.", "55"),
      cpp("Start `n = 1`; double it until it exceeds 100, printing each value.", "1\n2\n4\n8\n16\n32\n64\n128"),
      cpp("Print `3 * n` for n = 1..4 using `while`.", "3\n6\n9\n12"),
      cpp("Print the odd numbers 1 to 9 using `while`.", "1\n3\n5\n7\n9"),
      cpp("Using `while`, print 20, 15, 10, 5, 0.", "20\n15\n10\n5\n0"),
      cpp("Print the squares 1, 4, 9, 16 using `while`.", "1\n4\n9\n16"),
    ],
  },
  {
    id: "cpp-arrays",
    language: "cpp",
    order: 8,
    title: "Arrays",
    explanation:
      "An **array** holds a fixed number of values of the same type.\n\n```cpp\nint nums[4] = {2, 4, 6, 8};\n```\n\nIndexes start at 0: `nums[0]` is the first element. Loop with an index to visit every element.",
    example: '#include <iostream>\nint main() {\n    int nums[4] = {2, 4, 6, 8};\n    int total = 0;\n    for (int i = 0; i < 4; i++) total += nums[i];\n    std::cout << total << std::endl;\n    return 0;\n}\n',
    challenges: [
      cpp("Print the sum of `{10, 20, 30}`.", "60", '#include <iostream>\nint main() {\n    int nums[3] = {10, 20, 30};\n    int total = 0;\n    // sum and print\n    return 0;\n}\n'),
      cpp("Print the largest of `{21, 25, 19, 28, 22}`.", "28"),
      cpp("Print the smallest of `{21, 25, 19, 28, 22}`.", "19"),
      cpp("Print `max - min` of `{21, 25, 19, 28, 22}`.", "9"),
      cpp("Print `nums[0]` where `nums = {4, 8, 15, 16}`.", "4"),
      cpp("Print `nums[3]` where `nums = {4, 8, 15, 16}`.", "16"),
      cpp("Print the sum of `{4, 8, 15, 16, 23, 42}`.", "108"),
      cpp("Print the average (sum / count) of `{10, 20, 30, 40}`.", "25"),
      cpp("Print the product of `{2, 3, 4}`.", "24"),
      cpp("Count how many of `{1, 4, 9, 12, 15, 18}` are even, and print the count.", "3"),
    ],
  },
  {
    id: "cpp-functions",
    language: "cpp",
    order: 9,
    title: "Functions",
    explanation:
      "A **function** packages reusable code. Declare it **before** `main`, then call it.\n\n```cpp\nint area(int length, int width) {\n    return length * width;\n}\n```\n\n`return` sends a result back. Functions are how you abstract: decide what a thing does once, then call it anywhere.",
    example: '#include <iostream>\nint area(int length, int width) {\n    return length * width;\n}\nint main() {\n    std::cout << area(8, 5) << std::endl;\n    return 0;\n}\n',
    challenges: [
      cpp("Define `int doubleIt(int x) { return x * 2; }` and print `doubleIt(21)`.", "42", '#include <iostream>\n// define doubleIt here\nint main() {\n    // print doubleIt(21)\n    return 0;\n}\n'),
      cpp("Define `int area(int l, int w) { return l * w; }` and print `area(8, 5)`.", "40"),
      cpp("Define `int square(int x) { return x * x; }` and print `square(9)`.", "81"),
      cpp("Define `int add(int a, int b) { return a + b; }` and print `add(12, 30)`.", "42"),
      cpp("Define `int triple(int x) { return x * 3; }` and print `triple(14)`.", "42"),
      cpp("Define `bool isEven(int n) { return n % 2 == 0; }` and print `isEven(10)` (prints 1).", "1"),
      cpp("Print `isEven(7)` using the `isEven` function above (prints 0).", "0"),
      cpp("Define `int sum3(int a, int b, int c) { return a + b + c; }` and print `sum3(10, 20, 30)`.", "60"),
      cpp("Define `int maxOf(int a, int b) { return a > b ? a : b; }` and print `maxOf(9, 14)`.", "14"),
      cpp("Define `int avg(int a, int b) { return (a + b) / 2; }` and print `avg(10, 20)`.", "15"),
    ],
  },
  {
    id: "cpp-fizzbuzz",
    language: "cpp",
    order: 10,
    title: "Challenge: FizzBuzz",
    explanation:
      "Combine loops and conditions. `i % 3 == 0` is true when `i` is divisible by 3.\n\nFizzBuzz chains three rules into one algorithm — check the most specific rule (divisible by 3 **and** 5) first. It is a classic interview question because it tests whether you can hold several conditions in your head at once.",
    example: '#include <iostream>\nint main() {\n    for (int i = 1; i <= 7; i++) {\n        if (i % 2 == 0) std::cout << i << " even" << std::endl;\n        else std::cout << i << " odd" << std::endl;\n    }\n    return 0;\n}\n',
    challenges: [
      cpp("For 1..15: print `Fizz` if divisible by 3, `Buzz` if by 5, `FizzBuzz` if both, else the number.", "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz", '#include <iostream>\nint main() {\n    for (int i = 1; i <= 15; i++) {\n        // your logic here\n    }\n    return 0;\n}\n'),
      cpp("For 1..15: print `Even` for even numbers and `Odd` for odd.", "Odd\nEven\nOdd\nEven\nOdd\nEven\nOdd\nEven\nOdd\nEven\nOdd\nEven\nOdd\nEven\nOdd"),
      cpp("Print the sum of all multiples of 3 below 20.", "63"),
      cpp("For 1..10: print `high` if the number is above 5, else `low`.", "low\nlow\nlow\nlow\nlow\nhigh\nhigh\nhigh\nhigh\nhigh"),
      cpp("Print the sum of squares of 1..5.", "55"),
      cpp("For 1..12: print the number only if it is a multiple of 3.", "3\n6\n9\n12"),
      cpp("For 1..20: print `boom` for multiples of 7.", "boom\nboom"),
      cpp("For 1..10: print `fizz` for multiples of 3, else the number.", "1\n2\nfizz\n4\n5\nfizz\n7\n8\nfizz\n10"),
      cpp("Print the product of the numbers 1..5.", "120"),
      cpp("For 1..20: print `YES` for multiples of 4, else the number.", "1\n2\n3\nYES\n5\n6\n7\nYES\n9\n10\n11\nYES\n13\n14\n15\nYES\n17\n18\n19\nYES"),
    ],
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
