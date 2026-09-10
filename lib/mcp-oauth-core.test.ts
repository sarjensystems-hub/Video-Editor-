import { describe, expect, it } from "vitest";
import { oauthChallenge, parseBearerToken, protectedResourceMetadata } from "./mcp-oauth-core";

describe("MCP OAuth protected resource helpers", () => {
  it("names Studio itself as the authorization server", () => {
    const metadata = protectedResourceMetadata("https://studio.example.com");
    expect(metadata.resource).toBe("https://studio.example.com/api/mcp");
    // Supabase Auth cannot serve here: it has no dynamic client registration,
    // so clients could not obtain a client id without a human pasting one.
    expect(metadata.authorization_servers).toEqual(["https://studio.example.com"]);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
    expect(metadata.resource_name).toBe("Studio Media MCP");
  });

  it("advertises same-origin protected resource metadata", () => {
    expect(oauthChallenge("https://studio.example.com")).toBe(
      'Bearer resource_metadata="https://studio.example.com/.well-known/oauth-protected-resource"',
    );
  });

  it("accepts exactly one bearer token", () => {
    expect(parseBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(parseBearerToken("bearer token")).toBe("token");
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken("Basic abc")).toBeNull();
    expect(parseBearerToken("Bearer")).toBeNull();
    expect(parseBearerToken("Bearer one two")).toBeNull();
  });
});
