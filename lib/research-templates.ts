export type ResearchTemplate = {
  slug: string;
  name: string;
  description: string;
  entries: Array<{ path: string; kind: "file" | "folder"; content: string }>;
};

export const RESEARCH_TEMPLATES: ResearchTemplate[] = [
  {
    slug: "minimal",
    name: "Minimal Article",
    description: "Blank article with standard preamble. Start from scratch.",
    entries: [
      {
        path: "main.tex",
        kind: "file",
        content: String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{graphicx}
\usepackage{amsmath,amssymb}
\usepackage{hyperref}

\title{Your Paper Title}
\author{Author Name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
Write your abstract here.
\end{abstract}

\section{Introduction}
Start writing here.

\end{document}
`,
      },
      { path: "sections/", kind: "folder", content: "" },
      { path: "figures/", kind: "folder", content: "" },
      { path: "refs.bib", kind: "file", content: `@article{sample2024,
  author  = {Author, First and Coauthor, Second},
  title   = {A Sample Reference for Your Paper},
  journal = {Journal of Examples},
  volume  = {1},
  pages   = {1--10},
  year    = {2024}
}` },
    ],
  },
  {
    slug: "ieee",
    name: "IEEE Conference",
    description: "IEEE conference template with two-column layout and IEEEtran class.",
    entries: [
      {
        path: "main.tex",
        kind: "file",
        content: String.raw`\documentclass[conference]{IEEEtran}
\usepackage{graphicx}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}
\usepackage{hyperref}
\usepackage{cite}

\title{Your Paper Title}

\author{
  \IEEEauthorblockN{First Author\textsuperscript{1} and Second Author\textsuperscript{2}}
  \IEEEauthorblockA{\textsuperscript{1}Department, University, City, Country\\
  Email: first@university.edu}
  \IEEEauthorblockA{\textsuperscript{2}Department, University, City, Country\\
  Email: second@university.edu}
}

\begin{document}
\maketitle

\begin{abstract}
This is the abstract for your IEEE conference paper.
\end{abstract}

\begin{IEEEkeywords}
keyword1, keyword2, keyword3
\end{IEEEkeywords}

\section{Introduction}
This is the introduction section. Start writing your paper here. Provide context, motivation, and outline your contributions.

\section{Related Work}
\section{Methodology}
\section{Experiments}
\section{Conclusion}

\bibliographystyle{IEEEtran}
\nocite{*}
\bibliography{refs}

\end{document}
`,
      },
      { path: "sections/", kind: "folder", content: "" },
      { path: "figures/", kind: "folder", content: "" },
      {
        path: "refs.bib",
        kind: "file",
        content: `@article{sample2024,
  author  = {Author, First and Coauthor, Second},
  title   = {A Sample Reference for Your Paper},
  journal = {Journal of Examples},
  volume  = {1},
  pages   = {1--10},
  year    = {2024}
}`,
      },
    ],
  },
  {
    slug: "acm",
    name: "ACM Conference",
    description: "ACM conference template using acmart class (sigconf format).",
    entries: [
      {
        path: "main.tex",
        kind: "file",
        content: String.raw`\documentclass[sigconf]{acmart}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{hyperref}

\title{Your Paper Title}

\author{First Author}
\affiliation{%
  \institution{University Name}
  \city{City}
  \country{Country}
}
\email{first@university.edu}

\author{Second Author}
\affiliation{%
  \institution{University Name}
  \city{City}
  \country{Country}
}
\email{second@university.edu}

\begin{document}

\begin{abstract}
This is your ACM paper abstract. Summarize the problem, approach, and key findings.
\end{abstract}

\maketitle

\ccsdesc[500]{Computing methodologies~Machine learning}

\keywords{machine learning, ACM template}

\section{Introduction}
Start writing your introduction here.

\section{Related Work}
\section{Method}
\section{Evaluation}
\section{Conclusion}

\bibliographystyle{ACM-Reference-Format}
\nocite{*}
\bibliography{refs}

\end{document}
`,
      },
      { path: "sections/", kind: "folder", content: "" },
      { path: "figures/", kind: "folder", content: "" },
      { path: "refs.bib", kind: "file", content: `@article{sample2024,
  author  = {Author, First and Coauthor, Second},
  title   = {A Sample Reference for Your Paper},
  journal = {Journal of Examples},
  volume  = {1},
  pages   = {1--10},
  year    = {2024}
}` },
    ],
  },
  {
    slug: "elsevier",
    name: "Elsevier Article",
    description: "Elsevier journal article template using elsarticle class.",
    entries: [
      {
        path: "main.tex",
        kind: "file",
        content: String.raw`\documentclass[review]{elsarticle}
\usepackage{graphicx}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}
\usepackage{hyperref}
\usepackage{lineno}

\journal{Journal Name}

\begin{document}

\begin{frontmatter}

\title{Your Article Title}

\author[1]{First Author\corref{cor1}}
\author[2]{Second Author}
\affiliation[1]{organization={Department, University}, addressline={Street Address}, city={City}, postcode={ZIP}, country={Country}}
\affiliation[2]{organization={Department, University}, addressline={Street Address}, city={City}, postcode={ZIP}, country={Country}}
\cortext[cor1]{Corresponding author: first@university.edu}

\begin{abstract}
This is your Elsevier article abstract. Provide a concise summary of your research.
\end{abstract}

\begin{keyword}
keyword1 \sep keyword2 \sep keyword3
\end{keyword}

\end{frontmatter}

\section{Introduction}
Start writing your introduction here.

\section{Materials and Methods}
\section{Results}
\section{Discussion}
\section{Conclusions}

\bibliographystyle{elsarticle-num}
\nocite{*}
\bibliography{refs}

\end{document}
`,
      },
      { path: "sections/", kind: "folder", content: "" },
      { path: "figures/", kind: "folder", content: "" },
      { path: "refs.bib", kind: "file", content: `@article{sample2024,
  author  = {Author, First and Coauthor, Second},
  title   = {A Sample Reference for Your Paper},
  journal = {Journal of Examples},
  volume  = {1},
  pages   = {1--10},
  year    = {2024}
}` },
    ],
  },
  {
    slug: "lncs",
    name: "Springer LNCS",
    description: "Springer Lecture Notes in Computer Science template.",
    entries: [
      {
        path: "main.tex",
        kind: "file",
        content: String.raw`\documentclass[runningheads]{llncs}
\usepackage{graphicx}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}
\usepackage{hyperref}

\title{Your Paper Title}

\author{First Author\inst{1}\orcidID{0000-0000-0000-0000} \and
Second Author\inst{2}}
\authorrunning{F. Author et al.}
\institute{University Name, City, Country \email{first@university.edu}
\and
University Name, City, Country \email{second@university.edu}}

\begin{document}
\maketitle

\begin{abstract}
This is your LNCS abstract. Provide a concise summary.
\end{abstract}

\keywords{keyword1 \and keyword2 \and keyword3}

\section{Introduction}
Start writing your introduction here.

\section{Related Work}
\section{Proposed Approach}
\section{Experiments}
\section{Conclusion}

\bibliographystyle{splncs04}
\nocite{*}
\bibliography{refs}

\end{document}
`,
      },
      { path: "sections/", kind: "folder", content: "" },
      { path: "figures/", kind: "folder", content: "" },
      { path: "refs.bib", kind: "file", content: `@article{sample2024,
  author  = {Author, First and Coauthor, Second},
  title   = {A Sample Reference for Your Paper},
  journal = {Journal of Examples},
  volume  = {1},
  pages   = {1--10},
  year    = {2024}
}` },
    ],
  },
  {
    slug: "neurips",
    name: "NeurIPS",
    description: "NeurIPS conference paper template with required style file preamble.",
    entries: [
      {
        path: "main.tex",
        kind: "file",
        content: String.raw`\documentclass{article}

% NeurIPS-compatible formatting using standard packages
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{mathptmx}
\usepackage{graphicx}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}
\usepackage[margin=1in]{geometry}
\usepackage{hyperref}
\usepackage[numbers,sort&compress]{natbib}

\title{Your NeurIPS Paper Title}

\author{
  First Author\textsuperscript{1}, Second Author\textsuperscript{2} \\
  \textsuperscript{1}University A, City, Country \\
  \textsuperscript{2}University B, City, Country \\
  \texttt{\{first,second\}@university.edu}
}

\begin{document}
\maketitle

\begin{abstract}
This is your NeurIPS paper abstract. Summarize the problem, approach, and key insights.
\end{abstract}

\section{Introduction}
Start writing your introduction here. Use \texttt{\textbackslash citet\{\}} for textual citations and \texttt{\textbackslash citep\{\}} for parenthetical citations.

\section{Related Work}
\section{Method}
\section{Experiments}
\section{Conclusion and Future Work}

\section*{Acknowledgments}
Thanks to our funding sources.

\bibliographystyle{plainnat}
\nocite{*}
\bibliography{refs}

\end{document}
`,
      },
      { path: "sections/", kind: "folder", content: "" },
      { path: "figures/", kind: "folder", content: "" },
      { path: "refs.bib", kind: "file", content: `@article{sample2024,
  author  = {Author, First and Coauthor, Second},
  title   = {A Sample Reference for Your Paper},
  journal = {Journal of Examples},
  volume  = {1},
  pages   = {1--10},
  year    = {2024}
}` },
    ],
  },
  {
    slug: "python-script",
    name: "Python Script",
    description: "Start a Python script with imports, main function, and basic structure.",
    entries: [
      {
        path: "main.py",
        kind: "file",
        content: `#!/usr/bin/env python3
"""
Project Title

Author: Your Name
Date: {today}
"""


def main():
    print("Hello, World!")


if __name__ == "__main__":
    main()
`,
      },
      { path: "data/", kind: "folder", content: "" },
      { path: "output/", kind: "folder", content: "" },
    ],
  },
  {
    slug: "cpp-program",
    name: "C++ Program",
    description: "Start a C++ program with standard includes, main function, and basic structure.",
    entries: [
      {
        path: "main.cpp",
        kind: "file",
        content: `#include <iostream>
#include <string>
#include <vector>

/**
 * Project Title
 *
 * Author: Your Name
 * Date: {today}
 */

int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}
`,
      },
      { path: "data/", kind: "folder", content: "" },
      { path: "output/", kind: "folder", content: "" },
    ],
  },
  {
    slug: "python-package",
    name: "Python Package",
    description: "A proper Python package with src layout, tests, and requirements.",
    entries: [
      {
        path: "src/mypackage/__init__.py",
        kind: "file",
        content: `"""mypackage - a Python package."""

