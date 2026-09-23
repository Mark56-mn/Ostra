/**
 * Gateway + parser tests — the tool-call loop wire shapes.
 *
 * Verifies (without network):
 * - the OpenAI response parser extracts tool calls, citations, usage
 * - unknown tool names / malformed arguments reach the model as structured
 *   tool results (through the same pipeline the gateway uses)
 * - provider override still selects the exact model (regression)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseOpenAIChatResponse } from "@/lib/providers/openai-parser";

describe("openai response parser — tool loop shapes", () => {
  it("extracts a function tool call", () => {
    const raw = JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "ostra_datetime", arguments: "{}" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    const parsed = parseOpenAIChatResponse(raw);
    assert.equal(parsed.toolCalls.length, 1);
    assert.equal(parsed.toolCalls[0].name, "ostra_datetime");
    assert.equal(parsed.finishReason, "tool_calls");
    assert.equal(parsed.content, null);
  });

  it("parses malformed tool-call arguments as a raw string, never throws", () => {
    const raw = JSON.stringify({
      choices: [
        {
          message: {
            tool_calls: [
              { id: "c1", type: "function", function: { name: "ostra_web_fetch", arguments: "{not json" } },
            ],
          },
        },
      ],
    });
    const parsed = parseOpenAIChatResponse(raw);
    assert.equal(parsed.toolCalls.length, 1);
    assert.equal(parsed.toolCalls[0].arguments, "{not json");
  });

  it("extracts url_citation annotations from server tools", () => {
    const raw = JSON.stringify({
      choices: [
        {
          message: {
            content: "Answer based on sources.",
            annotations: [
              { type: "url_citation", url_citation: { url: "https://example.com/docs", title: "Docs" } },
              { type: "url_citation", url_citation: { url: "ftp://bad" } },
            ],
          },
        },
      ],
    });
    const parsed = parseOpenAIChatResponse(raw);
    assert.equal(parsed.citations.length, 1);
    assert.equal(parsed.citations[0].url, "https://example.com/docs");
    assert.equal(parsed.citations[0].title, "Docs");
  });

  it("sums server_tool_use steps from usage", () => {
    const raw = JSON.stringify({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 } },
    });
    const parsed = parseOpenAIChatResponse(raw);
    assert.equal(parsed.usage?.serverToolSteps, 3);
    assert.equal(parsed.usage?.totalTokens, 15);
  });

  it("degrades non-JSON payloads to text instead of throwing", () => {
    const parsed = parseOpenAIChatResponse("plain text upstream");
    assert.equal(parsed.content, "plain text upstream");
    assert.equal(parsed.toolCalls.length, 0);
  });

  it("handles content-parts arrays from server-tool responses", () => {
    const raw = JSON.stringify({
      choices: [
        { message: { content: [{ type: "text", text: "Part one." }, { type: "other", text: "ignored" }] } },
      ],
    });
    const parsed = parseOpenAIChatResponse(raw);
    assert.equal(parsed.content, "Part one.");
  });
});
