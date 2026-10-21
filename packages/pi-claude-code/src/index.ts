import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerClaudeSub } from "./provider.ts";
import { registerUsage } from "./usage.ts";

export default function (pi: ExtensionAPI): void {
  registerClaudeSub(pi);
  registerUsage(pi);
}
