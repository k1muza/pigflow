import { describe, expect, it } from "vitest";
import { PLAN_TABS, ingredientHref, planHref, tabFromPath } from "./routes";

describe("the address of a plan", () => {
  it("names the plan itself on the page it opens on", () => {
    // The overview is what a plan comes to, so it is the plan's own address
    // rather than a second way of writing it — one plan, one link to send.
    expect(planHref("7c9e6679-7425-40de-944b-e07fc1f90ae7")).toBe(
      "/projects/7c9e6679-7425-40de-944b-e07fc1f90ae7",
    );
    expect(planHref("7c9e6679-7425-40de-944b-e07fc1f90ae7", "overview")).toBe(
      "/projects/7c9e6679-7425-40de-944b-e07fc1f90ae7",
    );
  });

  it("puts every other page beneath the plan", () => {
    expect(planHref("abc", "cashflow")).toBe("/projects/abc/cashflow");
    expect(planHref("abc", "simulator")).toBe("/projects/abc/simulator");
    expect(planHref("abc", "nutrition")).toBe("/projects/abc/nutrition");
  });

  it("escapes an id that would otherwise change the path", () => {
    // Plans made now are UUIDs, but plans saved before they were still open.
    expect(planHref("a/b", "cashflow")).toBe("/projects/a%2Fb/cashflow");
  });

  it("gives the ingredient catalog and each ingredient a stable address", () => {
    expect(ingredientHref("abc")).toBe("/projects/abc/nutrition/ingredients");
    expect(ingredientHref("abc", "corn/yellow")).toBe(
      "/projects/abc/nutrition/ingredients/corn%2Fyellow",
    );
    expect(tabFromPath(ingredientHref("abc", "corn-yellow-dent"))).toBe("nutrition");
  });
});

describe("reading a page back out of an address", () => {
  it("round-trips every page of a plan", () => {
    for (const tab of PLAN_TABS) {
      expect(tabFromPath(planHref("a-plan", tab))).toBe(tab);
    }
  });

  it("treats anything it does not recognise as the page a plan opens on", () => {
    // The sidebar has to mark something, and marking the plan's own page is
    // never actively wrong.
    expect(tabFromPath("/projects/a-plan")).toBe("overview");
    expect(tabFromPath("/projects/a-plan/invented")).toBe("overview");
    expect(tabFromPath("/projects/a-plan/inputs")).toBe("overview");
    expect(tabFromPath("/projects")).toBe("overview");
    expect(tabFromPath("/login")).toBe("overview");
    expect(tabFromPath("/")).toBe("overview");
  });

  it("is not fooled by a plan named after a page", () => {
    expect(tabFromPath("/projects/cashflow")).toBe("overview");
    expect(tabFromPath("/projects/cashflow/money")).toBe("money");
  });
});
