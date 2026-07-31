import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockRedirect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // The real redirect() throws a control-flow error Next.js catches; throwing a
  // recognizable error here lets the test assert the guard actually bailed out.
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

const { requireUser } = await import("@/lib/require-user");

describe("requireUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the user for an authenticated session", async () => {
    const user = { id: "user_1", email: "someone@example.com" };
    mockAuth.mockResolvedValue({ user });

    await expect(requireUser()).resolves.toEqual(user);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects to /signin when there is no session", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireUser()).rejects.toThrow("REDIRECT:/signin");
    expect(mockRedirect).toHaveBeenCalledWith("/signin");
  });

  it("redirects to /signin when the session carries no user", async () => {
    mockAuth.mockResolvedValue({ user: undefined });

    await expect(requireUser()).rejects.toThrow("REDIRECT:/signin");
    expect(mockRedirect).toHaveBeenCalledWith("/signin");
  });
});