__version__ = "0.1.0"
`,
      },
      {
        path: "src/mypackage/main.py",
        kind: "file",
        content: `"""Main entry point."""


def main():
    print("Hello from mypackage!")


if __name__ == "__main__":
    main()
`,
      },
      {
        path: "tests/test_main.py",
        kind: "file",
        content: `"""Tests for mypackage."""


def test_main():
    assert True
`,
      },
      { path: "requirements.txt", kind: "file", content: "" },
      { path: "README.md", kind: "file", content: "# mypackage\n" },
    ],
  },
  {
    slug: "python-data-science",
    name: "Python Data Science",
    description: "Notebooks, data pipeline, and analysis structure for data work.",
    entries: [
      {
        path: "notebooks/exploration.ipynb",
        kind: "file",
        content: `{
 "cells": [],
 "metadata": {},
 "nbformat": 4,
 "nbformat_minor": 5
}
`,
      },
      {
        path: "src/data_processing.py",
        kind: "file",
        content: `"""Data processing utilities."""


def clean(df):
    return df
`,
      },
      {
        path: "src/analysis.py",
        kind: "file",
        content: `"""Analysis module."""


def run():
    pass
`,
      },
      { path: "data/", kind: "folder", content: "" },
      { path: "output/", kind: "folder", content: "" },
      { path: "requirements.txt", kind: "file", content: "pandas\nnumpy\nmatplotlib\n" },
    ],
  },
  {
    slug: "python-flask",
    name: "Python Flask App",
    description: "Flask web application with templates and static folders.",
    entries: [
      {
        path: "app.py",
        kind: "file",
        content: `from flask import Flask, render_template

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    app.run(debug=True)
`,
      },
      {
        path: "templates/index.html",
        kind: "file",
        content: `<!doctype html>
