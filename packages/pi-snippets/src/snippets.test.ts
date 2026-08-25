import { describe, expect, test } from "bun:test";
import { parseSnippet } from "./snippets.js";

describe("parseSnippet", () => {
  test("parses metadata and body", () => {
    expect(parseSnippet("review.md", `---
name: Review
placement: before
order: 2
---
Check this first.
`)).toEqual({
      id: "review.md",
      name: "Review",
      description: "",
      placement: "before",
      order: 2,
      body: "Check this first.",
    });
  });
});
