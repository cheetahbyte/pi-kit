import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { requestBody } from "./provider.ts";

const haiku = { id: "claude-haiku-4-5-20251001", maxTokens: 64_000 } as Model<Api>;

test("Haiku 4.5 reasoning uses a level-dependent thinking budget without effort", () => {
  const low = requestBody(haiku, { reasoning: "low" }, []);
  const high = requestBody(haiku, { reasoning: "high" }, []);
  expect(low.output_config).toBeUndefined();
  expect(high.output_config).toBeUndefined();
  expect(low.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
  expect(high.thinking).toEqual({ type: "enabled", budget_tokens: 16384 });
});
