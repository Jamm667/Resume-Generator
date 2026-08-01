import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/**
 * Shared Anthropic client, constructed on first use. Lazy because the SDK
 * throws when no key is configured, and a build or a test that never reaches a
 * vision call should not need one.
 */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}
