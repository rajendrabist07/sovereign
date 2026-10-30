import { z } from "@sovereign/shared";
import {
  assertAllowedUrl,
  normaliseAllowedHosts,
  safeGet,
  SafeFetchError,
  type SafeGetResult
} from "../../net/safe-fetch";
import { defineTool, ToolError } from "../tool";

export type HttpGetFetcher = (options: {
  url: string;
  allowedHosts: readonly string[];
}) => Promise<SafeGetResult>;

/**
 * Read-only web access for an agent. The host list comes from the workflow's
 * author (trusted); the model only supplies a URL, which must match it.
 * `fetcher` is swappable so the rules can be tested without a network.
 */
export function httpGetTool(options: {
  allowedHosts: readonly string[];
  fetcher?: HttpGetFetcher;
}) {
  const allowedHosts = normaliseAllowedHosts(options.allowedHosts);
  if (allowedHosts.length === 0) {
    throw new SafeFetchError("http_get needs at least one allowed host");
  }
  const fetcher: HttpGetFetcher = options.fetcher ?? safeGet;

  return defineTool({
    name: "http_get",
    description: `Fetch a web page or JSON document with a GET request. Only these hosts are allowed: ${allowedHosts.join(", ")}.`,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full https:// URL on one of the allowed hosts" }
      },
      required: ["url"],
      additionalProperties: false
    },
    shape: { url: z.string().min(1).max(2000) },
    run: async ({ url }) => {
      try {
        // Checked here and again inside safeGet: the second is the one that counts.
        assertAllowedUrl(url, allowedHosts);
        const result = await fetcher({ url, allowedHosts });
        return {
          status: result.status,
          contentType: result.contentType,
          body: result.body,
          truncated: result.truncated
        };
      } catch (error) {
        if (error instanceof SafeFetchError) throw new ToolError(error.message);
        throw error;
      }
    }
  });
}
