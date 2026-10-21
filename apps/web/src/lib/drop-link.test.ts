import { describe, expect, it } from "vitest";

import { buildDropLink, parseDropCode, parseDropFragment, readDropCodeEntry } from "./drop-link";

const CODE = "23456789ABCD";

describe("buildDropLink", () => {
  it("keeps the transfer code in the fragment, where no server can see it", () => {
    const link = buildDropLink("https://print-cess.example", CODE);
    expect(link).toBe(`https://print-cess.example/receive#c=${CODE}`);
    const url = new URL(link);
    expect(url.pathname).toBe("/receive");
    expect(url.search).toBe("");
  });
});

describe("parseDropFragment", () => {
  it("reads the code a scanned QR link carries", () => {
    expect(parseDropFragment(`#c=${CODE}`)).toBe(CODE);
  });

  it("accepts a bare fragment for a hand-edited link", () => {
    expect(parseDropFragment(`#${CODE}`)).toBe(CODE);
  });

  it("normalizes the letters a person is likely to mistype", () => {
    expect(parseDropFragment("#c=2345-6789-abcd")).toBe(CODE);
  });

  it("returns nothing for a missing, partial, or malformed fragment", () => {
    expect(parseDropFragment("")).toBeNull();
    expect(parseDropFragment("#")).toBeNull();
    expect(parseDropFragment("#c=2345")).toBeNull();
    expect(parseDropFragment("#c=23456789ABCDEF")).toBeNull();
    expect(parseDropFragment("#other=1")).toBeNull();
  });
});

describe("parseDropCode", () => {
  it("reads a bare code however it was written down", () => {
    expect(parseDropCode(CODE)).toBe(CODE);
    expect(parseDropCode("2345-6789-ABCD")).toBe(CODE);
    expect(parseDropCode("2345 6789 abcd")).toBe(CODE);
    expect(parseDropCode("  2345-6789-abcd  ")).toBe(CODE);
  });

  it("folds the four letters the alphabet leaves out onto their look-alikes", () => {
    expect(parseDropCode("OI23-4567-89AB")).toBe("0123456789AB");
    expect(parseDropCode("lu23-4567-89ab")).toBe("1V23456789AB");
  });

  it("reads a whole receive link, which is what a person actually pastes", () => {
    expect(parseDropCode(`https://print-cess.example/receive#c=${CODE}`)).toBe(CODE);
    expect(parseDropCode(`https://print-cess.example/receive#${CODE}`)).toBe(CODE);
    expect(parseDropCode(`/receive#c=${CODE}`)).toBe(CODE);
    expect(parseDropCode(`https://print-cess.example/receive#c=2345-6789-abcd`)).toBe(CODE);
  });

  it("reads a link from another deployment, which then simply finds nothing", () => {
    expect(parseDropCode(`https://another.example/receive#c=${CODE}`)).toBe(CODE);
  });

  it("refuses everything that is not a code", () => {
    expect(parseDropCode("")).toBeNull();
    expect(parseDropCode("    ")).toBeNull();
    expect(parseDropCode("hello")).toBeNull();
    expect(parseDropCode("2345-6789")).toBeNull();
    expect(parseDropCode("23456789ABCDEF")).toBeNull();
    expect(parseDropCode("https://print-cess.example/receive")).toBeNull();
    expect(parseDropCode("https://print-cess.example/receive#c=nope")).toBeNull();
    expect(parseDropCode("https://print-cess.example/send")).toBeNull();
    expect(parseDropCode("http://[not a url")).toBeNull();
    expect(parseDropCode("javascript:alert(1)")).toBeNull();
  });

  it("never assembles a code out of a hostname", () => {
    expect(parseDropCode("https://abcdefgh2345.example/")).toBeNull();
    expect(parseDropCode("print-cess.example/receive")).toBeNull();
  });

  it("refuses an input far larger than any link", () => {
    expect(
      parseDropCode(`https://x.example/receive#c=${CODE}${"&x=".padEnd(4000, "y")}`),
    ).toBeNull();
    expect(parseDropCode("a".repeat(5000))).toBeNull();
  });
});

describe("readDropCodeEntry", () => {
  it("formats what a person types, one character at a time", () => {
    expect(readDropCodeEntry("2345")).toMatchObject({ display: "2345", code: null });
    expect(readDropCodeEntry("23456")).toMatchObject({ display: "2345-6", code: null });
    expect(readDropCodeEntry("23456789abcd")).toMatchObject({
      display: "2345-6789-ABCD",
      code: CODE,
      fromLink: false,
    });
  });

  it("replaces a pasted link with the code it carried", () => {
    expect(readDropCodeEntry(`https://print-cess.example/receive#c=${CODE}`)).toEqual({
      display: "2345-6789-ABCD",
      code: CODE,
      fromLink: true,
    });
  });

  it("stops a person typing past twelve characters", () => {
    expect(readDropCodeEntry("23456789ABCDEFGH").display).toBe("2345-6789-ABCD");
  });

  it("leaves a half-typed link showing nothing rather than nonsense", () => {
    expect(readDropCodeEntry("https://").code).toBeNull();
  });
});