<html>
  <head><title>Flask App</title></head>
  <body><h1>Hello, Flask!</h1></body>
</html>
`,
      },
      { path: "static/css/style.css", kind: "file", content: "" },
      { path: "requirements.txt", kind: "file", content: "flask\n" },
    ],
  },
  {
    slug: "cpp-cmake",
    name: "C++ CMake Project",
    description: "C++ project with CMake build system, src and include layout.",
    entries: [
      {
        path: "src/main.cpp",
        kind: "file",
        content: `#include <iostream>

int main() {
    std::cout << "Hello, CMake!" << std::endl;
    return 0;
}
`,
      },
      {
        path: "include/app/app.hpp",
        kind: "file",
        content: `#pragma once

namespace app {
void run();
}
`,
      },
      {
        path: "src/app.cpp",
        kind: "file",
        content: `#include "app/app.hpp"
#include <iostream>

namespace app {
void run() {
    std::cout << "Running..." << std::endl;
}
}
`,
      },
      {
        path: "CMakeLists.txt",
        kind: "file",
        content: `cmake_minimum_required(VERSION 3.16)
project(myapp CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(myapp src/main.cpp src/app.cpp)
target_include_directories(myapp PRIVATE include)
`,
      },
      { path: "build/", kind: "folder", content: "" },
      { path: "README.md", kind: "file", content: "# myapp\n" },
    ],
  },
  {
    slug: "cpp-library",
    name: "C++ Library",
    description: "Header-only C++ library with tests and examples.",
    entries: [
      {
        path: "include/mylib/mylib.hpp",
        kind: "file",
        content: `#pragma once

namespace mylib {
inline int add(int a, int b) {
    return a + b;
}
}
`,
      },
      {
        path: "tests/test_mylib.cpp",
        kind: "file",
        content: `#include "mylib/mylib.hpp"
#include <cassert>

int main() {
    assert(mylib::add(2, 3) == 5);
    return 0;
}
`,
      },
      {
        path: "examples/basic.cpp",
        kind: "file",
        content: `#include "mylib/mylib.hpp"
#include <iostream>

int main() {
    std::cout << mylib::add(2, 3) << std::endl;
    return 0;
}
`,
      },
      { path: "CMakeLists.txt", kind: "file", content: `cmake_minimum_required(VERSION 3.16)
project(mylib CXX)

add_library(mylib INTERFACE)
target_include_directories(mylib INTERFACE include)

enable_testing()
add_executable(test_mylib tests/test_mylib.cpp)
target_link_libraries(test_mylib PRIVATE mylib)
add_test(NAME mylib COMMAND test_mylib)
` },
      { path: "README.md", kind: "file", content: "# mylib\n" },
    ],
  },
];

export function getTemplateBySlug(slug: string) {
  return RESEARCH_TEMPLATES.find((t) => t.slug === slug) ?? null;
}
