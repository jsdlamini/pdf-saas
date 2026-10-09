import { describe, expect, it } from "vitest";
import {
  decodeClassItemId,
  encodeClassItemId,
  resolveClassMarks,
} from "./assess-store";

describe("encodeClassItemId / decodeClassItemId", () => {
  it("round-trips every kind and order", () => {
    for (const kind of ["practical", "test", "exam"] as const) {
      for (const order of [1, 2, 3, 4, 12]) {
        const id = encodeClassItemId(kind, order);
        expect(decodeClassItemId(id)).toEqual({ kind, order });
      }
    }
  });

  it("keeps ids distinct across kinds", () => {
    expect(encodeClassItemId("practical", 1)).not.toBe(encodeClassItemId("test", 1));
    expect(encodeClassItemId("test", 1)).not.toBe(encodeClassItemId("exam", 1));
  });
});

describe("resolveClassMarks", () => {
  it("maps each student's mark to their own group's session", () => {
    const groupByStudent = new Map([
      ["S001", "group-a"],
      ["S002", "group-b"],
    ]);
    const sessionByKey = new Map([
      ["group-a:practical:1", 11],
      ["group-a:test:1", 12],
      ["group-b:practical:1", 21],
      ["group-b:test:1", 22],
    ]);
    const marks = [
      { itemId: encodeClassItemId("practical", 1), studentId: "S001", score: 8 },
      { itemId: encodeClassItemId("practical", 1), studentId: "S002", score: 9 },
      { itemId: encodeClassItemId("test", 1), studentId: "S001", score: 7 },
    ];
    expect(resolveClassMarks(marks, groupByStudent, sessionByKey)).toEqual([
      { sessionId: 11, studentId: "S001", score: 8 },
      { sessionId: 21, studentId: "S002", score: 9 },
      { sessionId: 12, studentId: "S001", score: 7 },
    ]);
  });

  it("drops marks for unknown students or missing sessions", () => {
    const groupByStudent = new Map([["S001", "group-a"]]);
    const sessionByKey = new Map([["group-a:practical:1", 11]]);
    const marks = [
      { itemId: encodeClassItemId("practical", 1), studentId: "S001", score: 5 },
      { itemId: encodeClassItemId("practical", 1), studentId: "S999", score: 5 },
      { itemId: encodeClassItemId("exam", 1), studentId: "S001", score: 5 },
    ];
    expect(resolveClassMarks(marks, groupByStudent, sessionByKey)).toEqual([
      { sessionId: 11, studentId: "S001", score: 5 },
    ]);
  });
});
