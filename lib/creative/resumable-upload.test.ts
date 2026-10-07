import { describe, expect, it } from "vitest";
import { resumableEndpoint } from "./resumable-upload";

describe("resumable upload endpoint", () => {
  it("uses Supabase's direct storage host for project URLs", () => {
    expect(resumableEndpoint("https://abcdefgh.supabase.co")).toBe(
      "https://abcdefgh.storage.supabase.co/storage/v1/upload/resumable",
    );
  });

  it("keeps a custom domain as it is", () => {
    expect(resumableEndpoint("https://db.example.com")).toBe("https://db.example.com/storage/v1/upload/resumable");
  });
});
