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

\usepackage[final]{neurips}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{graphicx}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}
\usepackage{hyperref}

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
Start writing your introduction here. Use \texttt{\textbackslash citep\{\}} for parenthetical citations and \texttt{\textbackslash citet\{\}} for textual citations.

\section{Related Work}
\section{Method}
\section{Experiments}
\section{Conclusion and Future Work}

\section*{Acknowledgments}
Thanks to our funding sources.

\bibliographystyle{plain}
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
];

export function getTemplateBySlug(slug: string) {
  return RESEARCH_TEMPLATES.find((t) => t.slug === slug) ?? null;
}
